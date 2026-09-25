// src/lib/lender-api/providers/loot/index.ts
//
// Loot as a LenderApiProvider. Glue only: HTTP lives in client.ts, every data
// decision lives in mapping.ts.
//
// Loot has NO status endpoint: decisions arrive only as DEAL_DECISION
// webhooks, so this provider omits fetchStatus and reads the status from the
// (signature-verified) webhook body via webhook.statusFromBody.

import { createHmac } from "node:crypto";
import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { LOOT_LENDER_NAME } from "./constants";
import {
  LOOT_PICKS,
  LOOT_REQUIRED_VAULT_FIELDS,
  buildLootApplication,
  interpretLootStatus,
  lootDealId,
  lootStatusFromWebhook,
  lootTagsForDocCode,
  suggestLootPicks,
  type LootApplicationForm,
} from "./mapping";
import { fetchFile, isLootConfigured, submitCustomerApplication, uploadDealAttachment } from "./client";

/**
 * Their documented scheme: HMAC-SHA512 (key = our subscription secret) over
 * `${nonce}${eventType}${createdAt}`, hex. It does NOT cover `data`, so it
 * proves the callback came from Loot rather than protecting the deal fields.
 */
export function lootSignature(secret: string, nonce: string, eventType: string, createdAt: string): string {
  return createHmac("sha512", secret).update(`${nonce}${eventType}${createdAt}`).digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const loot: LenderApiProvider = {
  id: "loot",
  displayName: LOOT_LENDER_NAME,

  matchesLender(lenderName) {
    return lenderName.trim().toLowerCase() === LOOT_LENDER_NAME.toLowerCase();
  },

  isConfigured: isLootConfigured,
  requiredVaultFields: LOOT_REQUIRED_VAULT_FIELDS,
  picks: LOOT_PICKS,
  suggestPicks: suggestLootPicks,
  buildApplication: buildLootApplication,
  tagsForDocCode: lootTagsForDocCode,
  interpretStatus: interpretLootStatus,

  async createApplication(payload) {
    const res = await submitCustomerApplication(payload as LootApplicationForm);
    const dealId = res.data?.data?.deal?.deal_id;
    if (res.ok && dealId) return { ok: true, externalId: String(dealId) };
    return {
      ok: false,
      error: res.error ?? "Loot did not return a deal id",
      status: res.status,
    };
  },

  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    // One file per request, so each file gets its own verdict.
    const results: OutboundDocumentResult[] = [];
    for (const d of docs) {
      const base = { documentId: d.documentId, filename: d.filename, stamped: d.stamped };
      const file = await fetchFile(d.url);
      if ("error" in file) {
        // Our own storage couldn't produce the file — terminal.
        results.push({ ...base, accepted: false, unavailable: true, error: file.error });
        continue;
      }
      const res = await uploadDealAttachment(externalId, { ...file, filename: d.filename });
      results.push(res.ok ? { ...base, accepted: true } : { ...base, accepted: false, error: res.error ?? "Loot rejected the file" });
    }
    return results;
  },

  webhook: {
    async verify(req) {
      const secret = process.env.LOOT_WEBHOOK_SECRET?.trim();
      // No secret configured = we cannot tell a real callback from a stranger.
      if (!secret) {
        console.error("loot: LOOT_WEBHOOK_SECRET is not set — rejecting callback");
        return false;
      }
      let body: Record<string, unknown> | null;
      try {
        // Clone: the route reads the body again after this.
        body = await req.clone().json();
      } catch {
        return false;
      }
      // Their docs call it both a header and a payload field; accept either.
      const signature = String(req.headers.get("x-loot-webhook-signature") ?? body?.signature ?? body?.["x-loot-webhook-signature"] ?? "")
        .trim()
        .toLowerCase();
      const { nonce, eventType, createdAt } = body ?? {};
      if (!signature || typeof nonce !== "string" || typeof eventType !== "string" || typeof createdAt !== "string") {
        return false;
      }
      return timingSafeEqual(signature, lootSignature(secret, nonce, eventType, createdAt));
    },
    extractExternalId: lootDealId,
    statusFromBody: lootStatusFromWebhook,
  },
};
