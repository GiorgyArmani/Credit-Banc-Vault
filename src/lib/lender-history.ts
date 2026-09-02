// src/lib/lender-history.ts
//
// "Where has this client already been, and what did those lenders say?"
//
// Underwriting kept this in a spreadsheet because the app had the data and no
// way to read it back: `client_lender_assignments` records every submission and
// every verdict, but every read path filters on `client_id` alone, so a repeat
// client's rounds arrive as one flat undifferentiated list. This module is the
// single place that turns those rows into per-round history and into the
// one-line warning the match tool shows before someone re-submits to a lender
// that already passed.
//
// SCOPE RULES, in one place so they cannot drift between the panel and the
// match tool:
//   - A row belongs to the round named by `funding_deal_id`.
//   - `funding_deal_id IS NULL` means the row predates per-round tracking
//     (everything written before 20260902). It is attributed to the OLDEST
//     round rather than shown everywhere, because "we don't know which round"
//     and "it happened in every round" are different claims and only the first
//     is true. The round-open endpoint retires NULLs onto the closing deal, so
//     this fallback shrinks to nothing over time.
//   - `status` is the LENDER's verdict. `decision` is what UW picked in the
//     match tool and is not history — never surface it as an outcome.

import type { FundingDeal } from "@/lib/funding-deals";

/** The lender verdicts, in the order they progress. */
export type LenderStatus =
  | "pending"
  | "submitted"
  | "approved_by_lender"
  | "declined_by_lender"
  | "funded";

/** The columns this module needs. A superset row (select *) satisfies it. */
export interface LenderAssignmentRow {
  id: string;
  lender_name: string;
  specialty?: string | null;
  tier_label?: string | null;
  status: string;
  response_notes?: string | null;
  funding_deal_id?: string | null;
  business_profile_id?: string | null;
  assigned_at?: string | null;
  submitted_at?: string | null;
  responded_at?: string | null;
  admin_review?: string | null;
}

/** What the match tool shows next to a lender it has seen before. */
export interface PriorOutcome {
  lender_name: string;
  status: LenderStatus;
  /** 1-based round the outcome happened in; null when it cannot be resolved. */
  round_no: number | null;
  /** The lender's own words, trimmed for inline display. Null when none. */
  note: string | null;
  /** True for the outcomes worth interrupting someone over. */
  is_warning: boolean;
}

/** Rows in this state have not been anywhere yet — not history. */
export function isUnworked(status: string): boolean {
  return status === "pending";
}

/**
 * An outcome worth flagging before re-submitting. A decline is the obvious one;
 * a lender that already FUNDED a prior round is flagged too, because that is
 * usually a renewal conversation with the incumbent rather than a fresh
 * submission and UW should go in knowing it.
 */
export function isWarningStatus(status: string): boolean {
  return status === "declined_by_lender" || status === "funded";
}

export const LENDER_STATUS_LABEL: Record<LenderStatus, string> = {
  pending: "Not yet submitted",
  submitted: "Submitted — awaiting response",
  approved_by_lender: "Approved",
  declined_by_lender: "Declined",
  funded: "Funded",
};

/**
 * Round number for a row, or null when it cannot be placed.
 *
 * `deals` arrives newest-first (the `getDealsForBusiness` contract), so round 1
 * is the last element. A NULL `funding_deal_id` resolves to round 1 — see the
 * scope rules at the top of this file.
 */
export function roundNoForRow(
  row: Pick<LenderAssignmentRow, "funding_deal_id">,
  deals: Pick<FundingDeal, "id">[]
): number | null {
  if (!deals.length) return null;
  if (!row.funding_deal_id) return 1;
  const idx = deals.findIndex((d) => d.id === row.funding_deal_id);
  if (idx === -1) return null;
  return deals.length - idx;
}

/** First line of a lender's note, clipped — enough to judge, not a wall of text. */
export function noteSnippet(note: string | null | undefined, max = 120): string | null {
  if (!note) return null;
  const flat = String(note).replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The prior outcome per lender NAME, for a round that is not this one.
 *
 * Keyed on name rather than on the name/specialty/tier composite the match grid
 * uses for its checkboxes: "Fundworks declined us in March" is a fact about the
 * lender, and surfacing it only when UW happens to pick the same program again
 * would hide it exactly when it matters. When one lender has several prior
 * rows, the most decisive verdict wins (funded > declined > approved >
 * submitted) and ties break on the most recent.
 */
const DECISIVENESS: Record<string, number> = {
  funded: 4,
  declined_by_lender: 3,
  approved_by_lender: 2,
  submitted: 1,
  pending: 0,
};

export function buildPriorOutcomes(
  rows: LenderAssignmentRow[],
  deals: Pick<FundingDeal, "id">[],
  /** Rows on this round are current work, not history. Pass null to include all. */
  excludeDealId: string | null
): Map<string, PriorOutcome> {
  const best = new Map<string, PriorOutcome & { _rank: number; _at: string }>();

  for (const row of rows) {
    if (isUnworked(row.status)) continue;
    if (excludeDealId && row.funding_deal_id === excludeDealId) continue;
    // An admin pulled this lender off the file; it is a removal, not a verdict.
    if (row.admin_review === "rejected") continue;

    const rank = DECISIVENESS[row.status] ?? 0;
    if (rank === 0) continue;
    const at = row.responded_at || row.submitted_at || row.assigned_at || "";
    const prev = best.get(row.lender_name);
    if (prev && (prev._rank > rank || (prev._rank === rank && prev._at >= at))) continue;

    best.set(row.lender_name, {
      lender_name: row.lender_name,
      status: row.status as LenderStatus,
      round_no: roundNoForRow(row, deals),
      note: noteSnippet(row.response_notes),
      is_warning: isWarningStatus(row.status),
      _rank: rank,
      _at: at,
    });
  }

  const out = new Map<string, PriorOutcome>();
  for (const [name, v] of best) {
    const { _rank, _at, ...outcome } = v;
    void _rank;
    void _at;
    out.set(name, outcome);
  }
  return out;
}

/** One-line summary for an inline badge: "R1: Declined — High risk state". */
export function describeOutcome(o: PriorOutcome): string {
  const round = o.round_no ? `R${o.round_no}: ` : "";
  const label = LENDER_STATUS_LABEL[o.status] ?? o.status;
  return o.note ? `${round}${label} — ${o.note}` : `${round}${label}`;
}

/** Lender rows grouped by round, newest round first, for the history panel. */
export interface RoundLenderGroup {
  deal_id: string | null;
  round_no: number | null;
  rows: LenderAssignmentRow[];
}

export function groupByRound(
  rows: LenderAssignmentRow[],
  deals: Pick<FundingDeal, "id">[]
): RoundLenderGroup[] {
  const groups: RoundLenderGroup[] = deals.map((d, i) => ({
    deal_id: d.id,
    round_no: deals.length - i,
    rows: [],
  }));
  // Legacy rows land on the oldest round, matching roundNoForRow.
  const oldest = groups[groups.length - 1];

  for (const row of rows) {
    if (!row.funding_deal_id) {
      if (oldest) oldest.rows.push(row);
      continue;
    }
    const g = groups.find((x) => x.deal_id === row.funding_deal_id);
    if (g) g.rows.push(row);
    else if (oldest) oldest.rows.push(row);
  }

  const byRecency = (a: LenderAssignmentRow, b: LenderAssignmentRow) =>
    String(b.assigned_at ?? "").localeCompare(String(a.assigned_at ?? ""));
  for (const g of groups) g.rows.sort(byRecency);

  return groups.filter((g) => g.rows.length > 0);
}
