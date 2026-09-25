// src/lib/lender-api/providers/fundkite/client.ts
//
// Fundkite deal API client. Server-only — holds the client secret.
// Docs: developers.fundkite.com (login-only). The server is Laravel Passport.
//
// REQUIRED ENV:
//   FUND_KITE_CLIENT_ID, FUND_KITE_CLIENT_SECRET — client-credentials pair
// OPTIONAL ENV:
//   FUND_KIT_TOKEN_ENDPOINT  — defaults to <base>/oauth/token (FUND_KITE_TOKEN_ENDPOINT also read)
//   FUND_KITE_API_BASE       — defaults to https://developers.fundkite.com; the
//                              credentials, not the host, pick sandbox vs production
//   FUND_KITE_WEBHOOK_SECRET — HMAC key for X-Fundkite-Signature
//
// Create is idempotent on our side too: the Idempotency-Key is the attempt's
// reference id, so a network retry of the same attempt can't duplicate a deal.
//
// NEVER LOG BODIES: deals carry the owner's SSN. Logs carry method, path and
// status only.

import { FUNDKITE_DEFAULT_API_BASE } from "./constants";
import type { FundkiteDealRequest, FundkiteDealStatus } from "./mapping";

const TOKEN_SKEW_MS = 5 * 60 * 1000;
const FALLBACK_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface FundkiteConfig {
  clientId: string;
  clientSecret: string;
  apiBase: string;
  tokenUrl: string;
}

export function getFundkiteConfig(): FundkiteConfig | null {
  const clientId = process.env.FUND_KITE_CLIENT_ID?.trim();
  const clientSecret = process.env.FUND_KITE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const apiBase = (process.env.FUND_KITE_API_BASE?.trim() || FUNDKITE_DEFAULT_API_BASE).replace(/\/+$/, "");
  const tokenUrl =
    process.env.FUND_KIT_TOKEN_ENDPOINT?.trim() || process.env.FUND_KITE_TOKEN_ENDPOINT?.trim() || `${apiBase}/oauth/token`;
  return { clientId, clientSecret, apiBase, tokenUrl };
}

export function isFundkiteConfigured(): boolean {
  return getFundkiteConfig() !== null;
}

export interface FundkiteResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  fieldErrors?: Record<string, string[]>;
  error: string | null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export const __testing = {
  reset() {
    cachedToken = null;
  },
};

async function getToken(cfg: FundkiteConfig): Promise<{ token: string } | { error: string }> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return { token: cachedToken.value };

  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: cfg.clientId, client_secret: cfg.clientSecret }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { error: "Could not reach Fundkite (token)" };
  }

  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!res.ok || !body?.access_token) {
    console.error(`fundkite: token request failed HTTP ${res.status}`);
    return { error: "Fundkite rejected our client credentials" };
  }
  const ttl = Number(body.expires_in);
  const expiresAt = Number.isFinite(ttl) && ttl > 0 ? Date.now() + ttl * 1000 - TOKEN_SKEW_MS : Date.now() + FALLBACK_TOKEN_TTL_MS;
  cachedToken = { value: body.access_token, expiresAt };
  return { token: cachedToken.value };
}

/** Laravel shapes: `{ message, errors: { field: [msg] } }` (422) or `{ message }`. */
export function describeFundkiteError(status: number, data: unknown): { error: string; fieldErrors?: Record<string, string[]> } {
  const d = (data && typeof data === "object" ? data : {}) as { message?: unknown; errors?: unknown; error?: unknown };
  const fieldErrors =
    d.errors && typeof d.errors === "object" && !Array.isArray(d.errors)
      ? Object.fromEntries(
          Object.entries(d.errors as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : [String(v)]])
        )
      : undefined;
  const message = typeof d.message === "string" && d.message ? d.message : typeof d.error === "string" ? d.error : null;
  return { error: message ?? `Fundkite returned HTTP ${status}`, fieldErrors };
}

async function fundkiteRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  opts: { json?: unknown; form?: () => FormData; idempotencyKey?: string } = {}
): Promise<FundkiteResponse<T>> {
  const cfg = getFundkiteConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "Fundkite is not configured" };

  let authRetried = false;
  for (;;) {
    const t = await getToken(cfg);
    if ("error" in t) return { ok: false, status: 401, data: null, error: t.error };

    const headers: Record<string, string> = { Authorization: `Bearer ${t.token}`, Accept: "application/json" };
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      // Rebuilt per attempt; fetch sets the multipart boundary itself.
      body = opts.form();
    }

    let res: Response;
    try {
      res = await fetch(`${cfg.apiBase}${path}`, { method, headers, body, signal: AbortSignal.timeout(120_000) });
    } catch {
      return { ok: false, status: 0, data: null, error: "Could not reach Fundkite" };
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
      data = null;
    }
    if (!res.ok) {
      console.error(`fundkite: ${method} ${path} HTTP ${res.status}`);
      const described = describeFundkiteError(res.status, data);
      return { ok: false, status: res.status, data: data as T | null, error: described.error, fieldErrors: described.fieldErrors };
    }
    return { ok: true, status: res.status, data: data as T | null, error: null };
  }
}

export function createDeal(payload: FundkiteDealRequest, idempotencyKey: string) {
  return fundkiteRequest<{ request_id?: string; data?: { id?: string; status?: string; submission_number?: string | null } }>(
    "POST",
    "/api/v1/deals",
    { json: payload, idempotencyKey }
  );
}

export function getDeal(dealId: string) {
  return fundkiteRequest<FundkiteDealStatus | { data?: FundkiteDealStatus }>("GET", `/api/v1/deals/${encodeURIComponent(dealId)}`);
}

/** UNCONFIRMED field names (`file`, `type`): the doc names the types, not the form fields. */
export function uploadDealDocument(
  dealId: string,
  type: string,
  file: { bytes: ArrayBuffer; filename: string; contentType: string }
) {
  return fundkiteRequest("POST", `/api/v1/deals/${encodeURIComponent(dealId)}/documents`, {
    form: () => {
      const fd = new FormData();
      fd.append("type", type);
      fd.append("file", new Blob([file.bytes], { type: file.contentType }), file.filename);
      return fd;
    },
  });
}

/** Reads one of our own signed URLs for the multipart upload. */
export async function fetchFile(url: string): Promise<{ bytes: ArrayBuffer; contentType: string } | { error: string }> {
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
