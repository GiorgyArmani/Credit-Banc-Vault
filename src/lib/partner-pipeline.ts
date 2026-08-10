// src/lib/partner-pipeline.ts
//
// The partner-facing view of a deal's progress.
//
// A referral partner gets a SIGNAL of where their referral sits, not the
// pipeline itself. Two things follow from that:
//
//   1. The internal 9-status enum collapses to 5 outward stages. A CPA does not
//      need to know the difference between documents_requested and
//      documents_received, and telling them invites "why is it still on step 3"
//      conversations that belong to the advisor, not the partner.
//   2. The copy never leaks operational detail — no lender names, no note
//      fields, no "who changed it". `declined` becomes "Not moving forward",
//      because a partner is going to forward these words to the person they
//      referred.
//
// The internal vocabulary stays where it belongs: PIPELINE_STEPS / STAGE_MAP in
// src/components/loan-pipeline-status.tsx and the advisor Kanban.

import type { LoanStatus } from "@/app/actions/pipeline";

export type PartnerStage = {
  /** 1-based position on the partner-facing bar; 0 for off-ramps. */
  step: number;
  label: string;
  /** One line the partner can repeat to their referral verbatim. */
  blurb: string;
  tone: "neutral" | "active" | "won" | "lost";
};

/** The bar a partner sees. Four steps forward, then funded. */
export const PARTNER_STAGES: { step: number; label: string }[] = [
  { step: 1, label: "Received" },
  { step: 2, label: "Collecting docs" },
  { step: 3, label: "Underwriting" },
  { step: 4, label: "Offer stage" },
  { step: 5, label: "Funded" },
];

export const PARTNER_STAGE_COUNT = PARTNER_STAGES.length;

/**
 * Internal status → what the partner sees.
 *
 * `consulting_program` maps to step 3 rather than past funded: from the
 * partner's side the client is being worked, and the internal ordering quirk
 * (the DB CHECK array and PIPELINE_STEPS disagree on where consulting sits)
 * must not surface as a progress bar that goes backwards.
 */
const STAGE_BY_STATUS: Record<LoanStatus, PartnerStage> = {
  created: {
    step: 1,
    label: "Received",
    blurb: "We have the referral and are reaching out.",
    tone: "neutral",
  },
  onboarding: {
    step: 1,
    label: "Received",
    blurb: "Getting the client set up with their advisor.",
    tone: "neutral",
  },
  documents_requested: {
    step: 2,
    label: "Collecting docs",
    blurb: "Waiting on paperwork from the client.",
    tone: "active",
  },
  documents_received: {
    step: 2,
    label: "Collecting docs",
    blurb: "Paperwork is in and being reviewed.",
    tone: "active",
  },
  under_review: {
    step: 3,
    label: "Underwriting",
    blurb: "The file is with underwriting.",
    tone: "active",
  },
  consulting_program: {
    step: 3,
    label: "Underwriting",
    blurb: "We're working with the client to get them fundable.",
    tone: "active",
  },
  lender_matched: {
    step: 4,
    label: "Offer stage",
    blurb: "Matched with a lender — offer in progress.",
    tone: "active",
  },
  funded: {
    step: 5,
    label: "Funded",
    blurb: "This deal closed. 🎉",
    tone: "won",
  },
  declined: {
    step: 0,
    label: "Not moving forward",
    blurb: "This one didn't work out.",
    tone: "lost",
  },
};

/** Never throws on an unrecognized status — an unknown state reads as "Received". */
export function partnerStageFor(status: string | null | undefined): PartnerStage {
  return STAGE_BY_STATUS[(status ?? "created") as LoanStatus] ?? STAGE_BY_STATUS.created;
}

/** Progress as a 0–100 fraction for the bar. An off-ramp shows no progress. */
export function partnerStageProgress(stage: PartnerStage): number {
  if (stage.step <= 0) return 0;
  return Math.round((stage.step / PARTNER_STAGE_COUNT) * 100);
}
