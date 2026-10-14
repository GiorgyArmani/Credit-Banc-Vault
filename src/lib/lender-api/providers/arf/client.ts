// src/lib/lender-api/providers/arf/client.ts
//
// Dragin Partner API client (ARF). Server-only — holds the credential.
//
// REQUIRED ENV: ARF_API_BASE, ARF_API_TOKEN
//   ARF_API_BASE  — the environment base URL Dragin issues us. No default:
//                   paths below are appended as {BASE}/api/v1/external/…
//   ARF_API_TOKEN — key id and secret joined by a dot ("isop_….…"), sent as a
//                   Bearer token. The credential names the funder; no request
//                   carries a client or account id.
//
// Every call is asynchronous: 202 + a job id, then GET /jobs/{jobId}. Dragin
// never calls us back, so there is no webhook.
//
// Every auth failure is the same bare 401 by design.

export interface ArfConfig {
  apiBase: string;
  token: string;
}

export function getArfConfig(): ArfConfig | null {
  const apiBase = process.env.ARF_API_BASE?.trim().replace(/\/+$/, "");
  const token = process.env.ARF_API_TOKEN?.trim();
  if (!apiBase || !token) return null;
  return { apiBase, token };
}

export function isArfConfigured(): boolean {
  return getArfConfig() !== null;
}

export interface ArfResponse {
  /** 2xx. */
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  error: string | null;
  /** Seconds, from a 409's Retry-After. */
  retryAfter?: number;
}

export interface ArfFile {
  filename: string;
  bytes: Buffer;
}

export function describeArfError(status: number, data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  for (const key of ["detail", "message", "error"]) {
    const v = d[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
  }
  if (status === 401) return "ARF rejected our API credential";
  return `ARF returned HTTP ${status}`;
}

async function arfRequest(
  method: "GET" | "POST",
  path: string,
  init: { body?: FormData; headers?: Record<string, string> } = {}
): Promise<ArfResponse> {
  const cfg = getArfConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "ARF is not configured" };

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}/api/v1/external${path}`, {
      method,
      // No Content-Type: fetch sets the multipart boundary itself.
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json", ...init.headers },
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    return { ok: false, status: 0, data: null, error: "Could not reach ARF" };
  }

  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = text ? JSON.parse(text) : null;
    data = parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    data = null;
  }
  // The job path names nothing sensitive, but keep the log to the route shape.
  if (!res.ok) console.error(`arf: ${method} ${path.replace(/\/jobs\/.+$/, "/jobs/{id}")} HTTP ${res.status}`);
  const retryAfter = Number(res.headers.get("retry-after"));
  return {
    ok: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : describeArfError(res.status, data),
    ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
  };
}

function filesForm(files: ArfFile[], fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  // One `files` part per document; Dragin classifies each from its contents.
  for (const f of files) form.append("files", new Blob([new Uint8Array(f.bytes)]), f.filename);
  return form;
}

/** One deal per request. The idempotency key is our reference id, so a retried call never makes a second deal. */
export function submitDeal(files: ArfFile[], idempotencyKey: string) {
  return arfRequest("POST", "/deal-submission", { body: filesForm(files), headers: { "Idempotency-Key": idempotencyKey } });
}

/** Attaches files to the deal behind an EXTDS- job. Documents are NOT de-duplicated: send only what is new. */
export function sendDealDocuments(jobId: string, files: ArfFile[]) {
  return arfRequest("POST", "/deal-documents", { body: filesForm(files, { jobId }) });
}

export function getJob(jobId: string) {
  return arfRequest("GET", `/jobs/${encodeURIComponent(jobId)}`);
}

/** Reads one of our own signed URLs. */
export async function fetchFileBytes(url: string): Promise<{ bytes: Buffer } | { error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { error: `Could not read the file (HTTP ${res.status})` };
    return { bytes: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return { error: "Could not read the file" };
  }
}
