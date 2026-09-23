// src/lib/lender-api/providers/credibly/client.ts
//
// Credibly ISO API client. Server-only — holds the API key.
// Spec: https://api-uat.credibly.com/docs/openapi/openapi.json ("ISO API")
//
// REQUIRED ENV:
//   CREDIBLY_API_KEY — the ISO API key, sent as X-API-KEY to mint a JWT
// OPTIONAL ENV:
//   CREDIBLY_API_BASE       — defaults to UAT. Production is https://api.credibly.com
//   CREDIBLY_WEBHOOK_TOKEN  — the "iso_token" their X-Signature is built from
//
// AUTH IS TWO-STEP, and not what their onboarding email describes: the key is
// an API KEY on a GET (not a bearer token on a POST).
//   GET /v2/get-jwt   header X-API-KEY: <key>   -> { token, expires_at }
//   every other call  header Authorization: Bearer <token>
// The JWT is cached per server instance. `expires_at` has no documented format
// in the spec, so it is parsed defensively and ignored when unparseable — a
// short fallback TTL plus the 401-retry below is what actually keeps us honest.
//
// NEVER LOG BODIES: submissions carry the owner's SSN. Logs carry method, path
// and status only.

import { CREDIBLY_DEFAULT_API_BASE } from "./constants";

/** Used when Credibly's expires_at can't be parsed. Their TTL is undocumented. */
const FALLBACK_TOKEN_TTL_MS = 10 * 60 * 1000;
/** Refresh this long before expiry so a token can't die mid-flight. */
const TOKEN_SKEW_MS = 60 * 1000;

export interface CrediblyConfig {
  apiKey: string;
  apiBase: string;
}

export function getCrediblyConfig(): CrediblyConfig | null {
  const apiKey = process.env.CREDIBLY_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    apiBase: (process.env.CREDIBLY_API_BASE || CREDIBLY_DEFAULT_API_BASE).replace(/\/+$/, ""),
  };
}

export function isCrediblyConfigured(): boolean {
  return getCrediblyConfig() !== null;
}

export interface CrediblyResponse<T = unknown> {
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
  peekToken() {
    return cachedToken;
  },
};

/**
 * Turns Credibly's `expires_at` into an absolute ms timestamp. The spec types
 * it as a bare string with no format, example or description, so ISO 8601 and
 * epoch seconds/ms are all plausible — anything that doesn't land in a sane
 * window is rejected in favour of the fallback TTL.
 */
export function parseExpiresAt(value: unknown, now = Date.now()): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return ms > now ? ms : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 1e12 ? numeric : numeric * 1000;
    return ms > now ? ms : null;
  }

  // A bare "2026-09-22 15:04:05" is parsed as local time by Date; Credibly's
  // servers are not ours, so treat a timestamp with no zone as UTC.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
  const candidate = hasZone ? value.trim() : `${value.trim().replace(" ", "T")}Z`;
  const ms = Date.parse(candidate);
  if (!Number.isFinite(ms) || ms <= now) return null;
  // A year-long "expiry" is a parse accident, not a token lifetime.
  if (ms - now > 24 * 60 * 60 * 1000) return null;
  return ms;
}

