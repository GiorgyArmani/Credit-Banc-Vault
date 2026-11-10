// src/lib/lender-matching.ts
//
// The lender matching engine and the "what deal are we matching" loader, shared
// by Lender Match (src/components/lender-match.tsx) and the UW manual Add Lender
// picker. One copy on purpose: the picker shows the SAME guideline verdict the
// match tool would, so a hand-picked lender is checked by the same rules.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealSummary } from "@/components/bank-analysis";
import { matchNaics } from "@/data/naics";

export interface Lender {
  id: string;
  lender_name: string;
  specialty: string | null;
  /** Optional tier within a specialty. NULL = a single, untiered program. A
   *  lender offering several tiers of the same product carries one row per tier;
   *  each is matched independently so a deal can qualify for Tier 3 but not
   *  Tier 1. */
  tier_label: string | null;
  min_fico: number | null;
  min_sbss: number | null;
  time_in_business_months: number | null;
  negative_days: number | null;
  monthly_deposits: number | null;
  avg_monthly_revenue: number | null;
  avg_daily_balance: number | null;
  preferred_industries: string | null;
  restricted_industries: string | null;
  restricted_industry_exceptions: string | null;
  restricted_states: string | null;
  ownership_percentage: number | null;
  number_of_positions: number | null;
  /** Minimum open positions the lender accepts. 0 = will take first-position
   *  files; N>0 = won't fund unless the deal has at least N existing
   *  positions. Defines the low water mark of the open-position window. */
  min_positions: number | null;
  bankruptcies: string | null;
  tax_liens_limit: number | string | null;
  min_funding: number | string | null;
  max_funding: number | string | null;
  auto_decline_reasons: string | null;
  holdback_percentage: number | null;
  payment_type: string | null;
  consolidation_positions: number | null;
  additional_info: string | null;
}

export interface MatchResult {
  lender: Lender;
  passed: boolean;
  flags: string[];
  warnings: string[];
}

export const fmt$ = (v: number) =>
  v === 0 ? "—" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const DEFAULT_DEAL: DealSummary = {
  fico: 0,
  tibMonths: 0,
  avgRevenue: 0,
  avgDailyBalance: 0,
  totalNegDays: 0,
  numOpenPositions: 0,
  avgMonthlyDeposits: 0,
  hasBankruptcy: false,
  businessName: "",
  ownerName: "",
  capitalRequested: 0,
  state: "",
  industry: "",
  proposedLoanType: "",
  loanPurpose: "",
  businessStartDate: "",
  numOwners: "",
  ownershipDetails: [],
};

// ─── Matching Engine ──────────────────────────────────────────────────────────
// Rules only fire when BOTH the lender guideline AND the deal value are present.
// A missing lender value = lender doesn't restrict on that field = not a flag.
// A missing deal value = we don't have the data to check = not a flag.

