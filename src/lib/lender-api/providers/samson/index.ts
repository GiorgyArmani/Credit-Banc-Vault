// src/lib/lender-api/providers/samson/index.ts
//
// Samson Funding as a LenderApiProvider. Glue only: HTTP lives in client.ts,
// every data decision lives in mapping.ts.
//
// create → one base64 JSON upload per document. No status API and no webhook:
// a sent deal stays "Submitted" and UW records Samson's answer by hand.

import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { SAMSON_DISPLAY_NAME, SAMSON_LENDER_NAME } from "./constants";
import {
  SAMSON_PICKS,
  SAMSON_REQUIRED_VAULT_FIELDS,
  buildSamsonApplication,
  interpretSamsonStatus,
  readSamsonOpportunityId,
  samsonDocType,
  samsonTagsForDocCode,
  suggestSamsonPicks,
  type SamsonRecord,
} from "./mapping";
import { createRecord, fetchAsBase64, isSamsonConfigured, uploadFile } from "./client";

/** "Samson Funding", "Samson" — however the lender row spells it. */
export function isSamsonLenderName(lenderName: string): boolean {
  const s = lenderName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return s === SAMSON_LENDER_NAME.toLowerCase().replace(/[^a-z0-9]/g, "") || s === "samson";
}

export const samson: LenderApiProvider = {
  id: "samson",
  displayName: SAMSON_DISPLAY_NAME,
  matchesLender: isSamsonLenderName,
  isConfigured: isSamsonConfigured,
  requiredVaultFields: SAMSON_REQUIRED_VAULT_FIELDS,
  picks: SAMSON_PICKS,
  suggestPicks: suggestSamsonPicks,
  buildApplication: buildSamsonApplication,
  tagsForDocCode: samsonTagsForDocCode,
  interpretStatus: interpretSamsonStatus,

  async createApplication(payload) {
    const res = await createRecord(payload as SamsonRecord);
    const id = readSamsonOpportunityId(res.data);
    if (res.ok && id) return { ok: true, externalId: id };
    return {
      ok: false,
      error: res.ok ? "Samson Funding did not return an opportunity id" : res.error ?? "Samson Funding rejected the deal",
      // A 2xx without an id is "we don't know", never a clean rejection.
      status: res.ok ? 0 : res.status,
    };
  },

  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    const results: OutboundDocumentResult[] = [];
    for (const d of docs) {
      const base = { documentId: d.documentId, filename: d.filename, stamped: d.stamped };
      const docType = samsonDocType(d.docCode);
      if (!docType) {
        results.push({ ...base, accepted: false, unavailable: true, error: "Samson Funding has no document type for this file" });
        continue;
      }
      const file = await fetchAsBase64(d.url);
      if ("error" in file) {
        results.push({ ...base, accepted: false, error: file.error });
        continue;
      }
      const res = await uploadFile({ oppId: externalId, fileName: d.filename, docType, fileData: file.base64 });
      results.push(res.ok ? { ...base, accepted: true } : { ...base, accepted: false, error: res.error ?? "Samson Funding rejected the file" });
    }
    return results;
  },
};
