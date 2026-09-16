//
// Forward Financing partner API client. Server-only — holds the partner secret.
// Docs: https://apidocs.forwardfinancing.com
//
// REQUIRED ENV:
//   FORWARD_FINANCING_USERNAME — partner account email
//   FORWARD_FINANCING_SECRET   — secret issued at onboarding (the OAuth "password")
// OPTIONAL ENV (default to STAGING — production only when both are set explicitly):
//   FORWARD_FINANCING_API_BASE   — https://api.staging.forwardfinancing.com
//   FORWARD_FINANCING_TOKEN_URL  — https://access.staging.forwardfinancing.com/application/o/token/
//
// AUTH: OAuth2 password grant, fixed client_id "partner-api". Tokens live 600 s;
// cached per server instance and refreshed 60 s early, and once more on a 401.
//
// RATE LIMIT: 1 request/second per partner user. Every request (token included)
// goes through one in-process queue that spaces request STARTS by ≥ 1 s. Separate
// serverless instances can still collide, so 429 waits 2 s and retries (max 3).
//
// NEVER LOG BODIES: lead payloads carry the owner's SSN. Logs carry method,
// path, status and the NAMES of fields FF rejected — nothing else.

import type { FfLeadRequest } from "./mapping";

export const FF_DEFAULT_API_BASE = "https://api.staging.forwardfinancing.com";
export const FF_DEFAULT_TOKEN_URL = "https://access.staging.forwardfinancing.com/application/o/token/";
const MIN_INTERVAL_MS = 1000;
const RATE_LIMIT_WAIT_MS = 2000;
const RATE_LIMIT_MAX_RETRIES = 3;

export interface FfConfig {
  username: string;
  secret: string;
  apiBase: string;
  tokenUrl: string;
}

export function getFfConfig(): FfConfig | null {
  const username = process.env.FORWARD_FINANCING_USERNAME?.trim();
  const secret = process.env.FORWARD_FINANCING_SECRET;
  if (!username || !secret) return null;
  return {
    username,
    secret,
    apiBase: (process.env.FORWARD_FINANCING_API_BASE || FF_DEFAULT_API_BASE).replace(/\/+$/, ""),
    tokenUrl: process.env.FORWARD_FINANCING_TOKEN_URL || FF_DEFAULT_TOKEN_URL,
  };
}

export function isFfConfigured(): boolean {
  return getFfConfig() !== null;
}

export interface FfResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

let sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let cachedToken: { value: string; expiresAt: number } | null = null;
let lastStart = 0;
let queue: Promise<void> = Promise.resolve();

export const __testing = {
  reset() {
    cachedToken = null;
    lastStart = 0;
    queue = Promise.resolve();
  },
  setSleep(fn: (ms: number) => Promise<void>) {
    sleep = fn;
  },
};

/** Resolves when this caller may start its request. */
function paced(): Promise<void> {
  const turn = queue.then(async () => {
    const wait = lastStart + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  });
  queue = turn.catch(() => undefined);
  return turn;
}

async function getToken(cfg: FfConfig): Promise<{ token: string } | { error: string }> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return { token: cachedToken.value };

  await paced();
  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "partner-api",
        username: cfg.username,
        password: cfg.secret,
        scope: "openid email profile",
      }).toString(),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { error: "Could not reach Forward Financing (token)" };
  }

  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    const code = body?.error ? ` (${body.error})` : "";
    console.error(`forward-financing: token request failed HTTP ${res.status}${code}`);
    return { error: `Forward Financing rejected our credentials${code}` };
  }

  const ttl = Number(body.expires_in) || 600;
  cachedToken = { value: String(body.access_token), expiresAt: Date.now() + Math.max(ttl - 60, 30) * 1000 };
  return { token: cachedToken.value };
}

export function describeFfError(status: number, data: unknown): string {
  const d = data as any;
  if (d?.errors && typeof d.errors === "object") {
    return (
      "Validation failed: " +
      Object.entries(d.errors as Record<string, unknown>)
        .map(([field, msgs]) => `${field} ${Array.isArray(msgs) ? msgs.join(", ") : String(msgs)}`)
        .join("; ")
    );
  }
  if (typeof d?.message === "string" && d.message) return d.message;
  return `Forward Financing returned HTTP ${status}`;
}

export async function ffRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  json?: unknown
): Promise<FfResponse<T>> {
  const cfg = getFfConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "Forward Financing is not configured" };

  let authRetried = false;
  let rateRetries = 0;

  for (;;) {
    const t = await getToken(cfg);
    if ("error" in t) return { ok: false, status: 401, data: null, error: t.error };

    await paced();
    let res: Response;
    try {
      res = await fetch(`${cfg.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${t.token}`,
          Accept: "application/json",
          ...(json === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      return { ok: false, status: 0, data: null, error: "Could not reach Forward Financing" };
    }

    if (res.status === 401 && !authRetried) {
      authRetried = true;
      cachedToken = null;
      continue;
    }
    if (res.status === 429 && rateRetries < RATE_LIMIT_MAX_RETRIES) {
      rateRetries += 1;
      await sleep(RATE_LIMIT_WAIT_MS);
      continue;
    }

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const fields = data?.errors && typeof data.errors === "object" ? ` fields=${Object.keys(data.errors).join(",")}` : "";
      console.error(`forward-financing: ${method} ${path} HTTP ${res.status}${fields}`);
    }

    return { ok: res.ok, status: res.status, data, error: res.ok ? null : describeFfError(res.status, data) };
  }
}

export function createLead(body: FfLeadRequest) {
  return ffRequest<{ message: string; id: string }>("POST", "/v1/lead", body);
}

export interface FfAttachmentItem {
  filename: string;
  attachment_url: string;
  tags: string[];
}

export function uploadAttachments(leadId: string, attachments: FfAttachmentItem[]) {
  return ffRequest("POST", "/v1/attachments", { lead_id: leadId, attachments });
}

export function getDealStatus(leadId: string) {
  return ffRequest("GET", `/v1/deal_status/${encodeURIComponent(leadId)}`);
}

export function registerWebhook(url: string) {
  return ffRequest<{ success: boolean }>("POST", "/v1/webhook", { webhook_url: url });
}

export function triggerWebhook(url: string, leadId: string, eventType: "Approved" | "Declined" | "Waiting on ISO") {
  return ffRequest("POST", "/v1/trigger_webhook", { webhook_url: url, lead_id: leadId, event_type: eventType });
}
