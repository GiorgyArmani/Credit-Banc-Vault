// src/lib/lender-api/providers/idea/index.ts
//
// Idea Financial as a LenderApiProvider. Glue only: HTTP lives in client.ts,
// every data decision lives in mapping.ts.
//
// Idea needs one round trip the engine doesn't have: an application is
// created in Draft, files are attached, and only an explicit PUSH moves it
// into Idea's review (and Idea refuses the push until a signed application
// and a bank statement are attached). So uploadDocuments pushes after the
// files land, and fetchStatus pushes again when it finds the file still in
// Draft — that's how a push refused the first time is finished: a Refresh.
// It never pushes from any other status. The same /push call advances the
// file to whatever comes next (Idea's flow diagrams): from Submission
// Incomplete it skips past the corrections Idea asked for, after an offer is
// selected it sends closing to review, and from Contract Ready it SENDS THE
// CONTRACT TO THE CUSTOMER. Draft is the only status we may push from.
//
// No webhooks: statuses arrive only through Refresh.

import type { LenderApiProvider, OutboundDocument, OutboundDocumentResult } from "../../types";
import { IDEA_DISPLAY_NAME, IDEA_LENDER_NAME, IDEA_MAX_FILE_BYTES } from "./constants";
import {
  IDEA_PICKS,
  IDEA_PUSHABLE_FROM_DRAFT,
  IDEA_REQUIRED_VAULT_FIELDS,
  buildIdeaApplication,
  ideaTagsForDocCode,
  interpretIdeaStatus,
  planIdeaUploads,
  sanitizeIdeaStatus,
  suggestIdeaPicks,
  type IdeaApplication,
} from "./mapping";
import {
  createApplication,
  fetchFileBytes,
  getApplication,
  isIdeaConfigured,
  pushApplication,
  uploadApplicationFile,
} from "./client";

/** "IDEA", "Idea Financial" — however the lender row spells it. */
export function isIdeaLenderName(lenderName: string): boolean {
  const s = lenderName.trim().toLowerCase().replace(/[^a-z]/g, "");
  return s === IDEA_LENDER_NAME.toLowerCase() || s === "ideafinancial";
}

/** Push when Idea still has the file in Draft. Returns Idea's refusal, or null. */
async function pushIfDraft(externalId: string, status: unknown): Promise<string | null> {
  if (status !== IDEA_PUSHABLE_FROM_DRAFT) return null;
  const res = await pushApplication(externalId);
  return res.ok ? null : res.error ?? "Idea refused the submission";
}

export const idea: LenderApiProvider = {
  id: "idea",
  displayName: IDEA_DISPLAY_NAME,
  matchesLender: isIdeaLenderName,
  isConfigured: isIdeaConfigured,
  requiredVaultFields: IDEA_REQUIRED_VAULT_FIELDS,
  picks: IDEA_PICKS,
  suggestPicks: suggestIdeaPicks,
  buildApplication: buildIdeaApplication,
  tagsForDocCode: ideaTagsForDocCode,
  interpretStatus: interpretIdeaStatus,

  async createApplication(payload) {
    const res = await createApplication(payload as IdeaApplication);
    const id = res.data?.id;
    if (res.ok && (typeof id === "number" || (typeof id === "string" && id.trim()))) {
      return { ok: true, externalId: String(id).trim() };
    }
    const errors = (res.data as Record<string, unknown> | null)?.errors;
    return {
      ok: false,
      fieldErrors: errors && typeof errors === "object" ? (errors as Record<string, string[]>) : undefined,
      error: res.error ?? "Idea Financial did not return an application id",
      // A 2xx without an id is "we don't know", never a clean rejection.
      status: res.ok ? 0 : res.status,
    };
  },

  async uploadDocuments(externalId, docs: OutboundDocument[]) {
    const plans = planIdeaUploads(docs);
    const results: OutboundDocumentResult[] = [];
    for (const [i, d] of docs.entries()) {
      const base = { documentId: d.documentId, filename: d.filename, stamped: d.stamped };
      const plan = plans[i];
      if ("error" in plan) {
        results.push({ ...base, accepted: false, unavailable: true, error: plan.error });
        continue;
      }
      const file = await fetchFileBytes(d.url);
      if ("error" in file) {
        results.push({ ...base, accepted: false, error: file.error });
        continue;
      }
      if (file.bytes.length > IDEA_MAX_FILE_BYTES) {
        results.push({ ...base, accepted: false, unavailable: true, error: "Idea takes files up to 20 MB" });
        continue;
      }
      const res = await uploadApplicationFile(externalId, { bytes: file.bytes, ...plan });
      results.push(res.ok ? { ...base, accepted: true } : { ...base, accepted: false, error: res.error ?? "Idea rejected the file" });
    }

    // Files attached: submit to Idea's review. A refusal is not a file failure
    // (every file above landed); the Draft status carries it to UW on Refresh.
    if (results.some((r) => r.accepted)) {
      const current = await getApplication(externalId);
      if (current.ok) {
        const refused = await pushIfDraft(externalId, current.data?.status);
        if (refused) console.error(`idea: push of ${externalId} refused`);
      }
    }
    return results;
  },

  async fetchStatus(externalId) {
    const res = await getApplication(externalId);
    if (!res.ok) return { ok: false, error: res.error ?? "Status request failed" };

    const pushError = await pushIfDraft(externalId, res.data?.status);
    if (res.data?.status === IDEA_PUSHABLE_FROM_DRAFT && !pushError) {
      const after = await getApplication(externalId);
      if (after.ok) return { ok: true, raw: sanitizeIdeaStatus(after.data) };
    }
    return { ok: true, raw: sanitizeIdeaStatus(res.data, { pushError }) };
  },
};
