// src/lib/lender-api/providers/smartbiz/index.ts
//
// SmartBiz as a LenderApiProvider. Glue only: HTTP lives in client.ts, every
// data decision lives in mapping.ts.
//
// A send is two calls — create the business, then the submission on it — and
// the submission id is what we keep (documents + status key on it). The
// webhook names the business and our reference, not the submission, so it is
// resolved through SmartBiz's search API, then re-fetched like every provider.

import { createHmac } from "node:crypto";
import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { SMARTBIZ_LENDER_NAME } from "./constants";
import {
  SMARTBIZ_PICKS,
  SMARTBIZ_REQUIRED_VAULT_FIELDS,
  buildSmartBizApplication,
  interpretSmartBizStatus,
  smartBizDocumentUpload,
  smartBizTagsForDocCode,
  suggestSmartBizPicks,
  type SmartBizApplication,
} from "./mapping";
import {
  createBusiness,
  createSubmission,
  fetchFile,
  getSubmission,
  isDuplicateBusinessError,
  isSmartBizConfigured,
  searchSubmissionByReference,
  uploadSubmissionDocument,
} from "./client";

/** Their scheme: base64(HMAC-SHA256(secret, http-timestamp + raw body)). */
export function smartBizSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** CloudEvents envelope; `data` is documented as a JSON string, accepted as an object too. */
export function parseSmartBizEvent(body: unknown): { business_id?: string; client_reference_id?: string; current_state?: string } | null {
  const raw = (body as { data?: unknown } | null)?.data;
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const out: { business_id?: string; client_reference_id?: string; current_state?: string } = {};
  for (const k of ["business_id", "client_reference_id", "current_state"] as const) {
    if (typeof d[k] === "string" && d[k]) out[k] = d[k] as string;
  }
  return out;
}

export function smartBizDuplicateExplanation(smartBizError: string): string {
  return (
    "SmartBiz already has this business (they refuse a second business with the same email or EIN). " +
    "Resending won't get through — ask your SmartBiz rep to open a new submission on the existing business. " +
    `SmartBiz said: ${smartBizError}`
  );
}

export const smartbiz: LenderApiProvider = {
  id: "smartbiz",
  displayName: SMARTBIZ_LENDER_NAME,

  matchesLender(lenderName) {
    return lenderName.trim().toLowerCase() === SMARTBIZ_LENDER_NAME.toLowerCase();
  },

  isConfigured: isSmartBizConfigured,
  requiredVaultFields: SMARTBIZ_REQUIRED_VAULT_FIELDS,
  picks: SMARTBIZ_PICKS,
  suggestPicks: suggestSmartBizPicks,
  buildApplication: buildSmartBizApplication,
  tagsForDocCode: smartBizTagsForDocCode,
  interpretStatus: interpretSmartBizStatus,

  // SmartBiz refuses a second business with the same email/EIN and can't look
  // one up, so the business id is kept (provider_state) and reused on every
  // later send for the same business — a new round, or a resend after the
  // submission failed.
  reusesProviderState: true,

  async createApplication(payload, ctx) {
    const app = payload as SmartBizApplication;

    const prior = ctx?.priorState?.business_id;
    const knownBusinessId = typeof prior === "string" && prior ? prior : null;
    if (knownBusinessId) {
      const sub = await createSubmission({ ...app.submission, business_id: knownBusinessId });
      const submissionId = sub.data?.data?.id;
      const providerState = { business_id: knownBusinessId };
      if (sub.ok && submissionId) return { ok: true, externalId: submissionId, providerState };
      // 404 = SmartBiz doesn't know that business (e.g. an id from their
      // sandbox): fall through and create it as a first send would.
      if (sub.status !== 404) {
        const why = sub.error ?? "SmartBiz did not return a submission id";
        return {
          ok: false,
          status: sub.ok ? 0 : sub.status,
          error: `SmartBiz did not take the submission on existing business ${knownBusinessId}: ${why}`,
          fieldErrors: sub.fieldErrors,
          providerState,
        };
      }
    }

    const biz = await createBusiness(app.business);
    const businessId = biz.data?.data?.id;
    if (!biz.ok || !businessId) {
      const error = biz.error ?? "SmartBiz did not return a business id";
      if (isDuplicateBusinessError(biz.status, error)) {
        return { ok: false, status: biz.status, error: smartBizDuplicateExplanation(error) };
      }
      // A 2xx without an id means we don't know whether it exists.
      return { ok: false, status: biz.ok ? 0 : biz.status, error, fieldErrors: biz.fieldErrors };
    }

    const providerState = { business_id: businessId };
    const sub = await createSubmission({ ...app.submission, business_id: businessId });
    const submissionId = sub.data?.data?.id;
    if (sub.ok && submissionId) return { ok: true, externalId: submissionId, providerState };

    // The business now exists at SmartBiz and they can't give its id back: it
    // is recorded (providerState) so a resend submits on it, and named here.
    const why = sub.error ?? "SmartBiz did not return a submission id";
    return {
      ok: false,
      status: sub.ok ? 0 : sub.status,
      error: `SmartBiz created business ${businessId} but not the submission: ${why}. A resend will use the same business.`,
      fieldErrors: sub.fieldErrors,
      providerState,
    };
  },

  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    const results: OutboundDocumentResult[] = [];
    const now = new Date();
    for (const d of docs) {
      const base = { documentId: d.documentId, filename: d.filename, stamped: d.stamped };
      const file = await fetchFile(d.url);
      if ("error" in file) {
        results.push({ ...base, accepted: false, unavailable: true, error: file.error });
        continue;
      }
      const res = await uploadSubmissionDocument(externalId, smartBizDocumentUpload(d.docCode, d.filename, now), {
        ...file,
        filename: d.filename,
      });
      results.push(res.ok ? { ...base, accepted: true } : { ...base, accepted: false, error: res.error ?? "SmartBiz rejected the file" });
    }
    return results;
  },

  async fetchStatus(externalId) {
    const res = await getSubmission(externalId);
    return res.ok ? { ok: true, raw: res.data } : { ok: false, error: res.error ?? "Status request failed" };
  },

  webhook: {
    async verify(req) {
      const secret = process.env.SMARTBIZ_WEBHOOK_SECRET?.trim();
      if (!secret) {
        console.error("smartbiz: SMARTBIZ_WEBHOOK_SECRET is not set — rejecting callback");
        return false;
      }
      const timestamp = req.headers.get("http-timestamp")?.trim();
      const signature = req.headers.get("http-sbabiz-signature")?.trim();
      if (!timestamp || !signature) return false;
      // Clone: the route reads the body again after this. Hash the RAW text.
      const raw = await req.clone().text();
      return timingSafeEqual(signature, smartBizSignature(secret, timestamp, raw));
    },
    extractExternalId() {
      // The callback carries no submission id; resolveExternalId does the lookup.
      return null;
    },
    async resolveExternalId(body) {
      const ref = parseSmartBizEvent(body)?.client_reference_id;
      if (!ref) return null;
      const res = await searchSubmissionByReference(ref);
      // A failed search is OUR failure to resolve, not an unknown reference:
      // throw so the route answers 5xx and SmartBiz retries the callback.
      if (!res.ok) throw new Error(`SmartBiz search failed (HTTP ${res.status || "unreachable"})`);
      const id = res.data?.data?.[0]?.id;
      return typeof id === "string" && id ? id : null;
    },
  },
};
