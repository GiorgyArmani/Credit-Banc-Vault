//
// Forward Financing as a LenderApiProvider. Glue only: HTTP lives in client.ts,
// every data decision lives in mapping.ts.

import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { FF_ATTACHMENT_BATCH_SIZE, FF_LENDER_NAME, FF_WEBHOOK_IPS } from "./constants";
import {
  FF_PICKS,
  FF_REQUIRED_VAULT_FIELDS,
  buildFfLead,
  ffTagsForDocCode,
  interpretFfStatus,
  mapFfAttachmentResults,
  suggestFfPicks,
  type FfLeadRequest,
} from "./mapping";
import { createLead, getDealStatus, isFfConfigured, uploadAttachments } from "./client";

export function firstForwardedIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || null;
}

export const forwardFinancing: LenderApiProvider = {
  id: "forward_financing",
  displayName: FF_LENDER_NAME,

  matchesLender(lenderName) {
    return lenderName.trim().toLowerCase() === FF_LENDER_NAME.toLowerCase();
  },

  isConfigured: isFfConfigured,
  requiredVaultFields: FF_REQUIRED_VAULT_FIELDS,
  picks: FF_PICKS,
  suggestPicks: suggestFfPicks,
  buildApplication: buildFfLead,
  tagsForDocCode: ffTagsForDocCode,
  interpretStatus: interpretFfStatus,

  async createApplication(payload) {
    const res = await createLead(payload as FfLeadRequest);
    if (res.ok && res.data?.id) return { ok: true, externalId: String(res.data.id) };
    const errors = (res.data as unknown as Record<string, unknown>)?.errors;
    return {
      ok: false,
      fieldErrors: errors && typeof errors === "object" ? (errors as Record<string, string[]>) : undefined,
      error: res.error ?? "Forward Financing did not return a lead id",
      status: res.status,
    };
  },

  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    const results: OutboundDocumentResult[] = [];
    for (let i = 0; i < docs.length; i += FF_ATTACHMENT_BATCH_SIZE) {
      const batch = docs.slice(i, i + FF_ATTACHMENT_BATCH_SIZE);
      const res = await uploadAttachments(
        externalId,
        batch.map((d) => ({ filename: d.filename, attachment_url: d.url, tags: ffTagsForDocCode(d.docCode) }))
      );
      results.push(...mapFfAttachmentResults(batch, res));
    }
    return results;
  },

  async fetchStatus(externalId) {
    const res = await getDealStatus(externalId);
    return res.ok ? { ok: true, raw: res.data } : { ok: false, error: res.error ?? "Status request failed" };
  },

  webhook: {
    async verify(req) {
      // FF does not sign callbacks. The IP allow-list keeps strangers out; the
      // engine never trusts the body anyway (it re-fetches deal_status itself).
      if (process.env.FORWARD_FINANCING_WEBHOOK_IP_CHECK === "off") return true;
      const ip = firstForwardedIp(req);
      return !!ip && (FF_WEBHOOK_IPS as readonly string[]).includes(ip);
    },
    extractExternalId(body) {
      const id = (body as unknown as Record<string, unknown>)?.lead_id;
      if (typeof id === "string" && id.trim()) return id.trim();
      if (typeof id === "number") return String(id);
      return null;
    },
  },
};
