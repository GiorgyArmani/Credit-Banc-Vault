// src/lib/lender-api/providers/yes-leasing/client.ts
//
// Kaaj Partner API client (YES Leasing). Server-only — holds the credential.
//
// REQUIRED ENV: KAAJ_API_BASE, KAAJ_API_TOKEN
//   KAAJ_API_BASE  — https://api.kaaj.ai. No default: Kaaj has NO sandbox, so
//                    every send is a real deal at YES Leasing.
//   KAAJ_API_TOKEN — the partner bearer token ("kaaj_partner_…").
// OPTIONAL: KAAJ_USER_EMAIL — the Kaaj user an upload is attributed to; unset
//   = the partner's default uploader on Kaaj's side.
//
// One call: multipart files + lender_name → app_id. No status endpoint, no
// webhook, and no way to add files to an existing app_id (a second upload is a
// second application).

import { YES_LEASING_KAAJ_LENDER_NAME } from "./constants";

export interface KaajConfig {
  apiBase: string;
  token: string;
  userEmail: string | null;
}

export function getKaajConfig(): KaajConfig | null {
  const apiBase = process.env.KAAJ_API_BASE?.trim().replace(/\/+$/, "");
  const token = process.env.KAAJ_API_TOKEN?.trim();
  if (!apiBase || !token) return null;
  return { apiBase, token, userEmail: process.env.KAAJ_USER_EMAIL?.trim() || null };
}

export function isYesLeasingConfigured(): boolean {
  return getKaajConfig() !== null;
}

export interface KaajResponse {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  error: string | null;
}

export interface KaajFile {
  filename: string;
  bytes: Buffer;
}

/** Kaaj errors are `{ detail: string }` or `{ detail: { error, valid_lender_names? | available_users? } }`. */
export function describeKaajError(status: number, data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const detail = d.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim().slice(0, 300);
  // Request validation (422): [{ loc: ["body","files"], msg: "Field required" }, …]
  if (Array.isArray(detail)) {
    const parts = detail
      .map((e) => {
        const item = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
        const field = Array.isArray(item.loc) ? item.loc.filter((p) => p !== "body").join(".") : "";
        const msg = typeof item.msg === "string" ? item.msg : "";
        return [field, msg].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    if (parts.length) return `Kaaj rejected the request — ${parts.join("; ")}`.slice(0, 300);
  }
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const det = detail as Record<string, unknown>;
    const msg = typeof det.error === "string" ? det.error.trim().slice(0, 300) : "";
    // Both are OUR configuration problems, not the deal's.
    if (Array.isArray(det.valid_lender_names)) return `${msg} Kaaj no longer recognises our YES Leasing lender name — tell engineering.`.trim();
    if (Array.isArray(det.available_users)) return `${msg} KAAJ_USER_EMAIL is not a Kaaj user on our account — tell engineering.`.trim();
    if (msg) return msg;
  }
  if (status === 401) return "Kaaj rejected our API token";
  if (status === 403) return "Kaaj says we have no active partnership on this token";
  return `Kaaj returned HTTP ${status}`;
}

/** One loan package = one YES Leasing application. */
export async function ingestPackage(files: KaajFile[]): Promise<KaajResponse> {
  const cfg = getKaajConfig();
  if (!cfg) return { ok: false, status: 0, data: null, error: "YES Leasing is not configured" };

  const form = new FormData();
  form.append("lender_name", YES_LEASING_KAAJ_LENDER_NAME);
  if (cfg.userEmail) form.append("user_email", cfg.userEmail);
  for (const f of files) form.append("files", new Blob([new Uint8Array(f.bytes)]), f.filename);

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}/partner-portal/ingest`, {
      method: "POST",
      // No Content-Type: fetch sets the multipart boundary itself.
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    return { ok: false, status: 0, data: null, error: "Could not reach Kaaj" };
  }

  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = text ? JSON.parse(text) : null;
    data = parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    data = null;
  }
  if (!res.ok) console.error(`yes-leasing: POST /partner-portal/ingest HTTP ${res.status}`);
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : describeKaajError(res.status, data) };
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
