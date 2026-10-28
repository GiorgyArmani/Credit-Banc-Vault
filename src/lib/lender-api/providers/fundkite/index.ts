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
 * Portal doc (2026-10-28): headers X-Fundkite-Event, X-Fundkite-Delivery,
 * X-Fundkite-Timestamp (unix seconds) and X-Fundkite-Signature
 * "v1=<HMAC-SHA256>". The doc doesn't say what string is signed, so we accept
 * the conventional `${timestamp}.${rawBody}` first and the bare body second
 * (hex either way). Low risk if loose: the body is never believed — a
 * callback only triggers a re-fetch of the deal with our own credentials.
 * Once a real delivery confirms which one matches, drop the other.
 */
export function fundkiteSignature(secret: string, rawBody: string, timestamp?: string): string {
  const signed = timestamp ? `${timestamp}.${rawBody}` : rawBody;
  return createHmac("sha256", secret).update(signed).digest("hex");
}

/** Replay window for X-Fundkite-Timestamp. */
export const FUNDKITE_WEBHOOK_TOLERANCE_S = 5 * 60;

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
      // A header may carry several comma-separated versions ("v1=…,v1=…" during
      // a secret rotation); any v1 match passes.
      const sigs = (req.headers.get("x-fundkite-signature") ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.startsWith("v1="))
        .map((s) => s.slice(3));
      if (sigs.length === 0) return false;

      const timestamp = req.headers.get("x-fundkite-timestamp")?.trim() ?? "";
      const ts = Number(timestamp);
      if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - ts) > FUNDKITE_WEBHOOK_TOLERANCE_S) {
        console.warn("fundkite: webhook timestamp missing or outside the replay window");
        return false;
      }

      // Clone: the route reads the body again after this.
      const raw = await req.clone().text();
      const expected = [fundkiteSignature(secret, raw, timestamp), fundkiteSignature(secret, raw)];
      return sigs.some((s) => expected.some((e) => timingSafeEqual(s, e)));
    },
    extractExternalId(body) {
      // deal.received: { id: "evt_…", type, data: { deal_id, external_id, submission_number, status } }.
      // Top-level `id` is the EVENT id, never a deal — don't fall back to it.
      type Ids = { id?: unknown; deal_id?: unknown };
      const b = (body ?? {}) as Ids & { data?: Ids; deal?: Ids };
      return idOf(b.data?.deal_id) ?? idOf(b.data?.id) ?? idOf(b.deal_id) ?? idOf(b.deal?.id);
    },
  },
};
