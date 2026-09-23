// src/lib/lender-api/providers/credibly/index.ts
//
// Credibly as a LenderApiProvider. Glue only: HTTP lives in client.ts, every
// data decision lives in mapping.ts.
//
// The one shape worth knowing: Credibly has no document-type field. Each file
// is posted to a STIP — a requirement Credibly raises on the submission after
// it is created — so uploadDocuments fetches the submission's status first,
// matches each of our files to a stip by that stip's text, and posts per stip.
// A file with no matching stip is reported as not accepted rather than dropped
// into an arbitrary slot.

import { createHash } from "crypto";
import type {
  LenderApiProvider,
  OutboundDocument,
  OutboundDocumentResult,
} from "../../types";
import { CREDIBLY_LENDER_NAME } from "./constants";
import {
  CREDIBLY_PICKS,
  CREDIBLY_REQUIRED_VAULT_FIELDS,
  buildCrediblySubmission,
  crediblyTagsForDocCode,
  interpretCrediblyStatus,
  matchStipForDocCode,
  suggestCrediblyPicks,
} from "./mapping";
import {
  createSubmission,
  fetchAsBase64,
  getSubmissionStatus,
  isCrediblyConfigured,
  uploadDocumentBase64,
  uploadDocumentByUrl,
  type CrediblyBase64File,
} from "./client";

/**
 * SHA256 of `iso_token + rawBody`, compared to X-Signature. Their own worked
 * example prints an MD5-length value, which is a documentation error — the
 * pseudocode and the stated 64-char length are what this follows.
 *
 * The raw bytes are hashed, not a re-serialized object: any difference in key
 * order or spacing would change the digest.
 */
export function crediblySignature(token: string, rawBody: string): string {
  return createHash("sha256").update(token + rawBody).digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const credibly: LenderApiProvider = {
  id: "credibly",
  displayName: CREDIBLY_LENDER_NAME,

  matchesLender(lenderName) {
    return lenderName.trim().toLowerCase() === CREDIBLY_LENDER_NAME.toLowerCase();
  },

  isConfigured: isCrediblyConfigured,
  requiredVaultFields: CREDIBLY_REQUIRED_VAULT_FIELDS,
  picks: CREDIBLY_PICKS,
  suggestPicks: suggestCrediblyPicks,
  buildApplication: buildCrediblySubmission,
  tagsForDocCode: crediblyTagsForDocCode,
  interpretStatus: interpretCrediblyStatus,

  async createApplication(payload) {
    const res = await createSubmission(payload);
    if (res.ok && res.data?.submission_id) {
      return { ok: true, externalId: String(res.data.submission_id) };
    }
    return {
      ok: false,
      error: res.error ?? "Credibly did not return a submission id",
      status: res.status,
    };
  },

  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    const base = (d: OutboundDocument) => ({
      documentId: d.documentId,
      filename: d.filename,
      stamped: d.stamped,
    });

    // Stips only exist once the submission does, and their ids are opaque and
    // per-submission, so the catalogue has to be read back before anything can
    // be posted.
    const status = await getSubmissionStatus(externalId);
    if (!status.ok) {
      return docs.map((d) => ({
        ...base(d),
        accepted: false,
        error: status.error ?? "Could not read the Credibly stip list",
      }));
    }
    const stips = Array.isArray(status.data?.stips) ? status.data!.stips! : [];

    const results: OutboundDocumentResult[] = [];
    const byStip = new Map<string, OutboundDocument[]>();

    for (const doc of docs) {
      const stip = matchStipForDocCode(doc.docCode, stips);
      if (!stip) {
        results.push({
          ...base(doc),
          accepted: false,
          error: stips.length
            ? `No Credibly stip matches this document (${doc.docCode ?? "untyped"})`
            : "Credibly has not raised any stips for this submission yet",
        });
        continue;
      }
      const group = byStip.get(stip.stip_id) ?? [];
      group.push(doc);
      byStip.set(stip.stip_id, group);
    }

    for (const [stipId, group] of byStip) {
      // Credibly fetches our signed URL itself — nothing streams through us.
      const byUrl = await uploadDocumentByUrl(
        externalId,
        stipId,
        group.map((d) => d.url),
        true
      );
      if (byUrl.ok) {
        results.push(...group.map((d) => ({ ...base(d), accepted: true })));
        continue;
      }

      // Fall back to sending the bytes. Worth the round trip: a URL Credibly
      // can't reach would otherwise fail a whole stip's worth of documents.
      const encoded: CrediblyBase64File[] = [];
      const failed: OutboundDocumentResult[] = [];
      for (const d of group) {
        const file = await fetchAsBase64(d.url, d.filename);
        if ("error" in file) {
          // Our own storage couldn't produce the file — that is terminal.
          failed.push({ ...base(d), accepted: false, unavailable: true, error: file.error });
        } else {
          encoded.push(file);
        }
      }
      results.push(...failed);
      if (!encoded.length) continue;

      const sent = await uploadDocumentBase64(externalId, stipId, encoded, true);
      const kept = group.filter((d) => !failed.some((f) => f.documentId === d.documentId));
      results.push(
        ...kept.map((d) => ({
          ...base(d),
          accepted: sent.ok,
          ...(sent.ok ? {} : { error: sent.error ?? byUrl.error ?? "Credibly rejected the upload" }),
        }))
      );
    }

    return results;
  },

  async fetchStatus(externalId) {
    const res = await getSubmissionStatus(externalId);
    return res.ok ? { ok: true, raw: res.data } : { ok: false, error: res.error ?? "Status request failed" };
  },

  webhook: {
    async verify(req) {
      const token = process.env.CREDIBLY_WEBHOOK_TOKEN;
      // No token configured = we cannot tell a real callback from a stranger.
      // Refuse rather than accept: the engine polls status anyway.
      if (!token) {
        console.error("credibly: CREDIBLY_WEBHOOK_TOKEN is not set — rejecting callback");
        return false;
      }
      const header = req.headers.get("x-signature")?.trim();
      if (!header) return false;
      // Clone: the route reads the body again after this.
      const raw = await req.clone().text();
      return timingSafeEqual(header.toLowerCase(), crediblySignature(token, raw));
    },
    extractExternalId(body) {
      const id = (body as Record<string, unknown> | null)?.submission_id;
      return typeof id === "string" && id.trim() ? id.trim() : null;
    },
  },
};
