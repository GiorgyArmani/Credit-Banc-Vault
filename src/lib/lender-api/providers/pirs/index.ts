// src/lib/lender-api/providers/pirs/index.ts
//
// PIRS Capital (Pirs Portal Web API) as a LenderApiProvider. Glue only: HTTP
// lives in client.ts, every data decision lives in mapping.ts.
//
// Files go up by URL (Attachments/Create): PIRS downloads each signed URL
// during the call and keeps our filename + description (sandbox-verified
// 2026-10-15). BinaryUpload is not used — it renames every file to a GUID.
//
// Status: GET Application/Get, plus Application/Options once the deal is
// approved (the terms). PIRS PUSHES changes to the callbackUrl we send with
// each application; the push is UNSIGNED, so the URL carries our own secret
// (?token=…) and verify() checks it. The body is only a signal to re-fetch.

import { createHash, timingSafeEqual } from "node:crypto";
import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { PIRS_DISPLAY_NAME } from "./constants";
import {
  PIRS_PICKS,
  PIRS_REQUIRED_VAULT_FIELDS,
  buildPirsApplication,
  interpretPirsStatus,
  isPirsApprovedStatus,
  pirsAttachmentDescription,
  pirsTagsForDocCode,
  sanitizePirsStatus,
  suggestPirsPicks,
  type PirsApplication,
} from "./mapping";
import { createApplication, createAttachments, getApplication, getOptions, isPirsConfigured, readPirsModelState } from "./client";

/** "PIRS", "PIRS Capital", "Pirs Portal" — however the lender row spells it. */
export function isPirsLenderName(lenderName: string): boolean {
  const s = lenderName.trim().toLowerCase().replace(/[^a-z]/g, "");
  return s === "pirs" || s === "pirscapital" || s === "pirsportal";
}

function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function fundIdOf(data: unknown): string | null {
  const id = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}).fundId;
  if (typeof id === "number" && Number.isInteger(id) && id > 0) return String(id);
  if (typeof id === "string" && /^\d+$/.test(id.trim())) return id.trim();
  return null;
}

/** A per-item failure PIRS reports inside a 2xx (BinaryUpload carries `exception`). */
function itemError(item: unknown): string | null {
  const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  for (const k of ["exception", "error"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
  }
  return null;
}

export const pirs: LenderApiProvider = {
  id: "pirs",
  displayName: PIRS_DISPLAY_NAME,
  matchesLender: isPirsLenderName,
  isConfigured: isPirsConfigured,
  requiredVaultFields: PIRS_REQUIRED_VAULT_FIELDS,
  picks: PIRS_PICKS,
  suggestPicks: suggestPirsPicks,
  buildApplication: buildPirsApplication,
  tagsForDocCode: pirsTagsForDocCode,
  interpretStatus: interpretPirsStatus,

  async createApplication(payload) {
    const res = await createApplication(payload as PirsApplication);
    const fundId = fundIdOf(res.data);
    if (res.ok && fundId) return { ok: true, externalId: fundId };
    const fields = readPirsModelState(res.data);
    return {
      ok: false,
      fieldErrors: Object.keys(fields).length ? fields : undefined,
      error: res.error ?? "PIRS did not return a fund id",
      // A 2xx without a fund id is "we don't know", never a clean rejection.
      status: res.ok ? 0 : res.status,
    };
  },

  /** One call per file, so each result is PIRS's answer for that file alone. */
  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    const results: OutboundDocumentResult[] = [];
    for (const d of docs) {
      const base = { documentId: d.documentId, filename: d.filename, stamped: d.stamped };
      const res = await createAttachments(externalId, [
        { fileName: d.filename.trim(), description: pirsAttachmentDescription(d.docCode), url: d.url },
      ]);
      const failed = res.ok ? (Array.isArray(res.data) ? res.data.map(itemError).find(Boolean) : null) : null;
      if (res.ok && !failed) results.push({ ...base, accepted: true });
      else results.push({ ...base, accepted: false, error: failed ?? res.error ?? "PIRS rejected the file" });
    }
    return results;
  },

  async fetchStatus(externalId) {
    const res = await getApplication(externalId);
    if (!res.ok) {
      // An unknown fund id answers 500 with an HTML page, not a 404.
      return { ok: false, error: res.status === 500 ? "PIRS could not load this fund id" : res.error ?? "Status request failed" };
    }
    // The terms live on a second endpoint; fetch them only once approved.
    let options: unknown;
    if (isPirsApprovedStatus(res.data?.status)) {
      const opt = await getOptions(externalId);
      if (opt.ok) options = opt.data;
    }
    return { ok: true, raw: sanitizePirsStatus(res.data, options) };
  },

  webhook: {
    async verify(req) {
      const secret = process.env.PIRS_WEBHOOK_TOKEN?.trim();
      // No token configured = we cannot tell a real push from a stranger.
      if (!secret) {
        console.error("pirs: PIRS_WEBHOOK_TOKEN is not set — rejecting callback");
        return false;
      }
      const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
      return !!token && sameSecret(token, secret);
    },
    extractExternalId: fundIdOf,
  },
};
