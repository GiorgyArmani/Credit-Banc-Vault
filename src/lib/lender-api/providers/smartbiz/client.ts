// src/lib/lender-api/providers/smartbiz/client.ts
//
// SmartBiz partner API client. Server-only — holds the partner token.
// Docs: https://partner-api-service.smartbizloans.com/redoc
//
// REQUIRED ENV: SMARTBIZ_PARTNER_ID, SMARTBIZ_TOKEN
// OPTIONAL ENV: SMARTBIZ_API_BASE (default below; trimmed, https:// added if
//               missing), SMARTBIZ_WEBHOOK_SECRET (returned once by POST /v3/webhook)
//
// Auth: Authorization: Basic base64(partner_id:token) on every request.
// NEVER LOG BODIES: business + owner payloads carry SSNs.

import { SMARTBIZ_DEFAULT_API_BASE, SMARTBIZ_WEBHOOK_EVENT } from "./constants";
import type { SmartBizBusinessRequest, SmartBizSubmissionRequest } from "./mapping";

export interface SmartBizConfig {
  partnerId: string;
  token: string;
  apiBase: string;
}

function normalizeBase(raw: string | undefined): string {
  let base = (raw ?? "").trim();
  if (!base) base = SMARTBIZ_DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base.replace(/\/+$/, "");
}

export function getSmartBizConfig(): SmartBizConfig | null {
  const partnerId = process.env.SMARTBIZ_PARTNER_ID?.trim();
  const token = process.env.SMARTBIZ_TOKEN?.trim();
  if (!partnerId || !token) return null;
  return { partnerId, token, apiBase: normalizeBase(process.env.SMARTBIZ_API_BASE) };
}

export function isSmartBizConfigured(): boolean {
  return getSmartBizConfig() !== null;
}

export interface SmartBizResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  fieldErrors?: Record<string, string[]>;
}

/** JSON:API `{ errors: [{ title, detail }] }` or FastAPI `{ detail: [{ loc, msg }] }`. */
export function describeSmartBizError(status: number, data: unknown): { error: string; fieldErrors?: Record<string, string[]> } {
  const d = (data && typeof data === "object" ? data : {}) as { errors?: unknown; detail?: unknown };
  if (Array.isArray(d.errors) && d.errors.length) {
    const parts = d.errors.map((e) => {
      const x = (e ?? {}) as { title?: unknown; detail?: unknown };
      return [x.title, x.detail].filter((s) => typeof s === "string" && s).join(": ");
    });
    return { error: parts.filter(Boolean).join("; ") || `SmartBiz returned HTTP ${status}` };
  }
  if (Array.isArray(d.detail)) {
    const fieldErrors: Record<string, string[]> = {};
    for (const e of d.detail as Array<{ loc?: unknown[]; msg?: unknown }>) {
      const loc = (e.loc ?? []).filter((p) => p !== "body").join(".") || "request";
      (fieldErrors[loc] ??= []).push(String(e.msg ?? "invalid"));
    }
    const n = Object.keys(fieldErrors).length;
    return { error: `SmartBiz rejected ${n} field${n === 1 ? "" : "s"}`, fieldErrors };
  }
  if (typeof d.detail === "string" && d.detail) return { error: d.detail };
  return { error: `SmartBiz returned HTTP ${status}` };
}

/**
 * SmartBiz 400s a business whose email or TIN already belongs to another.
 * UNCONFIRMED wording (no error code documented) — asked in the go-live email.
 */
export function isDuplicateBusinessError(status: number, error: string | null | undefined): boolean {
  if (status !== 400 || !error) return false;
  const e = error.toLowerCase();
  return /duplicate|already (exists|exist|associated|in use|registered|taken)/.test(e);
}

async function smartBizRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  opts: { json?: unknown; form?: () => FormData } = {}
): Promise<SmartBizResponse<T>> {
  const cfg = getSmartBizConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "SmartBiz is not configured" };

  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${cfg.partnerId}:${cfg.token}`).toString("base64")}`,
    Accept: "application/json, application/vnd.api+json",
  };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form(); // fetch sets the multipart boundary
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}${path}`, { method, headers, body, signal: AbortSignal.timeout(120_000) });
  } catch {
    return { ok: false, status: 0, data: null, error: "Could not reach SmartBiz" };
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    console.error(`smartbiz: ${method} ${path} HTTP ${res.status}`);
    const described = describeSmartBizError(res.status, data);
    return { ok: false, status: res.status, data: data as T | null, error: described.error, fieldErrors: described.fieldErrors };
  }
  return { ok: true, status: res.status, data: data as T | null, error: null };
}

type IdDoc = { data?: { id?: string } };

export function createBusiness(body: SmartBizBusinessRequest) {
  return smartBizRequest<IdDoc>("POST", "/v3/business/", { json: body });
}

export function createSubmission(body: SmartBizSubmissionRequest) {
  return smartBizRequest<IdDoc>("POST", "/v3/submission/", { json: body });
}

export function getSubmission(submissionId: string) {
  return smartBizRequest("GET", `/v3/submission/${encodeURIComponent(submissionId)}`);
}

export function searchSubmissionByReference(clientReferenceId: string) {
  return smartBizRequest<{ data?: Array<{ id?: string }> }>("POST", "/v3/submission/search", {
    json: { filter: { client_reference_id: clientReferenceId }, options: { pagination: { page: 1, size: 10 } } },
  });
}

export function uploadSubmissionDocument(
  submissionId: string,
  form: { document_type: string; tax_year?: number },
  file: { bytes: ArrayBuffer; filename: string; contentType: string }
) {
  return smartBizRequest("POST", `/v3/submission/${encodeURIComponent(submissionId)}/documents`, {
    form: () => {
      const fd = new FormData();
      fd.append("document_type", form.document_type);
      if (form.tax_year) fd.append("tax_year", String(form.tax_year));
      fd.append("file", new Blob([file.bytes], { type: file.contentType }), file.filename);
      return fd;
    },
  });
}

export function createWebhook(url: string) {
  return smartBizRequest<{ data?: { id?: string; attributes?: { secret?: string } } }>("POST", "/v3/webhook/", {
    json: { url, subscribed_events: [SMARTBIZ_WEBHOOK_EVENT] },
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
