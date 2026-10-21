// src/lib/lender-api/providers/yes-leasing/index.ts
//
// YES Leasing (Kaaj Partner API) as a LenderApiProvider. Glue only.
//
// One-shot, files only: every file travels in the single ingest call
// (documentsInline) and the answer is an app_id. Kaaj can't add files to an
// existing app_id — another upload is another application — so every file
// problem is terminal, like Bitty. No status API (no fetchStatus) and no
// webhook: YES Leasing sends its decision directly and UW records it by hand.

import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { YES_LEASING_DELIVERED_STATUS, YES_LEASING_DISPLAY_NAME, YES_LEASING_MAX_FILE_BYTES } from "./constants";
import {
  YES_LEASING_PICKS,
  YES_LEASING_REQUIRED_VAULT_FIELDS,
  buildYesLeasingApplication,
  interpretYesLeasingStatus,
  isEncryptedPdf,
  suggestYesLeasingPicks,
  yesLeasingTagsForDocCode,
  type YesLeasingStatus,
} from "./mapping";
import { fetchFileBytes, ingestPackage, isYesLeasingConfigured, type KaajFile } from "./client";

/** "YES Leasing", "Yes Leasing", "yesleasing" — and nothing longer. */
export function isYesLeasingLenderName(lenderName: string): boolean {
  return lenderName.toLowerCase().replace(/[^a-z]/g, "") === "yesleasing";
}

const base = (d: OutboundDocument) => ({ documentId: d.documentId, filename: d.filename, stamped: d.stamped });

export const yesLeasing: LenderApiProvider = {
  id: "yes_leasing",
  displayName: YES_LEASING_DISPLAY_NAME,
  documentsInline: true,
  matchesLender: isYesLeasingLenderName,
  isConfigured: isYesLeasingConfigured,
  requiredVaultFields: YES_LEASING_REQUIRED_VAULT_FIELDS,
  picks: YES_LEASING_PICKS,
  suggestPicks: suggestYesLeasingPicks,
  buildApplication: buildYesLeasingApplication,
  tagsForDocCode: yesLeasingTagsForDocCode,
  interpretStatus: interpretYesLeasingStatus,

  async createApplication(_payload, ctx) {
    const files: KaajFile[] = [];
    const included: OutboundDocument[] = [];
    const skipped: OutboundDocumentResult[] = [];

    for (const d of ctx?.documents ?? []) {
      const file = await fetchFileBytes(d.url);
      if ("error" in file) {
        skipped.push({ ...base(d), accepted: false, unavailable: true, error: file.error });
        continue;
      }
      if (file.bytes.length > YES_LEASING_MAX_FILE_BYTES) {
        skipped.push({ ...base(d), accepted: false, unavailable: true, error: "YES Leasing takes files up to 50 MB — split or compress this file" });
        continue;
      }
      if (isEncryptedPdf(d.filename, file.bytes)) {
        skipped.push({
          ...base(d),
          accepted: false,
          unavailable: true,
          error: "This PDF is password-protected and Kaaj can't read it — remove the password, upload it again, then send",
        });
        continue;
      }
      files.push({ filename: d.filename, bytes: file.bytes });
      included.push(d);
    }

    // Nothing has been sent yet, so this is a clean "no".
    if (files.length === 0) {
      return {
        ok: false,
        status: 422,
        error: skipped.length
          ? `None of the selected files can be sent to YES Leasing: ${skipped[0].error}`
          : "YES Leasing reads the deal from its documents — select the application, invoice and bank statements, then send.",
      };
    }

    const res = await ingestPackage(files);
    const appId = typeof res.data?.app_id === "string" && res.data.app_id.trim() ? res.data.app_id.trim() : null;
    if (!res.ok || !appId || res.data?.success === false) {
      return {
        ok: false,
        error: res.ok ? "Kaaj did not confirm the package (no app_id)" : res.error ?? "Kaaj rejected the package",
        // A 2xx without an app_id is "we don't know", never a clean rejection.
        status: res.ok ? 0 : res.status,
      };
    }

    const initialStatus: YesLeasingStatus = {
      status: YES_LEASING_DELIVERED_STATUS,
      uploadId: typeof res.data?.upload_id === "number" ? res.data.upload_id : null,
      fileCount: typeof res.data?.file_count === "number" ? res.data.file_count : null,
    };
    return {
      ok: true,
      externalId: appId,
      initialStatus,
      attachments: [...included.map((d) => ({ ...base(d), accepted: true })), ...skipped],
    };
  },

  async uploadDocuments(_externalId, docs: OutboundDocument[]) {
    // Reached only by "Retry failed files". Kaaj can't add files to an existing
    // application, so say where they have to go instead.
    return docs.map((d) => ({
      ...base(d),
      accepted: false,
      unavailable: true,
      error: "YES Leasing only takes files with the original package — upload this one in the Kaaj portal (work.kaaj.ai) or email it to YES Leasing",
    }));
  },
};