export function matchLender(lender: Lender, deal: DealSummary): MatchResult {
  const flags: string[] = [];
  const warnings: string[] = [];

  // FICO — only check if both sides have a value
  if ((lender.min_fico ?? 0) > 0 && deal.fico > 0 && deal.fico < lender.min_fico!)
    flags.push(`FICO ${deal.fico} < min ${lender.min_fico}`);

  // TIB — only check if both sides have a value
  if ((lender.time_in_business_months ?? 0) > 0 && deal.tibMonths > 0 && deal.tibMonths < lender.time_in_business_months!)
    flags.push(`TIB ${deal.tibMonths}mo < min ${lender.time_in_business_months}mo`);

  // Revenue — only check if both sides have a value
  if ((lender.avg_monthly_revenue ?? 0) > 0 && deal.avgRevenue > 0 && deal.avgRevenue < lender.avg_monthly_revenue!)
    flags.push(`Revenue ${fmt$(deal.avgRevenue)} < min ${fmt$(lender.avg_monthly_revenue!)}`);

  // Negative days — only check if lender has a limit AND deal has neg day data
  if (lender.negative_days !== null && deal.totalNegDays > 0 && deal.totalNegDays > lender.negative_days)
    flags.push(`Neg days ${deal.totalNegDays} > max ${lender.negative_days}`);

  // Monthly deposits — only check if both sides have a value
  if ((lender.monthly_deposits ?? 0) > 0 && deal.avgMonthlyDeposits > 0 && deal.avgMonthlyDeposits < lender.monthly_deposits!)
    flags.push(`Deposits ${deal.avgMonthlyDeposits} < min ${lender.monthly_deposits}`);

  // Open positions — enforce both the max (number_of_positions) and the min
  // (min_positions, e.g. "won't fund unless there are already N positions").
  // Skip each check when its threshold is null so partially-configured lenders
  // don't get false-flagged.
  if (lender.number_of_positions !== null && deal.numOpenPositions > 0 && deal.numOpenPositions > lender.number_of_positions)
    flags.push(`${deal.numOpenPositions} positions > max ${lender.number_of_positions}`);
  if ((lender.min_positions ?? 0) > 0 && deal.numOpenPositions < (lender.min_positions ?? 0))
    flags.push(`${deal.numOpenPositions} positions < min ${lender.min_positions}`);

  // Avg daily balance — only check if both sides have a value
  if ((lender.avg_daily_balance ?? 0) > 0 && deal.avgDailyBalance > 0 && deal.avgDailyBalance < lender.avg_daily_balance!)
    flags.push(`Avg daily bal ${fmt$(deal.avgDailyBalance)} < min ${fmt$(lender.avg_daily_balance!)}`);

  // Bankruptcy — only flag if lender explicitly says No AND deal has a bankruptcy
  if (lender.bankruptcies === "No" && deal.hasBankruptcy)
    flags.push("Lender does not accept bankruptcies");

  // Restricted states — only check if both sides have data
  if (lender.restricted_states && deal.state) {
    const stateParts = lender.restricted_states.toUpperCase().split(/[,\s]+/).filter((s) => s.length === 2);
    if (stateParts.includes(deal.state.toUpperCase()))
      flags.push(`State ${deal.state.toUpperCase()} is restricted`);
  }

  // Restricted industries — only check if both sides have data
  if (lender.restricted_industries && deal.industry) {
    const words = deal.industry.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const restricted = lender.restricted_industries.toLowerCase();
    const hit = words.find((w) => restricted.includes(w));
    if (hit) {
      const exception = lender.restricted_industry_exceptions?.toLowerCase() || "";
      if (!exception || !words.find((w) => exception.includes(w)))
        flags.push(`Industry "${deal.industry}" may be restricted`);
      else
        warnings.push("Industry may be restricted but exceptions exist — verify");
    }
  }

  // Funding range — only check if lender has limits AND deal has a request
  const minF = typeof lender.min_funding === "number" ? lender.min_funding : null;
  const maxF = typeof lender.max_funding === "number" ? lender.max_funding : null;
  if (deal.capitalRequested > 0) {
    if (minF !== null && deal.capitalRequested < minF)
      flags.push(`Request ${fmt$(deal.capitalRequested)} < min ${fmt$(minF)}`);
    if (maxF !== null && deal.capitalRequested > maxF)
      flags.push(`Request ${fmt$(deal.capitalRequested)} > max ${fmt$(maxF)}`);
  }

  return { lender, passed: flags.length === 0, flags, warnings };
}

