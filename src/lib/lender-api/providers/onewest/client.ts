// src/lib/lender-api/providers/onewest/client.ts
//
// 1West Partner API client. Server-only — holds the partner password.
// Docs: https://1west.readme.io/reference/overview
//
// REQUIRED ENV: ONEWEST_API_USERNAME, ONEWEST_API_PASSWORD
// OPTIONAL ENV:
//   ONEWEST_API_BASE      — defaults to staging. Production is https://api.1west.com/v1
//   ONEWEST_WEBHOOK_TOKEN — the secret WE put in the webhook URL we register
//                           (1West's callbacks are unsigned; see index.ts)
//
// Auth: HTTP Basic on every request. Every endpoint takes and returns JSON;
// documents go up base64 inside the JSON body.
//
// NEVER LOG BODIES: packages carry SSNs. Logs carry method, path and status only.

import { ONEWEST_DEFAULT_API_BASE } from "./constants";
import type { OneWestDocument, OneWestPackage } from "./mapping";

export interface OneWestConfig {
  username: string;
  password: string;
  apiBase: string;
}

export function getOneWestConfig(): OneWestConfig | null {
  const username = process.env.ONEWEST_API_USERNAME?.trim();
  const password = process.env.ONEWEST_API_PASSWORD?.trim();
  if (!username || !password) return null;
  return {
    username,
    password,
    apiBase: (process.env.ONEWEST_API_BASE?.trim() || ONEWEST_DEFAULT_API_BASE).replace(/\/+$/, ""),
  };
}

export function isOneWestConfigured(): boolean {
  return getOneWestConfig() !== null;
}

export interface OneWestResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/**
 * `errors` is documented as an object of field → message, but the 400 example
 * returns it as a JSON-encoded STRING. Accept both.
 */
export function readOneWestErrors(data: unknown): Record<string, string> {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  let errors = d.errors;
  if (typeof errors === "string") {
    try {
      errors = JSON.parse(errors);
    } catch {
      return { error: errors as string };
    }
  }
  const out: Record<string, string> = {};
  if (errors && typeof errors === "object" && !Array.isArray(errors)) {
    for (const [k, v] of Object.entries(errors as Record<string, unknown>)) out[k] = String(v);
  } else if (Array.isArray(errors)) {
    errors.forEach((v, i) => (out[String(i)] = String(v)));
  }
  return out;
}

export function describeOneWestError(status: number, data: unknown): string {
  const errors = readOneWestErrors(data);
  const parts = Object.entries(errors).map(([k, v]) => (v.toLowerCase().includes(k.toLowerCase()) ? v : `${k}: ${v}`));
  if (parts.length) return parts.join("; ");
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (typeof d.status_detail === "string" && d.status_detail.trim()) return d.status_detail.trim();
  if (status === 401 || status === 403) return "1West rejected our API credentials";
  if (typeof data === "string" && data.trim()) return data.trim().slice(0, 300);
  return `1West returned HTTP ${status}`;
}

async function oneWestRequest<T = unknown>(method: "POST", path: string, json: unknown): Promise<OneWestResponse<T>> {
  const cfg = getOneWestConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "1West is not configured" };

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(json),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return { ok: false, status: 0, data: null, error: "Could not reach 1West" };
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }
  // 1West answers some rejections with HTTP 200 and `status: "error"`.
  const bodyStatus = data && typeof data === "object" ? (data as Record<string, unknown>).status : null;
  const ok = res.ok && bodyStatus !== "error";
  if (!ok) console.error(`onewest: ${method} ${path} HTTP ${res.status}${bodyStatus ? ` (${String(bodyStatus)})` : ""}`);
  return { ok, status: res.status, data: data as T | null, error: ok ? null : describeOneWestError(res.status, data) };
}

export function createPackage(pkg: OneWestPackage) {
  return oneWestRequest<{ status?: string; uuid?: string | null; redirect_uri?: string; status_detail?: string }>(
    "POST",
    "/packages",
    pkg
  );
}

export function uploadDocument(uuid: string, doc: OneWestDocument) {
  return oneWestRequest<{ status?: string }>("POST", `/documents/${encodeURIComponent(uuid)}`, doc);
}

export function configureWebhook(url: string) {
  return oneWestRequest<{ status?: string }>("POST", "/webhook", { url });
}

/** Reads one of our own signed URLs and base64-encodes it. */
export async function fetchAsBase64(url: string): Promise<{ base64: string; bytes: number } | { error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { error: `Could not read the file (HTTP ${res.status})` };
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString("base64"), bytes: buf.length };
  } catch {
    return { error: "Could not read the file" };
  }
}
