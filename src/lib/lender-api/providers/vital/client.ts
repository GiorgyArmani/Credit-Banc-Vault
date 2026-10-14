// src/lib/lender-api/providers/vital/client.ts
//
// Vital Cap (LendTech / LendSaaS Partner API) client. Server-only — holds the key.
// Spec: https://vitalcapfund.lendtech.io/backend/api/docs/partners.yml
//
// REQUIRED ENV: VITAL_API_KEY, VITAL_API_BASE
//   There is NO default host: the sandbox and production each have their own
//   base URL + key (Vital IT, 2026-10), so both must be set deliberately.
//   Production is https://vitalcapfund.lendtech.io/backend/api/partners
// OPTIONAL ENV:
//   VITAL_WEBHOOK_SECRET — the secret WE put on the callback we register
//                          (see index.ts)
//
// Auth: `X-API-KEY` on every request. Everything is JSON; documents go up
// base64 inside the JSON body.
//
// NEVER LOG BODIES: submissions carry SSNs. Logs carry method, path and status only.

import type { VitalDocument, VitalSubmission } from "./mapping";

export interface VitalConfig {
  apiKey: string;
  apiBase: string;
}

export function getVitalConfig(): VitalConfig | null {
  const apiKey = process.env.VITAL_API_KEY?.trim();
  const apiBase = process.env.VITAL_API_BASE?.trim().replace(/\/+$/, "");
  if (!apiKey || !apiBase) return null;
  return { apiKey, apiBase };
}

export function isVitalConfigured(): boolean {
  return getVitalConfig() !== null;
}

export interface VitalResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/** Their Error schema is `{ message, data }`. */
export function describeVitalError(status: number, data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (typeof d.message === "string" && d.message.trim()) return d.message.trim().slice(0, 300);
  if (status === 401) return "Vital Cap rejected our API key";
  if (status === 403) return "Vital Cap's API key is not allowed to do this";
  return `Vital Cap returned HTTP ${status}`;
}

async function vitalRequest<T = unknown>(method: "GET" | "POST", path: string, json?: unknown): Promise<VitalResponse<T>> {
  const cfg = getVitalConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "Vital Cap is not configured" };

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}${path}`, {
      method,
      headers: {
        "X-API-KEY": cfg.apiKey,
        Accept: "application/json",
        ...(json === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return { ok: false, status: 0, data: null, error: "Could not reach Vital Cap" };
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Their gateway answers auth failures with an HTML page — never surfaced.
    data = null;
  }
  if (!res.ok) console.error(`vital: ${method} ${path} HTTP ${res.status}`);
  return { ok: res.ok, status: res.status, data: data as T | null, error: res.ok ? null : describeVitalError(res.status, data) };
}

export function createSubmission(submission: VitalSubmission) {
  return vitalRequest<Record<string, unknown>>("POST", "/deal-submission", submission);
}

export function getSubmission(id: string) {
  return vitalRequest<Record<string, unknown>>("GET", `/deal-submission/${encodeURIComponent(id)}`);
}

export function uploadDocument(id: string, doc: VitalDocument) {
  return vitalRequest<Record<string, unknown>>("POST", `/deal-submission/${encodeURIComponent(id)}/document`, doc);
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
