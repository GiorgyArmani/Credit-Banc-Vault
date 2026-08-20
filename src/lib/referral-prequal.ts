// src/lib/referral-prequal.ts
//
// Single source of truth for the public affiliate pre-qualification stepper
// (/r/<code>). Shared by the client form and the server submit route so the
// options match and the qualification gate can't be bypassed from the client.
// Mirrors the GHL pre-qual form: options + disqualify rules.

export const LOAN_AMOUNT_OPTIONS = [
  "$150k",
  "$150k - $350k",
  "$350k - $1M",
  "$1M - $5M",
  "$5M - $10M",
  "$10M - $20M",
  "$20M+",
] as const;

export const FICO_OPTIONS = ["Below 600", "600 - 620", "620 - 679", "680 - 739", "740+"] as const;

// NOTE: "Below $25,000" is the disqualifying bracket — keep that exact string.
export const REVENUE_OPTIONS = [
  "Below $25,000",
  "$25,000 - $50,000",
  "$50,000 - $100,000",
  "$100,000 - $250,000",
  "$250,000+",
] as const;

export const TIME_IN_BUSINESS_OPTIONS = [
  "Less than 6 months",
  "Between 6 months and 2 years",
  "More than 2 years",
] as const;

export interface PrequalAnswers {
  loan_amount: string;
  fico_band: string;
  monthly_revenue: string;
  time_in_business: string;
}

/** Which rule rejected the lead. Machine-readable counterpart to `reason`. */
export type DisqualifyCode = "fico" | "revenue" | "tib";

/**
 * GHL tag per disqualification reason. These route the rejected applicant into
 * a reason-specific GHL workflow, so the strings must match the workflow trigger
 * filters EXACTLY — spaces around the hyphen included. Changing one here without
 * changing it in GHL silently strands those contacts in no workflow at all.
 *
 * Exactly one is ever applied. evaluatePrequal returns on its first failing
 * rule, so a lead who fails FICO and revenue is tagged `disqualified - fico`
 * only — one tag means one workflow, not three overlapping nurture sequences.
 * The full answer set is still on the affiliate_leads row for reporting.
 */
export const DISQUALIFY_TAGS: Record<DisqualifyCode, string> = {
  fico: "disqualified - fico",
  revenue: "disqualified - revenue",
  tib: "disqualified - tib",
};

/**
 * Is every answer one this form actually offers?
 *
 * evaluatePrequal below is a DENY-list of three exact strings, so anything it
 * does not recognise qualifies. That is fine for the real stepper, which can
 * only submit the options above — but the submit route is public and
 * unauthenticated, and it only checked that the four answers were non-empty. A
 * crafted POST with `fico_band: "x"` therefore sailed through the gate every
 * time, and the arbitrary string was stored on the lead and counted in reporting.
 *
 * Validate first, then evaluate. Keep this an ALLOW-list: adding an option means
 * adding it to the arrays above, which is also what the form renders from.
 */
export function isKnownPrequalAnswers(a: PrequalAnswers): boolean {
  return (
    (LOAN_AMOUNT_OPTIONS as readonly string[]).includes(a.loan_amount) &&
    (FICO_OPTIONS as readonly string[]).includes(a.fico_band) &&
    (REVENUE_OPTIONS as readonly string[]).includes(a.monthly_revenue) &&
    (TIME_IN_BUSINESS_OPTIONS as readonly string[]).includes(a.time_in_business)
  );
}

/**
 * Disqualify rules (from the GHL form): FICO below 600, monthly revenue below
 * $25,000, or less than 6 months in business. Anyone else qualifies.
 *
 * Rule ORDER is load-bearing, not cosmetic: it decides which single tag a
 * multi-failure lead gets. FICO first, then revenue, then time in business.
 *
 * `reason` is the human string stored on affiliate_leads.disqualified_reason —
 * left exactly as it was so historical rows keep matching new ones. `code` is
 * the same verdict in a form worth switching on.
 */
export function evaluatePrequal(a: PrequalAnswers): {
  qualified: boolean;
  reason: string | null;
  code: DisqualifyCode | null;
} {
  if (a.fico_band === "Below 600")
    return { qualified: false, reason: "FICO below 600", code: "fico" };
  if (a.monthly_revenue === "Below $25,000")
    return { qualified: false, reason: "Monthly revenue below $25,000", code: "revenue" };
  if (a.time_in_business === "Less than 6 months")
    return { qualified: false, reason: "Less than 6 months in business", code: "tib" };
  return { qualified: true, reason: null, code: null };
}