// The client profile IS the base deal. Everything the matcher needs — FICO
// band, time in business, revenue, deposits, ask, state, industry, bankruptcy —
// is captured at vault creation, so a file with no bank analysis is still
// matchable. A saved analysis, when one exists, is layered on top (see
// mergeAnalysisOverDeal): it refines the profile numbers, it isn't a
// precondition for running the tool.
export interface ClientOption {
  id: string;
  client_name: string;
  company_name: string;
  industry?: string;
  company_state?: string;
  // Industry is captured at vault creation onto business_profiles (not the vault
  // row), so we embed it here as the reliable source for the industry filter.
  business_profiles?: {
    id: string;
    company_name?: string | null;
    industry: string | null;
    is_primary: boolean;
    display_order: number;
    business_start_date?: string | null;
    company_state?: string | null;
    avg_monthly_deposits?: number | null;
    avg_annual_revenue?: number | null;
    amount_requested?: number | null;
    credit_score?: string | null;
  }[];
  credit_score?: string | null;
  capital_requested?: number | null;
  avg_monthly_deposits?: number | null;
  avg_annual_revenue?: number | null;
  has_bankruptcy_foreclosure_3y?: boolean | null;
  proposed_loan_type: string;
  loan_purpose: string;
  business_start_date: string;
  number_of_owners: string;
  owner_1_name: string;
  owner_1_ownership_pct: number;
  owner_2_name?: string;
  owner_2_ownership_pct?: number;
  owner_3_name?: string;
  owner_3_ownership_pct?: number;
  owner_4_name?: string;
  owner_4_ownership_pct?: number;
  owner_5_name?: string;
  owner_5_ownership_pct?: number;
}

// ─── Profile → deal ───────────────────────────────────────────────────────────
// Turns the data captured at vault creation into a DealSummary the matcher can
// run on. Two fields have no profile equivalent and stay 0 — average daily
// balance and negative days only exist once statements are read. That is safe:
// the engine skips any rule whose deal value is 0, so a profile-only deal is
// matched on what we actually know instead of being disqualified for what we
// don't. UW can type either number in by hand when they know it.

/** "700+" → 700, "600-700" → 600, "712" → 712. Ranges resolve to their LOW end:
 *  matching on the optimistic end of a band would surface lenders the file
 *  can't actually clear. */
