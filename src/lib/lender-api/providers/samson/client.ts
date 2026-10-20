// src/lib/lender-api/providers/samson/client.ts
//
// Samson Funding (Salesforce Apex REST) client. Server-only — holds the key.
// Docs: https://documenter.getpostman.com/view/29487822/2sBYHSz1cC
//
// REQUIRED ENV (no defaults — sandbox and production differ, so both are deliberate):
//   SAMSON_FUNDING_API_BASE     — e.g. https://<site>.my.salesforce-sites.com/services/apexrest/SamsonAPI
//   SAMSON_FUNDING_API_KEY      — sent as the `API-Key` header
//   SAMSON_FUNDING_PARTNER_NAME — sent as the `Partner-Name` header (issued with the key)
//
// Create Record = POST {base}; Document Upload = POST {base}/uploadFile with the
// file base64 inside the JSON body.
//
// NEVER LOG BODIES: records carry SSNs. Logs carry method, path and status only.

import type { SamsonDocument, SamsonRecord } from "./mapping";

export interface SamsonConfig {
  apiBase: string;
  apiKey: string;
  partnerName: string;
}

export function getSamsonConfig(): SamsonConfig | null {
  const apiBase = process.env.SAMSON_FUNDING_API_BASE?.trim().replace(/\/+$/, "");
  const apiKey = process.env.SAMSON_FUNDING_API_KEY?.trim();
  const partnerName = process.env.SAMSON_FUNDING_PARTNER_NAME?.trim();
  if (!apiBase || !apiKey || !partnerName) return null;
  return { apiBase, apiKey, partnerName };
}

export function isSamsonConfigured(): boolean {
  return getSamsonConfig() !== null;
}

export interface SamsonResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/** Their errors are {"Status":"Error","Message":…}; Salesforce's own are [{"errorCode","message"}]. */
export function describeSamsonError(status: number, data: unknown): string {
  const first = Array.isArray(data) ? data[0] : data;
  const d = (first && typeof first === "object" ? first : {}) as Record<string, unknown>;
  const msg = d.Message ?? d.message;
  if (typeof msg === "string" && msg.trim()) return `Samson Funding: ${msg.trim().slice(0, 300)}`;
  if (status === 401) return "Samson Funding rejected our API key or partner name";
  return `Samson Funding returned HTTP ${status}`;
}

async function samsonRequest<T = unknown>(path: string, json: unknown): Promise<SamsonResponse<T>> {
  const cfg = getSamsonConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "Samson Funding is not configured" };

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}${path}`, {
      method: "POST",
      headers: {
        "API-Key": cfg.apiKey,
        "Partner-Name": cfg.partnerName,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(json),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return { ok: false, status: 0, data: null, error: "Could not reach Samson Funding" };
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  // Apex can answer 200 with {"Status":"Error"} — that is a failure too.
  const statusField = String((data as Record<string, unknown> | null)?.Status ?? "").toLowerCase();
  const ok = res.ok && statusField !== "error";
  if (!ok) console.error(`samson: POST ${path || "/"} HTTP ${res.status}${statusField === "error" ? " (Status: Error)" : ""}`);
  return { ok, status: res.status, data: data as T | null, error: ok ? null : describeSamsonError(res.status, data) };
}

export function createRecord(record: SamsonRecord) {
  return samsonRequest<Record<string, unknown>>("", record);
}

export function uploadFile(doc: SamsonDocument) {
  return samsonRequest<Record<string, unknown>>("/uploadFile", doc);
}

/** Reads one of our own signed URLs and base64-encodes it. */
export async function fetchAsBase64(url: string): Promise<{ base64: string } | { error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { error: `Could not read the file (HTTP ${res.status})` };
    return { base64: Buffer.from(await res.arrayBuffer()).toString("base64") };
  } catch {
    return { error: "Could not read the file" };
  }
}
