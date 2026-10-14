// src/lib/lender-api/providers/arf/index.ts
//
// ARF (Dragin Partner API) as a LenderApiProvider. Glue only.
//
// ARF takes files and nothing else: one multipart request carrying the signed
// application plus supporting documents (documentsInline), answered with a
// job id. Unlike Bitty there IS a later moment for files (/deal-documents),
// so a file that fails here stays retryable. No webhook, and no verdict over
// the API: a job only ever says whether the packet reached ARF.

import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { ARF_DISPLAY_NAME } from "./constants";
import {
  ARF_PICKS,
  ARF_REQUIRED_VAULT_FIELDS,
  arfTagsForDocCode,
  buildArfApplication,
  interpretArfStatus,
  isArfApplication,
  readArfJob,
  suggestArfPicks,
  type ArfSubmission,
} from "./mapping";
import { fetchFileBytes, getJob, isArfConfigured, sendDealDocuments, submitDeal, type ArfFile } from "./client";

export function isArfLenderName(lenderName: string): boolean {
  return lenderName.trim().toLowerCase() === "arf";
}

const base = (d: OutboundDocument) => ({ documentId: d.documentId, filename: d.filename, stamped: d.stamped });

/** Reads every document; a file we can't read is reported, never silently dropped. */
async function readFiles(docs: OutboundDocument[]) {
  const files: ArfFile[] = [];
  const included: OutboundDocument[] = [];
  const failed: OutboundDocumentResult[] = [];
  for (const d of docs) {
    const file = await fetchFileBytes(d.url);
    if ("error" in file) {
      failed.push({ ...base(d), accepted: false, error: file.error });
      continue;
    }
    files.push({ filename: d.filename, bytes: file.bytes });
    included.push(d);
  }
  return { files, included, failed };
}

function jobIdOf(data: Record<string, unknown> | null): string | null {
  const id = data?.jobId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export const arf: LenderApiProvider = {
  id: "arf",
  displayName: ARF_DISPLAY_NAME,
  documentsInline: true,
  matchesLender: isArfLenderName,
  isConfigured: isArfConfigured,
  requiredVaultFields: ARF_REQUIRED_VAULT_FIELDS,
  picks: ARF_PICKS,
  suggestPicks: suggestArfPicks,
  buildApplication: buildArfApplication,
  tagsForDocCode: arfTagsForDocCode,
  interpretStatus: interpretArfStatus,

  async createApplication(payload, ctx) {
    const { referenceId } = payload as ArfSubmission;
    const { files, included, failed } = await readFiles(ctx?.documents ?? []);

    // Nothing has been sent yet, so this is a clean "no".
    if (!included.some((d) => isArfApplication(d.docCode))) {
      return {
        ok: false,
        status: 422,
        error:
          "ARF reads the deal from the signed application, and it isn't among the files. Select the signed application and send again.",
      };
    }

    const res = await submitDeal(files, referenceId);
    const jobId = jobIdOf(res.data);
    if (!res.ok || !jobId) {
      return {
        ok: false,
        error: res.ok ? "ARF did not return a job id" : res.error ?? "ARF rejected the submission",
        // A 2xx without a job id is "we don't know", never a clean rejection.
        status: res.ok ? 0 : res.status,
      };
    }
    return {
      ok: true,
      externalId: jobId,
      attachments: [...included.map((d) => ({ ...base(d), accepted: true })), ...failed],
    };
  },

  /** Files that missed the original packet go to the same deal through /deal-documents. */
  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    const { files, included, failed } = await readFiles(docs);
    if (files.length === 0) return failed;

    const res = await sendDealDocuments(externalId, files);
    if (res.ok) return [...included.map((d) => ({ ...base(d), accepted: true })), ...failed];

    const error =
      res.status === 409
        ? `ARF is still processing the original submission. Retry in ${Math.ceil((res.retryAfter ?? 120) / 60)} minutes.`
        : res.error ?? "ARF rejected the files";
    return [...included.map((d) => ({ ...base(d), accepted: false, error })), ...failed];
  },

  async fetchStatus(externalId) {
    const res = await getJob(externalId);
    const job = readArfJob(res.status, res.data, externalId);
    if (job) return { ok: true, raw: job };
    return { ok: false, error: res.status === 404 ? "ARF has no job with this id under our credential" : res.error ?? "Status request failed" };
  },
};
