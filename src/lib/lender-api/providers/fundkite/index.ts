// src/lib/lender-api/providers/fundkite/index.ts
//
// Fundkite as a LenderApiProvider. Glue only: HTTP lives in client.ts, every
// data decision lives in mapping.ts.
//
// The conventional shape: create (202, async intake) → documents → status by
// GET, and a deal.received webhook that is only a signal to re-fetch.

import { createHmac } from "node:crypto";
import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { FUNDKITE_LENDER_NAME } from "./constants";
import {
  FUNDKITE_PICKS,
  FUNDKITE_REQUIRED_VAULT_FIELDS,
  buildFundkiteDeal,
  fundkiteDocumentType,
  fundkiteTagsForDocCode,
  interpretFundkiteStatus,
  suggestFundkitePicks,
  type FundkiteDealRequest,
} from "./mapping";
import { createDeal, fetchFile, getDeal, isFundkiteConfigured, uploadDealDocument } from "./client";

/**
 * UNCONFIRMED scheme — the doc only says "HMAC signature in
 * X-Fundkite-Signature". Read as HMAC-SHA256 of the raw body, hex, with an
 * optional "sha256=" prefix. Harmless if wrong: the body is never believed,
 * a rejected callback just waits for the next Refresh.
 */
export function fundkiteSignature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function idOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export const fundkite: LenderApiProvider = {
  id: "fundkite",
  displayName: FUNDKITE_LENDER_NAME,

  matchesLender(lenderName) {
    return lenderName.trim().toLowerCase() === FUNDKITE_LENDER_NAME.toLowerCase();
  },

  isConfigured: isFundkiteConfigured,
  requiredVaultFields: FUNDKITE_REQUIRED_VAULT_FIELDS,
  picks: FUNDKITE_PICKS,
  suggestPicks: suggestFundkitePicks,
  buildApplication: buildFundkiteDeal,
  tagsForDocCode: fundkiteTagsForDocCode,
  interpretStatus: interpretFundkiteStatus,

  async createApplication(payload) {
    const deal = payload as FundkiteDealRequest;
    const res = await createDeal(deal, deal.external_id);
    const id = idOf(res.data?.data?.id);
    if (res.ok && id) return { ok: true, externalId: id };
    return {
      ok: false,
      error: res.error ?? "Fundkite did not return a deal id",
      fieldErrors: res.fieldErrors,
      status: res.status,
    };
  },

  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    // One file per request: bank statements fill URL slots 1–12 in upload
    // order, and each file gets its own verdict.
    const results: OutboundDocumentResult[] = [];
    for (const d of docs) {
      const base = { documentId: d.documentId, filename: d.filename, stamped: d.stamped };
      const file = await fetchFile(d.url);
      if ("error" in file) {
        results.push({ ...base, accepted: false, unavailable: true, error: file.error });
        continue;
      }
      const res = await uploadDealDocument(externalId, fundkiteDocumentType(d.docCode), { ...file, filename: d.filename });
      results.push(res.ok ? { ...base, accepted: true } : { ...base, accepted: false, error: res.error ?? "Fundkite rejected the file" });
    }
    return results;
  },

  async fetchStatus(externalId) {
    const res = await getDeal(externalId);
    return res.ok ? { ok: true, raw: res.data } : { ok: false, error: res.error ?? "Status request failed" };
  },

  webhook: {
    async verify(req) {
      const secret = process.env.FUND_KITE_WEBHOOK_SECRET?.trim();
      if (!secret) {
        console.error("fundkite: FUND_KITE_WEBHOOK_SECRET is not set — rejecting callback");
        return false;
      }
      const header = req.headers.get("x-fundkite-signature")?.trim().toLowerCase().replace(/^sha256=/, "");
      if (!header) return false;
      // Clone: the route reads the body again after this.
      const raw = await req.clone().text();
      return timingSafeEqual(header, fundkiteSignature(secret, raw));
    },
    extractExternalId(body) {
      type Ids = { id?: unknown; deal_id?: unknown };
      const b = (body ?? {}) as Ids & { data?: Ids; deal?: Ids };
      return idOf(b.data?.id) ?? idOf(b.data?.deal_id) ?? idOf(b.deal_id) ?? idOf(b.deal?.id) ?? idOf(b.id);
    },
  },
};
