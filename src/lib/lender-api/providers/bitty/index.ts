// src/lib/lender-api/providers/bitty/index.ts
//
// Bitty as a LenderApiProvider. Glue only: HTTP lives in client.ts, every data
// decision lives in mapping.ts.
//
// Bitty is the one-shot shape: files travel inside the submission
// (documentsInline), the verdict comes back in the same response
// (initialStatus), and there is no status API (no fetchStatus) and no webhook.

import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { BITTY_LENDER_NAME, BITTY_MAX_FILES } from "./constants";
import {
  BITTY_PICKS,
  BITTY_REQUIRED_VAULT_FIELDS,
  bittyFileRejection,
  bittyFileType,
  bittyTagsForDocCode,
  buildBittySubmission,
  interpretBittyStatus,
  readBittySubmitResponse,
  suggestBittyPicks,
  type BittyFile,
  type BittySubmission,
} from "./mapping";
import { fetchAsBase64, isBittyConfigured, submitToBitty } from "./client";

export const bitty: LenderApiProvider = {
  id: "bitty",
  displayName: BITTY_LENDER_NAME,
  documentsInline: true,

  matchesLender(lenderName) {
    return lenderName.trim().toLowerCase() === BITTY_LENDER_NAME.toLowerCase();
  },

  isConfigured: isBittyConfigured,
  requiredVaultFields: BITTY_REQUIRED_VAULT_FIELDS,
  picks: BITTY_PICKS,
  suggestPicks: suggestBittyPicks,
  buildApplication: buildBittySubmission,
  tagsForDocCode: bittyTagsForDocCode,
  interpretStatus: interpretBittyStatus,

  async createApplication(payload, ctx) {
    const submission = payload as BittySubmission;
    const docs = ctx?.documents ?? [];

    // Every file problem is terminal (`unavailable`): with no upload endpoint
    // there is no later moment at which a retry could send it.
    const files: BittyFile[] = [];
    const included: OutboundDocument[] = [];
    const skipped: OutboundDocumentResult[] = [];
    const base = (d: OutboundDocument) => ({ documentId: d.documentId, filename: d.filename, stamped: d.stamped });

    for (const doc of docs) {
      const rejection = bittyFileRejection(doc.filename);
      if (rejection) {
        skipped.push({ ...base(doc), accepted: false, unavailable: true, error: rejection });
        continue;
      }
      if (files.length >= BITTY_MAX_FILES) {
        skipped.push({
          ...base(doc),
          accepted: false,
          unavailable: true,
          error: `Bitty takes at most ${BITTY_MAX_FILES} files — upload this one in the Bitty portal`,
        });
        continue;
      }
      const encoded = await fetchAsBase64(doc.url);
      if ("error" in encoded) {
        skipped.push({ ...base(doc), accepted: false, unavailable: true, error: encoded.error });
        continue;
      }
      const type = bittyFileType(doc.docCode);
      files.push({ file: encoded.base64, file_name: doc.filename, ...(type ? { type } : {}) });
      included.push(doc);
    }

    const res = await submitToBitty(submission, files);
    const result = readBittySubmitResponse(res.status, res.data, submission.leadid);
    if (!result.ok) return result;

    return {
      ...result,
      attachments: [...included.map((d) => ({ ...base(d), accepted: true })), ...skipped],
    };
  },

  async uploadDocuments(_externalId, docs: OutboundDocument[]) {
    // Reached only by "Retry failed files". Bitty has no endpoint for files
    // after the submission, so say where they have to go instead.
    return docs.map((d) => ({
      documentId: d.documentId,
      filename: d.filename,
      stamped: d.stamped,
      accepted: false,
      unavailable: true,
      error: "Bitty only takes files with the application — upload this one in the Bitty portal",
    }));
  },
};
