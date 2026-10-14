// src/lib/lender-api/providers/vital/index.ts
//
// Vital Cap as a LenderApiProvider. Glue only: HTTP lives in client.ts, every
// data decision lives in mapping.ts.
//
// Conventional shape: create → one JSON upload per document → GET for status.
// A callback is only ever a signal to re-fetch. Vital has no documented
// callback signature, so the callback we register carries our own secret
// (?token=… on the URL, or a Bearer header) and verify() checks it.

import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { VITAL_DISPLAY_NAME } from "./constants";
import {
  VITAL_PICKS,
  VITAL_REQUIRED_VAULT_FIELDS,
  buildVitalApplication,
  interpretVitalStatus,
  sanitizeVitalStatus,
  suggestVitalPicks,
  vitalDocumentCategory,
  vitalDocumentName,
  vitalSubmissionId,
  vitalTagsForDocCode,
  type VitalSubmission,
} from "./mapping";
import { createSubmission, fetchAsBase64, getSubmission, isVitalConfigured, uploadDocument } from "./client";

/** "Vital Cap", "Vital", "Vital Capital", "Vital Cap Fund" — however the lender row spells it. */
export function isVitalLenderName(lenderName: string): boolean {
  const s = lenderName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["vital", "vitalcap", "vitalcapital", "vitalcapfund", "vitalcapitalfund"].includes(s);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const vital: LenderApiProvider = {
  id: "vital",
  displayName: VITAL_DISPLAY_NAME,
  matchesLender: isVitalLenderName,
  isConfigured: isVitalConfigured,
  requiredVaultFields: VITAL_REQUIRED_VAULT_FIELDS,
  picks: VITAL_PICKS,
  suggestPicks: suggestVitalPicks,
  buildApplication: buildVitalApplication,
  tagsForDocCode: vitalTagsForDocCode,
  interpretStatus: interpretVitalStatus,

  async createApplication(payload) {
    const res = await createSubmission(payload as VitalSubmission);
    const id = res.data?.id;
    if (res.ok && (typeof id === "number" || (typeof id === "string" && id.trim()))) {
      return { ok: true, externalId: String(id).trim() };
    }
    return {
      ok: false,
      error: res.error ?? "Vital Cap did not return a submission id",
      // A 2xx without an id is "we don't know", never a clean rejection.
      status: res.ok ? 0 : res.status,
    };
  },

  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    const results: OutboundDocumentResult[] = [];
    for (const d of docs) {
      const base = { documentId: d.documentId, filename: d.filename, stamped: d.stamped };
      const category = vitalDocumentCategory(d.docCode);
      if (!category) {
        results.push({ ...base, accepted: false, unavailable: true, error: "Vital Cap has no document category for this file" });
        continue;
      }
      const file = await fetchAsBase64(d.url);
      if ("error" in file) {
        results.push({ ...base, accepted: false, error: file.error });
        continue;
      }
      const res = await uploadDocument(externalId, {
        name: vitalDocumentName(d.filename),
        filename: d.filename,
        category,
        content: file.base64,
      });
      results.push(res.ok ? { ...base, accepted: true } : { ...base, accepted: false, error: res.error ?? "Vital Cap rejected the file" });
    }
    return results;
  },

  async fetchStatus(externalId) {
    const res = await getSubmission(externalId);
    // Sanitized here: the response echoes owners with full SSNs.
    return res.ok ? { ok: true, raw: sanitizeVitalStatus(res.data) } : { ok: false, error: res.error ?? "Status request failed" };
  },

  webhook: {
    async verify(req) {
      const secret = process.env.VITAL_WEBHOOK_SECRET?.trim();
      // No secret configured = we cannot tell a real callback from a stranger.
      if (!secret) {
        console.error("vital: VITAL_WEBHOOK_SECRET is not set — rejecting callback");
        return false;
      }
      const token =
        new URL(req.url).searchParams.get("token")?.trim() ||
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
        "";
      return !!token && timingSafeEqual(token, secret);
    },
    extractExternalId: vitalSubmissionId,
  },
};
