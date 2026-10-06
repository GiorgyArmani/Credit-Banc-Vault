// src/lib/lender-api/providers/onewest/index.ts
//
// 1West as a LenderApiProvider. Glue only: HTTP lives in client.ts, every data
// decision lives in mapping.ts.
//
// 1West has NO status endpoint: statuses arrive only as webhooks, so this
// provider omits fetchStatus and reads the status from the webhook body via
// webhook.statusFromBody (the Loot pattern). Their callbacks are UNSIGNED, so
// the URL we register carries our own secret (?token=…) and verify() checks it.

import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { ONEWEST_DISPLAY_NAME, ONEWEST_MAX_FILE_BYTES } from "./constants";
import {
  ONEWEST_PICKS,
  ONEWEST_REQUIRED_VAULT_FIELDS,
  buildOneWestApplication,
  interpretOneWestStatus,
  oneWestDealId,
  oneWestDocumentTypes,
  oneWestFilename,
  oneWestStatusFromWebhook,
  oneWestTagsForDocCode,
  suggestOneWestPicks,
  type OneWestPackage,
} from "./mapping";
import { createPackage, fetchAsBase64, isOneWestConfigured, readOneWestErrors, uploadDocument } from "./client";

/** "1 West", "1West", "One West" — however the lender row spells it. */
export function isOneWestLenderName(lenderName: string): boolean {
  const s = lenderName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return s === "1west" || s === "onewest";
}

export const ONEWEST_DUPLICATE_EXPLANATION =
  "1West already has this business, so they didn't create a new deal. Resending won't get through. " +
  "If an earlier attempt timed out, that deal is probably ours; ask your 1West rep about the existing deal.";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const onewest: LenderApiProvider = {
  id: "onewest",
  displayName: ONEWEST_DISPLAY_NAME,
  matchesLender: isOneWestLenderName,
  isConfigured: isOneWestConfigured,
  requiredVaultFields: ONEWEST_REQUIRED_VAULT_FIELDS,
  picks: ONEWEST_PICKS,
  suggestPicks: suggestOneWestPicks,
  buildApplication: buildOneWestApplication,
  tagsForDocCode: oneWestTagsForDocCode,
  interpretStatus: interpretOneWestStatus,

  async createApplication(payload) {
    const res = await createPackage(payload as OneWestPackage);
    const body = res.data && typeof res.data === "object" ? res.data : {};
    const uuid = typeof body.uuid === "string" && body.uuid.trim() ? body.uuid.trim() : null;

    if (res.ok && body.status === "success" && uuid) return { ok: true, externalId: uuid };
    // A duplicate is a clean "no" (nothing was created); report it as a 409.
    if (body.status === "duplicate") {
      const detail = typeof body.status_detail === "string" && body.status_detail.trim() ? ` 1West said: ${body.status_detail.trim()}` : "";
      return { ok: false, error: ONEWEST_DUPLICATE_EXPLANATION + detail, status: 409 };
    }
    if (body.status === "error") {
      const errors = readOneWestErrors(res.data);
      const fieldErrors = Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v]]));
      // An HTTP 200 carrying `status: "error"` is still a rejection, not an unknown.
      const status = res.status >= 400 ? res.status : 422;
      return { ok: false, error: res.error ?? "1West rejected the application", status, fieldErrors };
    }
    // 2xx without a deal id, a 5xx or a timeout: we can't tell whether 1West created it.
    return { ok: false, error: res.error ?? "1West did not return a deal id", status: res.status };
  },

  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    const types = oneWestDocumentTypes(docs, new Date());
    const results: OutboundDocumentResult[] = [];
    for (const [i, d] of docs.entries()) {
      const base = { documentId: d.documentId, filename: d.filename, stamped: d.stamped };
      const type = types[i];
      if (!type) {
        results.push({ ...base, accepted: false, unavailable: true, error: "1West has no document type for this file" });
        continue;
      }
      const filename = oneWestFilename(d.filename);
      if (!filename) {
        results.push({ ...base, accepted: false, unavailable: true, error: "1West accepts PDF, JPG or PNG files only" });
        continue;
      }
      const file = await fetchAsBase64(d.url);
      if ("error" in file) {
        results.push({ ...base, accepted: false, unavailable: true, error: file.error });
        continue;
      }
      if (file.bytes > ONEWEST_MAX_FILE_BYTES) {
        results.push({ ...base, accepted: false, unavailable: true, error: "1West takes files up to 10 MB" });
        continue;
      }
      const res = await uploadDocument(externalId, { type, filename, file: file.base64 });
      results.push(res.ok ? { ...base, accepted: true } : { ...base, accepted: false, error: res.error ?? "1West rejected the file" });
    }
    return results;
  },

  webhook: {
    async verify(req) {
      const secret = process.env.ONEWEST_WEBHOOK_TOKEN?.trim();
      // No token configured = we cannot tell a real callback from a stranger.
      if (!secret) {
        console.error("onewest: ONEWEST_WEBHOOK_TOKEN is not set — rejecting callback");
        return false;
      }
      const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
      return !!token && timingSafeEqual(token, secret);
    },
    extractExternalId: oneWestDealId,
    statusFromBody: oneWestStatusFromWebhook,
  },
};