async function getToken(cfg: CrediblyConfig): Promise<{ token: string } | { error: string }> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return { token: cachedToken.value };

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}/v2/get-jwt`, {
      method: "GET",
      headers: { "X-API-KEY": cfg.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { error: "Could not reach Credibly (token)" };
  }

  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.token) {
    console.error(`credibly: token request failed HTTP ${res.status}`);
    return { error: "Credibly rejected our API key" };
  }

  const parsed = parseExpiresAt(body.expires_at);
  const expiresAt = parsed ? parsed - TOKEN_SKEW_MS : Date.now() + FALLBACK_TOKEN_TTL_MS;
  cachedToken = { value: String(body.token), expiresAt };
  return { token: cachedToken.value };
}

export function describeCrediblyError(status: number, data: unknown): string {
  const d = data as any;
  // 400 on submissions/documents: { error }. 404: { code, message, traceback }.
  if (typeof d?.error === "string" && d.error) return d.error;
  if (typeof d?.message === "string" && d.message) return d.message;
  if (Array.isArray(d?.decline_reasons) && d.decline_reasons.length) {
    return `Declined: ${d.decline_reasons.join(", ")}`;
  }
  return `Credibly returned HTTP ${status}`;
}

interface RequestInitLite {
  method: "GET" | "POST";
  path: string;
  json?: unknown;
  /** Already-encoded multipart/urlencoded body; skips JSON serialization. */
  body?: BodyInit;
  contentType?: string;
}

export async function crediblyRequest<T = unknown>(init: RequestInitLite): Promise<CrediblyResponse<T>> {
  const cfg = getCrediblyConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "Credibly is not configured" };

  let authRetried = false;

  for (;;) {
    const t = await getToken(cfg);
    if ("error" in t) return { ok: false, status: 401, data: null, error: t.error };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${t.token}`,
      Accept: "application/json",
    };
    let body: BodyInit | undefined = init.body;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init.contentType) {
      headers["Content-Type"] = init.contentType;
    }

    let res: Response;
    try {
      res = await fetch(`${cfg.apiBase}${init.path}`, {
        method: init.method,
        headers,
        body,
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      return { ok: false, status: 0, data: null, error: "Could not reach Credibly" };
    }

    // Their offers routes document a 401 as literally "Token expired", so a
    // 401 is always worth one fresh token before believing it.
    if (res.status === 401 && !authRetried) {
      authRetried = true;
      cachedToken = null;
      continue;
    }

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) console.error(`credibly: ${init.method} ${init.path} HTTP ${res.status}`);

    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? null : describeCrediblyError(res.status, data),
    };
  }
}

export function createSubmission(body: unknown) {
  return crediblyRequest<{ submission_id: string; status: string }>({
    method: "POST",
    path: "/v2/submissions",
    json: body,
  });
}

export interface CrediblyStipItem {
  stip_id: string;
  stip_status: string;
  short_text: string;
  long_text: string;
}

export interface CrediblyStatusResponse {
  status: string;
  stips?: CrediblyStipItem[];
  decline_reasons?: string[];
  action_links?: Record<string, Array<{ link?: string }>>;
}

export function getSubmissionStatus(submissionId: string) {
  return crediblyRequest<CrediblyStatusResponse>({
    method: "GET",
    path: `/v2/submissions/${encodeURIComponent(submissionId)}/status`,
  });
}

/**
 * Upload by URL. Credibly fetches the signed link itself, so nothing is
 * streamed through us — the same shape Forward Financing uses.
 */
export function uploadDocumentByUrl(
  submissionId: string,
  stipId: string,
  urls: string[],
  finalDocument: boolean
) {
  return crediblyRequest<{ status: string }>({
    method: "POST",
    path: `/v2/submissions/${encodeURIComponent(submissionId)}/documents/${encodeURIComponent(stipId)}`,
    json: { files: urls, final_document: finalDocument },
  });
}

export interface CrediblyBase64File {
  file_name: string;
  mime_type: string;
  base64_data: string;
}

/** Fallback for when Credibly can't fetch our signed URL itself. */
export function uploadDocumentBase64(
  submissionId: string,
  stipId: string,
  files: CrediblyBase64File[],
  finalDocument: boolean
) {
  return crediblyRequest<{ status: string }>({
    method: "POST",
    path: `/v2/submissions/${encodeURIComponent(submissionId)}/documents/${encodeURIComponent(stipId)}`,
    json: { files, final_document: finalDocument },
  });
}

/** Fetches one of our own signed URLs and encodes it for the base64 fallback. */
export async function fetchAsBase64(
  url: string,
  filename: string
): Promise<CrediblyBase64File | { error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { error: `Could not read the file (HTTP ${res.status})` };
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      file_name: filename,
      mime_type: res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
      base64_data: buf.toString("base64"),
    };
  } catch {
    return { error: "Could not read the file" };
  }
}
