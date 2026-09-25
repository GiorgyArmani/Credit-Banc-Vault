// src/lib/lender-api/providers/loot/client.ts
//
// Loot External APIs client. Server-only — holds the client secret.
// Spec: https://loot-us.readme.io/reference/loot-us-external-apis-reference
//
// REQUIRED ENV:
//   LOOT_CLIENT_ID, LOOT_SECRET_KEY — client credentials (Basic auth → token)
// OPTIONAL ENV:
//   LOOT_API_BASE       — defaults to staging. Production is https://api-prod.getloot.com
//   LOOT_WEBHOOK_SECRET — the secret WE chose when registering the webhook
//                         subscription (min 15 chars); signs DEAL_DECISION callbacks
//
// AUTH: POST /api/v1/external/auth/token, Basic <client_id:secret>, form body
// grant_type=client_credentials → { data: { access_token, expires_in: 3600 } }.
// Cached per server instance, refreshed early, one retry on 401.
//
// Rate limit: 300 requests / rolling 15 min per client.
//
// NEVER LOG BODIES: applications carry the owner's SSN. Logs carry method,
// path and status only.

import { LOOT_DEFAULT_API_BASE } from "./constants";
import type { LootApplicationForm } from "./mapping";

const TOKEN_SKEW_MS = 5 * 60 * 1000;
const FALLBACK_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface LootConfig {
  clientId: string;
  secret: string;
  apiBase: string;
}

export function getLootConfig(): LootConfig | null {
  const clientId = process.env.LOOT_CLIENT_ID?.trim();
  const secret = process.env.LOOT_SECRET_KEY?.trim();
  if (!clientId || !secret) return null;
  return {
    clientId,
    secret,
    apiBase: (process.env.LOOT_API_BASE?.trim() || LOOT_DEFAULT_API_BASE).replace(/\/+$/, ""),
  };
}

export function isLootConfigured(): boolean {
  return getLootConfig() !== null;
}

export interface LootResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export const __testing = {
  reset() {
    cachedToken = null;
  },
};

async function getToken(cfg: LootConfig): Promise<{ token: string } | { error: string }> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return { token: cachedToken.value };

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}/api/v1/external/auth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { error: "Could not reach Loot (token)" };
  }

  const body = (await res.json().catch(() => null)) as { data?: { access_token?: string; expires_in?: number } } | null;
  const token = body?.data?.access_token;
  if (!res.ok || !token) {
    console.error(`loot: token request failed HTTP ${res.status}`);
    return { error: "Loot rejected our client credentials" };
  }
  const ttl = Number(body?.data?.expires_in);
  const expiresAt = Number.isFinite(ttl) && ttl > 0 ? Date.now() + ttl * 1000 - TOKEN_SKEW_MS : Date.now() + FALLBACK_TOKEN_TTL_MS;
  cachedToken = { value: String(token), expiresAt };
  return { token: cachedToken.value };
}

/** `{ statusCode, status, error, message }` — message/error may be a string or a list. */
export function describeLootError(status: number, data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  for (const v of [d.message, d.error, d.status]) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length) return v.map(String).join("; ");
  }
  if (typeof data === "string" && data.trim()) return data.trim().slice(0, 300);
  return `Loot returned HTTP ${status}`;
}

async function lootRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: () => FormData
): Promise<LootResponse<T>> {
  const cfg = getLootConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "Loot is not configured" };

  let authRetried = false;
  for (;;) {
    const t = await getToken(cfg);
    if ("error" in t) return { ok: false, status: 401, data: null, error: t.error };

    let res: Response;
    try {
      res = await fetch(`${cfg.apiBase}${path}`, {
        method,
        // No Content-Type: fetch sets the multipart boundary itself.
        headers: { Authorization: `Bearer ${t.token}`, Accept: "application/json" },
        // Rebuilt per attempt: a FormData body is consumed by the first send.
        body: body ? body() : undefined,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      return { ok: false, status: 0, data: null, error: "Could not reach Loot" };
    }

    if (res.status === 401 && !authRetried) {
      authRetried = true;
      cachedToken = null;
      continue;
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text || null;
    }
    if (!res.ok) console.error(`loot: ${method} ${path} HTTP ${res.status}`);
    return { ok: res.ok, status: res.status, data: data as T | null, error: res.ok ? null : describeLootError(res.status, data) };
  }
}

export function submitCustomerApplication(form: LootApplicationForm) {
  return lootRequest<{ data?: { deal?: { deal_id?: string | number } } }>(
    "POST",
    "/api/v1/external/partner/submit/customer-application",
    () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) fd.append(k, v);
      return fd;
    }
  );
}

export function uploadDealAttachment(dealId: string, file: { bytes: ArrayBuffer; filename: string; contentType: string }) {
  return lootRequest("POST", "/api/v1/external/partner/upload/deal-attachments", () => {
    const fd = new FormData();
    fd.append("dealId", dealId);
    fd.append("attachments", new Blob([file.bytes], { type: file.contentType }), file.filename);
    return fd;
  });
}

export function listWebhookSubscriptions() {
  return lootRequest("GET", "/api/v1/external/webhook-subscriptions/");
}

export function createWebhookSubscription(url: string, secret: string) {
  return lootRequest("POST", "/api/v1/external/webhook-subscriptions/", () => {
    const fd = new FormData();
    fd.append("url", url);
    fd.append("subscribeEvents[0]", "DEAL_DECISION");
    fd.append("secret", secret);
    return fd;
  });
}

/** Reads one of our own signed URLs for the multipart upload. */
export async function fetchFile(
  url: string
): Promise<{ bytes: ArrayBuffer; contentType: string } | { error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { error: `Could not read the file (HTTP ${res.status})` };
    return {
      bytes: await res.arrayBuffer(),
      contentType: res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
    };
  } catch {
    return { error: "Could not read the file" };
  }
}
