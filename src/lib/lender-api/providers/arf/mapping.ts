// src/lib/lender-api/providers/arf/mapping.ts
//
// Pure. ARF's API takes FILES ONLY: Dragin reads the deal out of the signed
// application, so there is no payload to map, no dropdown and no field gap.
// What is left is the reference we send as the idempotency key and reading a
// job's state.

import type { BuiltApplication, LenderApiSource, NormalizedStatus, PickDefinition, Picks } from "../../types";
import type { VaultField } from "../../vault-fields";
import { nonEmpty } from "../../normalize";
import { ARF_APPLICATION_DOC_CODES, ARF_DELIVERED_STATUS, ARF_FAILED_STATUS, ARF_WORKING_STATUSES } from "./constants";

export interface ArfSubmission {
  /** Sent as the Idempotency-Key header. */
  referenceId: string;
}

export const ARF_PICKS: readonly PickDefinition[] = [];
export const ARF_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [];

export function suggestArfPicks(): Record<string, string | null> {
  return {};
}

export function buildArfApplication(_source: LenderApiSource, _picks: Picks, ctx: { referenceId: string }): BuiltApplication {
  const payload: ArfSubmission = { referenceId: ctx.referenceId };
  return { payload, redacted: payload, gaps: [], effectivePicks: {} };
}

export function isArfApplication(docCode: string | null): boolean {
  return !!docCode && ARF_APPLICATION_DOC_CODES.includes(docCode);
}

/** Dragin classifies files itself; the only one we name is the one it can't do without. */
export function arfTagsForDocCode(docCode: string | null): string[] {
  return isArfApplication(docCode) ? ["Application (required)"] : [];
}

export interface ArfJob {
  jobId?: string;
  status?: string;
}

/**
 * The HTTP code of GET /jobs/{jobId} is the state: 202 working, 200 delivered,
 * 500 "could not be processed automatically". Returns what we store, or null
 * when the answer says nothing about the job (404, 401, a gateway error).
 */
export function readArfJob(httpStatus: number, data: unknown, jobId: string): ArfJob | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const status = nonEmpty(d.status)?.toLowerCase() ?? null;
  if (httpStatus === 200) return { jobId, status: status ?? ARF_DELIVERED_STATUS };
  if (httpStatus === 202) return { jobId, status: status ?? "processing" };
  if (httpStatus === 500) return { jobId, status: ARF_FAILED_STATUS };
  return null;
}

/**
 * ARF's API never carries an approval or a decline: "submitted" only means
 * the deal reached their system. The verdict comes by email and UW records it
 * by hand, so nothing here ever reads as approved or declined.
 */
export function interpretArfStatus(raw: unknown): NormalizedStatus {
  const status = nonEmpty((raw as ArfJob | null)?.status)?.toLowerCase() ?? "queued";
  if (status === ARF_FAILED_STATUS) {
    return {
      kind: "needs_info",
      stage: "Needs attention at ARF",
      note:
        "ARF could not process this packet automatically, so a person at ARF is completing it by hand. " +
        "The deal is NOT lost: do not resend it (that would create a second deal). Contact ARF if it stalls.",
    };
  }
  if (status === ARF_DELIVERED_STATUS) return { kind: "in_progress", stage: "Delivered to ARF" };
  if (ARF_WORKING_STATUSES.includes(status)) return { kind: "in_progress", stage: status === "queued" ? "Queued at ARF" : "ARF is processing" };
  return { kind: "in_progress", stage: status };
}