export function parseFicoBand(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseInt(String(raw).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function monthsSince(startDate: string | null | undefined): number {
  if (!startDate) return 0;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return 0;
  const now = new Date();
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  return months > 0 ? months : 0;
}

/** Primary business first, then display_order — the same ordering the rest of
 *  the app uses to decide which business represents the file. */
export function primaryBusiness(client: ClientOption | undefined) {
  return (client?.business_profiles ?? [])
    .slice()
    .sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order
    )[0];
}

export type BusinessRow = NonNullable<ClientOption["business_profiles"]>[number];

/** The business being matched: the one asked for, else the primary. */
export function businessFor(client: ClientOption | undefined, businessId: string | null | undefined) {
  return (
    (businessId ? client?.business_profiles?.find((b) => b.id === businessId) : undefined) ??
    primaryBusiness(client)
  );
}

/** Rows written before per-business tracking have business_profile_id NULL and
 *  belong to the primary business. Scopes a query to one business on that rule. */
// `any` inside on purpose: constraining Q to Supabase's builder type sends tsc
// into "excessively deep" instantiation. Callers keep their own builder type.
export function scopeToBusiness<Q>(q: Q, biz: BusinessRow | undefined): Q {
  if (!biz) return q;
  const b = q as any;
  return biz.is_primary
    ? b.or(`business_profile_id.eq.${biz.id},business_profile_id.is.null`)
    : b.eq("business_profile_id", biz.id);
}

export function buildProfileDeal(
  client: ClientOption | undefined,
  openPositions: number,
  biz: BusinessRow | undefined
): DealSummary {
  if (!client) return { ...DEFAULT_DEAL };

  // Business-level values win over the vault row when present: on a
  // multi-business file the vault row still carries the first business's
  // numbers, and the deal being matched is the selected business's.
  const startDate = biz?.business_start_date || client.business_start_date || "";
  const annualRevenue = Number(biz?.avg_annual_revenue ?? client.avg_annual_revenue) || 0;
  const rawIndustry = (biz?.industry || client.industry || "").trim();

  return {
    fico: parseFicoBand(biz?.credit_score || client.credit_score),
    tibMonths: monthsSince(startDate),
    // Signup captures ANNUAL revenue; the matcher compares monthly.
    avgRevenue: annualRevenue > 0 ? Math.round(annualRevenue / 12) : 0,
    avgDailyBalance: 0,
    totalNegDays: 0,
    numOpenPositions: openPositions,
    avgMonthlyDeposits: Number(biz?.avg_monthly_deposits ?? client.avg_monthly_deposits) || 0,
    hasBankruptcy: !!client.has_bankruptcy_foreclosure_3y,
    businessName: biz?.company_name || client.company_name || "",
    ownerName: client.client_name || "",
    capitalRequested: Number(biz?.amount_requested ?? client.capital_requested) || 0,
    state: (biz?.company_state || client.company_state || "").toUpperCase().slice(0, 2),
    industry: matchNaics(rawIndustry)?.title ?? rawIndustry,
    proposedLoanType: client.proposed_loan_type || "",
    loanPurpose: client.loan_purpose || "",
    businessStartDate: startDate
      ? new Date(startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "",
    numOwners: client.number_of_owners || "",
    ownershipDetails: [
      { name: client.owner_1_name || "", pct: Number(client.owner_1_ownership_pct) || 0 },
      { name: client.owner_2_name || "", pct: Number(client.owner_2_ownership_pct) || 0 },
      { name: client.owner_3_name || "", pct: Number(client.owner_3_ownership_pct) || 0 },
      { name: client.owner_4_name || "", pct: Number(client.owner_4_ownership_pct) || 0 },
      { name: client.owner_5_name || "", pct: Number(client.owner_5_ownership_pct) || 0 },
    ].filter((o) => o.name && o.pct > 0),
  };
}

/** The subset of a bank_analysis_results row the matcher reads. Every field is
 *  optional: snapshots saved before a column existed simply don't carry it. */
export interface AnalysisRow {
  created_at?: string | null;
  fico?: number | null;
  tib_months?: number | null;
  avg_revenue?: number | string | null;
  avg_daily_balance?: number | string | null;
  avg_monthly_deposits?: number | string | null;
  total_neg_days?: number | null;
  num_open_positions?: number | null;
  has_bankruptcy?: boolean | null;
  capital_requested?: number | string | null;
  company_state?: string | null;
  industry?: string | null;
  business_name?: string | null;
  owner_name?: string | null;
}

/** Layer a saved analysis over the profile deal. Only fields the analysis
 *  actually carries a value for override — a snapshot saved before a field
 *  existed, or left blank, must not blank out good profile data. */
export function mergeAnalysisOverDeal(base: DealSummary, analysis: AnalysisRow): DealSummary {
  const num = (v: unknown, fallback: number) => (Number(v) > 0 ? Number(v) : fallback);
  const rawIndustry = (analysis.industry || "").trim();
  return {
    ...base,
    fico: num(analysis.fico, base.fico),
    tibMonths: num(analysis.tib_months, base.tibMonths),
    avgRevenue: num(analysis.avg_revenue, base.avgRevenue),
    avgDailyBalance: num(analysis.avg_daily_balance, base.avgDailyBalance),
    avgMonthlyDeposits: num(analysis.avg_monthly_deposits, base.avgMonthlyDeposits),
    totalNegDays: num(analysis.total_neg_days, base.totalNegDays),
    numOpenPositions: num(analysis.num_open_positions, base.numOpenPositions),
    // Bankruptcy is a boolean: the analysis asserting one is authoritative, but
    // its `false` never clears a bankruptcy already declared on the profile.
    hasBankruptcy: analysis.has_bankruptcy || base.hasBankruptcy,
    capitalRequested: num(analysis.capital_requested, base.capitalRequested),
    state: (analysis.company_state || base.state || "").toUpperCase().slice(0, 2),
    industry: rawIndustry ? (matchNaics(rawIndustry)?.title ?? rawIndustry) : base.industry,
    businessName: analysis.business_name || base.businessName,
    ownerName: analysis.owner_name || base.ownerName,
  };
}
/** Columns buildProfileDeal reads. Select this from client_data_vault. */
export const MATCH_CLIENT_SELECT = `
  id, client_name, company_name, industry, company_state,
  credit_score, capital_requested, avg_monthly_deposits, avg_annual_revenue,
  has_bankruptcy_foreclosure_3y,
  proposed_loan_type, loan_purpose, business_start_date, number_of_owners,
  owner_1_name, owner_1_ownership_pct,
  owner_2_name, owner_2_ownership_pct,
  owner_3_name, owner_3_ownership_pct,
  owner_4_name, owner_4_ownership_pct,
  owner_5_name, owner_5_ownership_pct,
  business_profiles (
    id, company_name, industry, is_primary, display_order, business_start_date, company_state,
    avg_monthly_deposits, avg_annual_revenue, amount_requested, credit_score
  )
`;

/**
 * The deal to match for ONE business of a client: profile numbers, that
 * business's open positions and newest funding round, with its latest bank
 * analysis layered on top. Every read is scoped to the business — on a
 * multi-business client the others have their own numbers and statements.
 */
export async function loadBusinessDeal(
  supabase: SupabaseClient,
  client: ClientOption,
  businessId: string | null
): Promise<{
  deal: DealSummary;
  biz: BusinessRow | undefined;
  activeDealId: string | null;
  analysisDate: string | null;
  hasAnalysis: boolean;
}> {
  const biz = businessFor(client, businessId);

  // Open positions come from the vault's own ground-truth table, so a
  // profile-only deal still gets scored on position count. Best-effort: a
  // failure leaves 0, which the engine reads as "unknown" and skips.
  let openPositions = 0;
  try {
    const { count } = await scopeToBusiness(
      supabase
        .from("client_open_positions")
        .select("id", { count: "exact", head: true })
        .eq("client_vault_id", client.id),
      biz
    );
    openPositions = count ?? 0;
  } catch (err) {
    console.warn("lender-matching: open positions lookup failed (non-fatal):", err);
  }

  // History-aware load: take the LATEST snapshot. bank_analysis_results
  // no longer has UNIQUE(client_id) — each save in the bank-analysis tool
  // appends a row, so we sort desc + limit 1 to get the current state.
  const { data: analysis, error: aError } = await scopeToBusiness(
    supabase.from("bank_analysis_results").select("*").eq("client_id", client.id),
    biz
  )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // The ask being worked lives on the CURRENT funding round, not on the vault
  // row — that one still carries the first round's numbers for a repeat
  // client. Newest deal wins (see the funding-rounds contract). Best-effort:
  // no row, or no read access, falls back to the profile ask.
  let activeDeal: {
    id?: string;
    capital_requested?: number | null;
    proposed_loan_type?: string | null;
    loan_purpose?: string | null;
  } | null = null;
  if (biz?.id) {
    const { data: dealRow } = await supabase
      .from("funding_deals")
      .select("id, capital_requested, proposed_loan_type, loan_purpose")
      .eq("business_profile_id", biz.id)
      .order("display_order", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    activeDeal = dealRow ?? null;
  }

  const profileDeal = buildProfileDeal(client, openPositions, biz);
  if (activeDeal) {
    profileDeal.capitalRequested = Number(activeDeal.capital_requested) || profileDeal.capitalRequested;
    profileDeal.proposedLoanType = activeDeal.proposed_loan_type || profileDeal.proposedLoanType;
    profileDeal.loanPurpose = activeDeal.loan_purpose || profileDeal.loanPurpose;
  }

  const hasAnalysis = !!analysis && !aError;
  return {
    deal: hasAnalysis ? mergeAnalysisOverDeal(profileDeal, analysis as AnalysisRow) : profileDeal,
    biz,
    activeDealId: activeDeal?.id ?? null,
    analysisDate: hasAnalysis ? ((analysis as AnalysisRow).created_at ?? null) : null,
    hasAnalysis,
  };
}
