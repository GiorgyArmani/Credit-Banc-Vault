"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import type { DealSummary } from "./bank-analysis";
import { LOAN_TYPES } from "@/data/loan-types";
import { NaicsCombobox } from "@/components/ui/naics-combobox";
import { matchNaics } from "@/data/naics";
import { createClient } from "@/lib/supabase/client";
import {
  buildPriorOutcomes,
  describeOutcome,
  type LenderAssignmentRow,
  type PriorOutcome,
} from "@/lib/lender-history";
import { notifyAdminsOfLenderMatchSaved } from "@/app/actions/lender-match-notifications";
import { toast } from "@/lib/toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lender {
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

interface MatchResult {
  lender: Lender;
  passed: boolean;
  flags: string[];
  warnings: string[];
}

type LenderDecision = "approved" | "rejected" | null;
// New, simpler model: UW selects which matched lenders to take forward, and
// those land CLEARED FOR SUBMISSION — no admin sign-off in between. Admins are
// notified (Slack + email + in-app) and can still veto a lender by flipping
// admin_review to 'rejected' on the unified client view.
// "decisions" map below now only stores 'approved' | null — rejected is gone.

const fmt$ = (v: number) =>
  v === 0 ? "—" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Specialty pills sit on white surfaces now — use light tints with deeper
// text + matching border. Keeps the per-specialty color coding analysts
// rely on without losing legibility against the new light backdrop.
const SPECIALTY_COLORS: Record<string, string> = {
  MCA: "bg-blue-50 text-blue-700 border-blue-200",
  SBA: "bg-green-50 text-green-700 border-green-200",
  LOC: "bg-purple-50 text-purple-700 border-purple-200",
  Equipment: "bg-yellow-50 text-yellow-700 border-yellow-200",
  Amortizing: "bg-sky-50 text-sky-700 border-sky-200",
  "Term Loan": "bg-orange-50 text-orange-700 border-orange-200",
  "Real Estate": "bg-cyan-50 text-cyan-700 border-cyan-200",
  Trucking: "bg-red-50 text-red-700 border-red-200",
  "Invoice Factoring": "bg-pink-50 text-pink-700 border-pink-200",
  Consolidation: "bg-indigo-50 text-indigo-700 border-indigo-200",
  "Reverse consolidation": "bg-teal-50 text-teal-700 border-teal-200",
  "Contract Financing": "bg-amber-50 text-amber-700 border-amber-200",
  Acquisition: "bg-violet-50 text-violet-700 border-violet-200",
  General: "bg-slate-50 text-slate-700 border-slate-200",
};

// ─── Specialty normalization ──────────────────────────────────────────────────
// Lender rows carry free-text specialties that drift ("SBA" vs "SBA Loan",
// "LOC" vs "Line of Credit"). We collapse them to a stable key so the program
// tabs don't show duplicates and the client's proposed loan type can be matched
// against whatever spelling the data happens to use.
const SPECIALTY_KEY_ALIASES: Record<string, string> = {
  loc: "lineofcredit",
  lineofcredit: "lineofcredit",
  sba: "sba",
  sbaloan: "sba",
};

// Untagged programs reach us two ways: specialty NULL (rows predating the
// program-tag system) and specialty "" (blank saves). `??` only catches the
// first, which left blank-string rows keyed to "" — a nameless tab in the
// program filter. Normalize both, plus whitespace, into the Unknown bucket.
function specialtyKey(raw: string | null | undefined): string {
  const base = (raw?.trim() || "Unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/loan$/, "");
  return SPECIALTY_KEY_ALIASES[base] ?? base;
}

// Canonical display label for a specialty key, preferring the app's own loan-type
// taxonomy when one maps to the same key (so a "SBA" row still shows "SBA Loan").
const LOAN_TYPE_BY_KEY = new Map(LOAN_TYPES.map((t) => [specialtyKey(t), t]));

const DEFAULT_DEAL: DealSummary = {
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

// ─── Lender visibility gate ───────────────────────────────────────────────────
// Only counts a field as "overlapping" when the lender has a real non-zero
// guideline value AND the deal also has real data for that same field.
// Lenders need at least 3 overlapping fields to appear in results.

function countOverlap(lender: Lender, deal: DealSummary): number {
  let n = 0;
  // Core three — must have a positive value on the lender side
  if ((lender.min_fico ?? 0) > 0 && deal.fico > 0) n++;
  if ((lender.time_in_business_months ?? 0) > 0 && deal.tibMonths > 0) n++;
  if ((lender.avg_monthly_revenue ?? 0) > 0 && deal.avgRevenue > 0) n++;
  // Secondary — lender must have a positive/real limit, not null or zero
  if ((lender.negative_days ?? -1) >= 0 && deal.totalNegDays >= 0) n++;
  if ((lender.monthly_deposits ?? 0) > 0 && deal.avgMonthlyDeposits > 0) n++;
  if ((lender.number_of_positions ?? -1) > 0 && deal.numOpenPositions >= 0) n++;
  if ((lender.avg_daily_balance ?? 0) > 0 && deal.avgDailyBalance > 0) n++;
  if (
    (typeof lender.min_funding === "number" && lender.min_funding > 0) ||
    (typeof lender.max_funding === "number" && lender.max_funding > 0)
  ) {
    if (deal.capitalRequested > 0) n++;
  }
  return n;
}

// A lender's guidelines are "viable" (worth matching against) once the row
// carries at least ONE real underwriting threshold — not all of them. The old
// rule required min_fico AND time-in-business AND monthly revenue together,
// which permanently flagged equipment/collateral lenders (4HF, titled-vehicle,
// deferred programs) as "incomplete": they legitimately underwrite on credit +
// collateral and have no monthly-revenue requirement. Any single populated
// threshold — FICO, revenue, time-in-business, or a funding ceiling — means the
// row is more than an empty shell and belongs in the matchable pool.
function hasMinViableGuidelines(l: Lender): boolean {
  return (l.min_fico ?? 0) > 0
    || (l.avg_monthly_revenue ?? 0) > 0
    || (l.time_in_business_months ?? 0) > 0
    || (Number(l.max_funding) || 0) > 0;
}

// ─── Matching Engine ──────────────────────────────────────────────────────────
// Rules only fire when BOTH the lender guideline AND the deal value are present.
// A missing lender value = lender doesn't restrict on that field = not a flag.
// A missing deal value = we don't have the data to check = not a flag.

function matchLender(lender: Lender, deal: DealSummary): MatchResult {
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

// ─── Props & Types ────────────────────────────────────────────────────────────

export interface LenderMatchProps {
  dealSummary?: Partial<DealSummary>;
  state?: string;
  industry?: string;
}

// The client profile IS the base deal. Everything the matcher needs — FICO
// band, time in business, revenue, deposits, ask, state, industry, bankruptcy —
// is captured at vault creation, so a file with no bank analysis is still
// matchable. A saved analysis, when one exists, is layered on top (see
// mergeAnalysisOverDeal): it refines the profile numbers, it isn't a
// precondition for running the tool.
interface ClientOption {
  id: string;
  client_name: string;
  company_name: string;
  industry?: string;
  company_state?: string;
  // Industry is captured at vault creation onto business_profiles (not the vault
  // row), so we embed it here as the reliable source for the industry filter.
  business_profiles?: {
    id: string;
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
function parseFicoBand(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseInt(String(raw).replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function monthsSince(startDate: string | null | undefined): number {
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
function primaryBusiness(client: ClientOption | undefined) {
  return (client?.business_profiles ?? [])
    .slice()
    .sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.display_order - b.display_order
    )[0];
}

function buildProfileDeal(client: ClientOption | undefined, openPositions: number): DealSummary {
  if (!client) return { ...DEFAULT_DEAL };
  const biz = primaryBusiness(client);

  // Business-level values win over the vault row when present: on a
  // multi-business file the vault row still carries the first business's
  // numbers, and the deal being matched belongs to the primary business.
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
    businessName: client.company_name || "",
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
interface AnalysisRow {
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
function mergeAnalysisOverDeal(base: DealSummary, analysis: AnalysisRow): DealSummary {
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

/** Where the numbers on screen came from — drives the source badge so nobody
 *  mistakes a profile-based match for a statement-verified one. */
type DealSource = "none" | "profile" | "analysis" | "manual";

// ─── Component ────────────────────────────────────────────────────────────────

export default function LenderMatch({ dealSummary: propDeal = DEFAULT_DEAL, state: propState = "", industry: propIndustry = "" }: LenderMatchProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Sibling guidelines editor for the current context (admin↔admin, uw↔uw):
  // /admin/uw/lender-match → /admin/uw/lender-guidelines, and likewise for the
  // /underwriting routes. Falls back to the underwriting page if the path is
  // unexpected. Used by the "Add guidelines" shortcut on Incomplete cards.
  const guidelinesHref = (lenderName: string) => {
    const base = pathname?.includes("/lender-match")
      ? pathname.replace("/lender-match", "/lender-guidelines")
      : "/underwriting/lender-guidelines";
    return `${base}?edit=${encodeURIComponent(lenderName)}`;
  };
  const [deal, setDeal] = useState<DealSummary>({ ...DEFAULT_DEAL, ...propDeal });
  const [filterState, setFilterState] = useState(propState || propDeal.state || "");
  const [filterIndustry, setFilterIndustry] = useState(propIndustry || propDeal.industry || "");

  // Accept ?client=<id> from URL so deep-links from the client detail view
  // auto-select the client and load their saved match.
  const initial_client_id = searchParams?.get("client") ?? "";
  const [clientList, setClientList] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>(initial_client_id);
  const [isLoadingClient, setIsLoadingClient] = useState(false);
  // Provenance of the numbers currently on screen, surfaced as a badge. A
  // profile-based match is a legitimate match, but the team has to be able to
  // see at a glance that no statements were read.
  const [dealSource, setDealSource] = useState<DealSource>("none");
  const [analysisDate, setAnalysisDate] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement | null>(null);
  // Multi-select program filter, keyed by normalized specialty. Empty = show all.
  const [selectedSpecialties, setSelectedSpecialties] = useState<Set<string>>(new Set());
  const [showPassedOnly, setShowPassedOnly] = useState(false);

  const toggleSpecialty = (key: string) =>
    setSelectedSpecialties((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // Which result sections are folded shut. Both open by default.
  const [collapsedSections, setCollapsedSections] = useState<{ matched: boolean; incomplete: boolean }>({
    matched: false,
    incomplete: false,
  });
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // The round being matched for. Resolved in loadClientResults alongside the
  // deal criteria, and stamped onto every row saved — without it the
  // assignments cannot be told apart once a second round opens.
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  // What earlier rounds' lenders said, keyed by lender name. Drives the inline
  // warning — UW is never blocked, only told before they pick.
  const [priorOutcomes, setPriorOutcomes] = useState<Map<string, PriorOutcome>>(new Map());

  // Change 2: Approve / Reject decisions
  const [decisions, setDecisions] = useState<Record<string, LenderDecision>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (Object.keys(propDeal).length > 0) {
      setDeal((prev) => ({ ...prev, ...propDeal }));
      if (propDeal.state) setFilterState(propDeal.state);
      if (propDeal.industry) setFilterIndustry(propDeal.industry);
    }
  }, [propDeal]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("client_data_vault")
      .select(`
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
          id, industry, is_primary, display_order, business_start_date, company_state,
          avg_monthly_deposits, avg_annual_revenue, amount_requested, credit_score
        )
      `)
      .order("client_name", { ascending: true })
      .then(({ data }) => {
        if (data) setClientList(data as any as ClientOption[]);
      });
  }, []);

  // Deep-link load: ?client=<id> only ever seeded selectedClientId, so arriving
  // from the client detail view showed the client as selected with an empty
  // deal — the analyst had to re-pick them from the dropdown to get any data.
  // Fire the load once the client list (which loadClientResults reads the
  // profile from) has arrived, and only once per client.
  const deepLinkedRef = useRef<string>("");
  useEffect(() => {
    if (!initial_client_id || clientList.length === 0) return;
    if (deepLinkedRef.current === initial_client_id) return;
    deepLinkedRef.current = initial_client_id;
    loadClientResults(initial_client_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial_client_id, clientList.length]);

  // Close the client search dropdown when clicking outside of it.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (clientSearchRef.current && !clientSearchRef.current.contains(e.target as Node)) {
        setClientDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedClient = useMemo(
    () => clientList.find((c) => c.id === selectedClientId),
    [clientList, selectedClientId]
  );

  const filteredClientList = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clientList;
    return clientList.filter((c) =>
      `${c.company_name ?? ""} ${c.client_name ?? ""}`.toLowerCase().includes(q)
    );
  }, [clientList, clientSearch]);

  function selectClient(clientId: string) {
    setSelectedClientId(clientId);
    setClientDropdownOpen(false);
    setClientSearch("");
    loadClientResults(clientId);
  }

  // Fully reset the tool to its empty state. The ✕ used to only clear the
  // selected id, leaving the loaded deal, filters, and results on screen — which
  // read as a live match with no client. Wipe everything the deal drives.
  function clearSelectedClient() {
    setSelectedClientId("");
    setClientSearch("");
    setClientDropdownOpen(false);
    setDeal({ ...DEFAULT_DEAL });
    setDealSource("none");
    setAnalysisDate(null);
    setFilterState("");
    setFilterIndustry("");
    setSelectedSpecialties(new Set());
    setDecisions({});
  }

  /** Hand-edit of any match criterion. Flags the deal as manual so the badge
   *  stops claiming the numbers came straight from the profile or a snapshot. */
  function editDeal(patch: Partial<DealSummary>) {
    setDeal((prev) => ({ ...prev, ...patch }));
    setDealSource((prev) => (prev === "none" ? prev : "manual"));
    setSaveSuccess(false);
  }

  // Two different things come out of one read.
  //
  //   `decisions` — what UW picked LAST TIME on this round, to re-hydrate the
  //   checkboxes. Keyed on the name/specialty/tier composite, because that is
  //   what a checkbox is.
  //
  //   `priorOutcomes` — what lenders on EARLIER rounds actually said. Keyed on
  //   lender name only (see lender-history.ts) and deliberately not used to
  //   filter or disable anything: a decline goes stale, revenue grows, an MCA
  //   gets paid off. UW is told, then decides.
  const loadDecisions = useCallback(
    async (clientId: string, dealId: string | null, businessId: string | null) => {
      if (!clientId) return;
      const supabase = createClient();
      const { data } = await supabase
        .from("client_lender_assignments")
        .select(
          "id, lender_name, specialty, tier_label, decision, status, response_notes, funding_deal_id, business_profile_id, assigned_at, admin_review"
        )
        .eq("client_id", clientId);
      if (!data) return;

      const rows = data as unknown as (LenderAssignmentRow & {
        decision: LenderDecision;
      })[];

      const map: Record<string, LenderDecision> = {};
      rows.forEach((row) => {
        // Only this round's picks pre-tick the grid. A prior round's approvals
        // are history, not a starting position for the round being built.
        const sameRound = !dealId || !row.funding_deal_id || row.funding_deal_id === dealId;
        if (sameRound) {
          map[`${row.lender_name}-${row.specialty ?? ""}-${row.tier_label ?? ""}`] = row.decision;
        }
      });
      setDecisions(map);

      // Rounds for this business, newest first — needed to label an outcome
      // "R1" rather than just "earlier". Best-effort: no rounds, no labels.
      let deals: { id: string }[] = [];
      if (businessId) {
        const { data: dealRows } = await supabase
          .from("funding_deals")
          .select("id")
          .eq("business_profile_id", businessId)
          .order("display_order", { ascending: false })
          .order("created_at", { ascending: false });
        deals = dealRows ?? [];
      }
      setPriorOutcomes(buildPriorOutcomes(rows, deals, dealId));
    },
    []
  );

  // The client profile is the base deal; a saved bank analysis refines it.
  //
  // This used to be analysis-only: no bank_analysis_results row meant the
  // function warned to the console and left the deal at all-zeros, so the tool
  // sat on "Select a client above" and the file could not be matched at all.
  // Plenty of files never need statements read to go out to lenders, and every
  // number the engine needs is already captured at vault creation — so the
  // profile is now always loaded first, and the analysis is layered over it
  // when one exists.
  async function loadClientResults(clientId: string) {
    if (!clientId) return;
    setIsLoadingClient(true);
    const supabase = createClient();
    const client = clientList.find((c) => c.id === clientId);

    // Open positions come from the vault's own ground-truth table, so a
    // profile-only deal still gets scored on position count. Best-effort: a
    // failure leaves 0, which the engine reads as "unknown" and skips.
    let openPositions = 0;
    try {
      const { count } = await supabase
        .from("client_open_positions")
        .select("id", { count: "exact", head: true })
        .eq("client_vault_id", clientId);
      openPositions = count ?? 0;
    } catch (err) {
      console.warn("lender-match: open positions lookup failed (non-fatal):", err);
    }

    // History-aware load: take the LATEST snapshot. bank_analysis_results
    // no longer has UNIQUE(client_id) — each save in the bank-analysis tool
    // appends a row, so we sort desc + limit 1 to get the current state.
    const { data: analysis, error: aError } = await supabase
      .from("bank_analysis_results")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // The ask being worked lives on the CURRENT funding round, not on the vault
    // row — that one still carries the first round's numbers for a repeat
    // client. Newest deal wins (see the funding-rounds contract). Best-effort:
    // no row, or no read access, falls back to the profile ask.
    const businessId = primaryBusiness(client)?.id;
    let activeDeal: {
      id?: string;
      capital_requested?: number | null;
      proposed_loan_type?: string | null;
      loan_purpose?: string | null;
    } | null = null;
    if (businessId) {
      const { data: dealRow } = await supabase
        .from("funding_deals")
        .select("id, capital_requested, proposed_loan_type, loan_purpose")
        .eq("business_profile_id", businessId)
        .order("display_order", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      activeDeal = dealRow ?? null;
    }
    // Held in state so saveAssignments stamps the same round the criteria came
    // from, rather than re-resolving it and racing a round opened meanwhile.
    setActiveBusinessId(businessId ?? null);
    setActiveDealId(activeDeal?.id ?? null);

    const profileDeal = buildProfileDeal(client, openPositions);
    if (activeDeal) {
      profileDeal.capitalRequested =
        Number(activeDeal.capital_requested) || profileDeal.capitalRequested;
      profileDeal.proposedLoanType = activeDeal.proposed_loan_type || profileDeal.proposedLoanType;
      profileDeal.loanPurpose = activeDeal.loan_purpose || profileDeal.loanPurpose;
    }

    const hasAnalysis = !!analysis && !aError;
    const newDeal = hasAnalysis ? mergeAnalysisOverDeal(profileDeal, analysis) : profileDeal;

    setDeal(newDeal);
    setDealSource(hasAnalysis ? "analysis" : "profile");
    setAnalysisDate(hasAnalysis ? (analysis.created_at ?? null) : null);
    setFilterState(newDeal.state || "");
    setFilterIndustry(newDeal.industry || "");
    setDecisions({});
    setPriorOutcomes(new Map());
    await loadDecisions(clientId, activeDeal?.id ?? null, businessId ?? null);
    setIsLoadingClient(false);
  }

  const [lenderData, setLenderData] = useState<Lender[]>([]);
  const [loadingLenders, setLoadingLenders] = useState(true);

  useEffect(() => {
    async function fetchLenders() {
      setLoadingLenders(true);
      const supabase = createClient();
      const { data, error } = await supabase.from("lender_guidelines").select("*");
      if (!error && data) {
        // Deduplicate only — no hasGuidelines filter here.
        // Filtering happens in useMemo against the actual loaded deal.
        // Key includes tier_label so genuine tiers of the same product survive
        // (a lender with 4 MCA tiers keeps all four); only exact dupes collapse.
        const uniqueMap = new Map<string, Lender>();
        (data as Lender[]).forEach((l) => {
          const key = `${l.lender_name}-${l.specialty || ""}-${l.tier_label ?? ""}`;
          if (!uniqueMap.has(key)) uniqueMap.set(key, l);
        });
        setLenderData(Array.from(uniqueMap.values()));
      }
      setLoadingLenders(false);
    }
    fetchLenders();
  }, []);

  const { viableResults, incompleteResults } = useMemo(() => {
    const viable: MatchResult[] = [];
    const incomplete: MatchResult[] = [];

    lenderData.forEach((l) => {
      const res = matchLender(l, deal);
      if (hasMinViableGuidelines(l)) {
        viable.push(res);
      } else {
        incomplete.push(res);
      }
    });

    viable.sort((a, b) => {
      if (a.passed !== b.passed) return a.passed ? -1 : 1;
      return a.flags.length - b.flags.length;
    });

    incomplete.sort((a, b) => a.lender.lender_name.localeCompare(b.lender.lender_name));

    return { viableResults: viable, incompleteResults: incomplete };
  }, [deal, lenderData]);

  const passedCount = viableResults.filter((r) => r.passed).length;
  const disqualifiedCount = viableResults.length - passedCount;
  // Deduped program tabs. Rows with drifting spellings ("SBA" / "SBA Loan")
  // collapse to one tab; the label prefers the app's loan-type name, else the
  // most descriptive raw spelling seen.
  const specialtyTabs = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string }>();
    for (const l of lenderData) {
      const raw = l.specialty?.trim() || "Unknown";
      const key = specialtyKey(raw);
      const existing = byKey.get(key);
      const canonical = LOAN_TYPE_BY_KEY.get(key);
      const label = canonical ?? (existing && existing.label.length >= raw.length ? existing.label : raw);
      byKey.set(key, { key, label });
    }
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [lenderData]);

  const applyFilters = (list: MatchResult[]) =>
    list.filter((r) => {
      if (showPassedOnly && !r.passed) return false;
      if (selectedSpecialties.size > 0 && !selectedSpecialties.has(specialtyKey(r.lender.specialty)))
        return false;
      return true;
    });

  const filteredViable = applyFilters(viableResults);
  const filteredIncomplete = applyFilters(incompleteResults);

  // When a client loads, default the program filter to their proposed loan
  // type(s) so results lead with the right product; the team can then toggle
  // other tabs to widen the search. Falls back to "all" when no lender offers
  // that product. Keyed on the client + their proposed type so it never clobbers
  // a manual toggle the user makes afterward.
  useEffect(() => {
    const keys = (deal.proposedLoanType || "")
      .split(/[,/&]+/)
      .map((s) => specialtyKey(s))
      .filter((k) => k !== "unknown" && specialtyTabs.some((t) => t.key === k));
    setSelectedSpecialties(new Set(keys));
    // specialtyTabs is derived from lenderData; lenderData.length gates on load
    // without re-firing on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, deal.proposedLoanType, lenderData.length]);

  // Three result buckets the analyst actually reasons about, scoped to what's
  // currently shown: clean matches, matches with at least one flag to review,
  // and lenders we can't score because their guidelines are empty.
  const shownEligible = filteredViable.filter((r) => r.passed).length;
  const shownFlagged = filteredViable.length - shownEligible;
  const shownIncomplete = filteredIncomplete.length;

  const decisionKey = (lender: Lender) =>
    `${lender.lender_name}-${lender.specialty ?? ""}-${lender.tier_label ?? ""}`;

  function setDecision(lender: Lender, next: LenderDecision) {
    const key = decisionKey(lender);
    setDecisions((prev) => ({ ...prev, [key]: prev[key] === next ? null : next }));
    setSaveSuccess(false);
  }

  function toggleRecommended(lender: Lender) {
    const key = decisionKey(lender);
    setDecisions((prev) => ({ ...prev, [key]: prev[key] === "approved" ? null : "approved" }));
    setSaveSuccess(false);
  }

  const approvedCount = Object.values(decisions).filter((d) => d === "approved").length;
  const rejectedCount = Object.values(decisions).filter((d) => d === "rejected").length;
  const recommendedCount = approvedCount;

  // Change 3: Save assignments + stamp loan_status_history
  async function saveAssignments() {
    if (!selectedClientId) return;
    setIsSaving(true);
    setSaveSuccess(false);
    const supabase = createClient();

    // Re-running the match clears the previous SUGGESTIONS. Two limits on what
    // that is allowed to touch, both learned the hard way:
    //
    //   1. Only `status = 'pending'` rows. A row that has been submitted, or
    //      that has come back approved / declined / funded, is no longer a
    //      match suggestion — it is the record of what happened, and its
    //      `response_notes` is the decline reason underwriting needs on the
    //      next round. The old rule deleted everything except 'funded', which
    //      quietly destroyed those notes on every re-run. Six declined rows
    //      with written reasons were live in prod under that rule.
    //
    //   2. Only THIS round. Scoped by funding_deal_id so a repeat client's
    //      earlier rounds are untouchable from here. Legacy rows (NULL, written
    //      before per-round tracking) are treated as this round's while the
    //      client has only one — the round-open endpoint retires them onto the
    //      closing deal the moment a second round starts, after which they stop
    //      matching this filter.
    //
    // admin_manual rows are still preserved: the source filter has not moved.
    {
      let del = supabase
        .from("client_lender_assignments")
        .delete()
        .eq("client_id", selectedClientId)
        .eq("source", "match_tool")
        .eq("status", "pending");
      del = activeDealId
        ? del.or(`funding_deal_id.eq.${activeDealId},funding_deal_id.is.null`)
        : del.is("funding_deal_id", null);
      await del;
    }

    // Only insert lenders UW recommended (decision === "approved").
    // Skipped/unselected matches are simply not stored — admin sees a clean
    // list of what UW chose, not every machine match.
    // Iterate lenderData directly (rather than re-parsing the composite decision
    // key) so tier_label / lender names containing "-" stay intact, and each
    // recommended tier is snapshotted as its own row.
    //
    // admin_review = 'approved' AT INSERT. What UW picks here is cleared for
    // outreach immediately — no separate admin sign-off, same as the manual-add
    // paths. The old gate described a review that does not happen: every
    // match_tool row ever written sat in admin_review='pending' (7 of them, the
    // oldest since 2026-04-15) while every auto-approved manual row moved on to
    // submitted / funded / declined. Admins read the Slack post and act there;
    // an approval queue nobody opens is just a place deals go to stall.
    //
    // The admin KEEPS the veto — flipping a row to 'rejected' on the review card
    // still pulls it out (skipped_by_admin) and the submit route still refuses
    // it. What changed is the default, not the authority.
    //
    // admin_reviewed_by stays null: nobody reviewed it, and stamping a
    // reviewer's id would fabricate an audit trail. admin_reviewed_at records
    // when it was cleared. `source` already tells the two apart.
    const assignedAt = new Date().toISOString();
    const rows = lenderData
      .filter((l) => decisions[decisionKey(l)] === "approved")
      .map((l) => ({
        client_id: selectedClientId,
        lender_name: l.lender_name,
        specialty: l.specialty ?? null,
        tier_label: l.tier_label ?? null,
        decision: "approved" as const,
        payment_type: l.payment_type ?? null,
        min_funding: l.min_funding ?? null,
        max_funding: l.max_funding ?? null,
        assigned_at: assignedAt,
        source: "match_tool",
        admin_review: "approved" as const,
        admin_reviewed_at: assignedAt,
        // The round this match belongs to. Null only when the client has no
        // funding_deals row at all, which is the pre-rounds shape; everything
        // downstream reads null as "legacy, oldest round".
        business_profile_id: activeBusinessId,
        funding_deal_id: activeDealId,
      }));

    if (rows.length > 0) {
      await supabase.from("client_lender_assignments").insert(rows);
      const recommendedNames = rows
        .map((r) => {
          const prog = [r.specialty, r.tier_label].filter(Boolean).join(" · ");
          return `${r.lender_name}${prog ? ` (${prog})` : ""}`;
        })
        .join(", ");
      await supabase.from("loan_status_history").insert({
        client_vault_id: selectedClientId,
        status: "lender_matched",
        changed_by_role: "underwriting",
        note: `${rows.length} lender${rows.length > 1 ? "s" : ""} selected and cleared for submission: ${recommendedNames}`,
      });
    }

    // Fan out admin notifications (best-effort, non-blocking for UX).
    // These are INFORMATIONAL now, not a handoff — the lenders are already
    // submittable when this fires. The Slack post is where admins actually read
    // it and is the place to raise an objection.
    try {
      const { notified, emailed, admins } = await notifyAdminsOfLenderMatchSaved(
        selectedClientId,
        rows.map((r) => ({ lender_name: r.lender_name, specialty: r.specialty })),
        // Ship the basis with the notification: an admin deciding whether to
        // veto a lender needs to know whether statements were read or whether
        // this ran on intake data.
        {
          basis: dealSource === "none" ? "profile" : dealSource,
          analysis_date: analysisDate,
          fico: deal.fico,
          tib_months: deal.tibMonths,
          avg_revenue: deal.avgRevenue,
          num_open_positions: deal.numOpenPositions,
          capital_requested: deal.capitalRequested,
        }
      );
      if (rows.length === 0) {
        toast.success("Cleared selections");
      } else if (admins === 0) {
        toast.warning("Saved and ready to submit, but no admins are configured to notify");
      } else {
        toast.success(
          `Ready to submit · ${notified}/${admins} admin${admins > 1 ? "s" : ""} notified${emailed > 0 ? `, ${emailed} emailed` : ""}`
        );
      }
    } catch (err) {
      console.error("admin notify failed (non-fatal):", err);
    }

    setIsSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  }

  const dataEntered = deal.fico || deal.tibMonths || deal.avgRevenue || filterState || filterIndustry;

  return (
    <div
      className="min-h-screen text-slate-900 space-y-4 p-4"
      style={{ background: "#f8fafc", fontFamily: "'IBM Plex Mono', monospace" }}
    >
      {/* Header */}
      <div className="rounded-xl border border-slate-200 p-4" style={{ background: "#ffffff" }}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">Lender Match</div>
            <div className="flex items-center gap-3 mt-2">
              <div ref={clientSearchRef} className="relative flex-1 min-w-[280px]">
                <div className="relative">
                  <svg
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    value={clientDropdownOpen ? clientSearch : selectedClient ? `${selectedClient.company_name} (${selectedClient.client_name})` : clientSearch}
                    placeholder="Search by client or company..."
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      if (!clientDropdownOpen) setClientDropdownOpen(true);
                    }}
                    onFocus={() => {
                      setClientDropdownOpen(true);
                      setClientSearch("");
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded pl-8 pr-7 py-1.5 text-sm font-mono text-slate-900 focus:outline-none focus:border-emerald-500"
                  />
                  {selectedClientId && (
                    <button
                      type="button"
                      onClick={clearSelectedClient}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-sm leading-none"
                      aria-label="Clear selection"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {clientDropdownOpen && (
                  <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                    {filteredClientList.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-400 font-mono">No matching client found.</div>
                    ) : (
                      filteredClientList.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectClient(c.id)}
                          className={`w-full text-left px-3 py-2 text-sm font-mono hover:bg-emerald-50 ${
                            c.id === selectedClientId ? "bg-emerald-50 text-emerald-700" : "text-slate-900"
                          }`}
                        >
                          <span className="font-semibold">{c.company_name}</span>
                          <span className="text-slate-500"> ({c.client_name})</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {isLoadingClient && <span className="text-xs text-blue-400 animate-pulse">Loading...</span>}
            </div>
          </div>
          {dataEntered && (
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Eligible</span>
                <span className="text-lg font-mono font-bold text-green-400">{passedCount}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Disqualified</span>
                <span className="text-lg font-mono font-bold text-red-400">{disqualifiedCount}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Recommended</span>
                <span className="text-lg font-mono font-bold text-emerald-400">{recommendedCount}</span>
              </div>
            </div>
          )}
        </div>
        {/* Source badge — a profile-based match is valid, but it must never be
            mistaken for one backed by read statements. */}
        {dealSource !== "none" && (
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${
                dealSource === "analysis"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : dealSource === "manual"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-slate-50 text-slate-600 border-slate-200"
              }`}
            >
              {dealSource === "analysis"
                ? `Bank analysis${analysisDate ? ` · ${new Date(analysisDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}`
                : dealSource === "manual"
                  ? "Manually adjusted"
                  : "Client profile · no bank analysis"}
            </span>
            {dealSource === "profile" && (
              <span className="text-[10px] font-mono text-slate-400">
                Matching on vault intake data — daily balance and negative days unknown, so those rules are skipped.
              </span>
            )}
          </div>
        )}

        {/* Match criteria — editable.
            These are the values the engine runs on, wherever they came from.
            They have to be editable because a file with no bank analysis still
            has numbers only the analyst knows (negative days, daily balance,
            an updated FICO pull), and because a stale profile figure shouldn't
            force a full statement analysis just to re-run the match. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-2">
          {([
            { key: "fico", label: "FICO", value: deal.fico, money: false },
            { key: "tibMonths", label: "TIB (mo)", value: deal.tibMonths, money: false },
            { key: "avgRevenue", label: "Avg Mo Revenue", value: deal.avgRevenue, money: true },
            { key: "avgMonthlyDeposits", label: "Avg Mo Deposits", value: deal.avgMonthlyDeposits, money: true },
            { key: "avgDailyBalance", label: "Avg Daily Bal", value: deal.avgDailyBalance, money: true },
            { key: "totalNegDays", label: "Neg Days", value: deal.totalNegDays, money: false },
            { key: "numOpenPositions", label: "Positions", value: deal.numOpenPositions, money: false },
            { key: "capitalRequested", label: "Requested", value: deal.capitalRequested, money: true },
          ] as const).map(({ key, label, value, money }) => (
            <div key={key} className="bg-white border border-slate-200 rounded-lg px-2 py-1.5">
              <label className="block text-[9px] text-gray-500 uppercase tracking-widest mb-0.5">{label}</label>
              <div className="flex items-center gap-0.5">
                {money && <span className="text-xs text-slate-400">$</span>}
                <input
                  type="number"
                  min={0}
                  value={value || ""}
                  placeholder="—"
                  onChange={(e) => editDeal({ [key]: Number(e.target.value) || 0 } as Partial<DealSummary>)}
                  className="w-full bg-transparent text-xs font-mono font-bold text-blue-500 focus:outline-none placeholder:text-slate-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          ))}
          <label className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 flex flex-col justify-between cursor-pointer">
            <span className="text-[9px] text-gray-500 uppercase tracking-widest mb-0.5">Bankruptcy</span>
            <span className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={deal.hasBankruptcy}
                onChange={(e) => editDeal({ hasBankruptcy: e.target.checked })}
                className="accent-emerald-600"
              />
              <span className="text-xs font-mono font-bold text-blue-500">{deal.hasBankruptcy ? "Yes" : "No"}</span>
            </span>
          </label>
        </div>

        {/* Read-only context from the file — not match inputs, but the analyst
            reads them alongside the criteria. */}
        <div className="flex flex-wrap gap-2 mt-2">
          {[
            { label: "Type", value: deal.proposedLoanType || null },
            { label: "Purpose", value: deal.loanPurpose || null },
            { label: "Start Date", value: deal.businessStartDate || null },
            { label: "Owners", value: deal.numOwners || null },
          ]
            .filter((p) => p.value !== null)
            .map(({ label, value }) => (
              <div key={label} className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1">
                <span className="text-xs text-gray-500">{label}</span>
                <span className="text-xs font-mono font-bold text-blue-400">{value}</span>
              </div>
            ))}
        </div>

        {/* Ownership Details */}
        {deal.ownershipDetails.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Ownership Structure</div>
            <div className="flex flex-wrap gap-4">
              {deal.ownershipDetails.map((owner, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span className="text-xs text-slate-600">{owner.name}</span>
                  <span className="text-xs font-mono font-bold text-blue-400">{owner.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {loadingLenders && (
        <div className="text-sm text-blue-400 font-mono animate-pulse">Loading lender guidelines...</div>
      )}

      {/* Match Filters */}
      <div className="rounded-xl border border-slate-200 p-4" style={{ background: "#ffffff" }}>
        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Match Filters</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Business State</label>
            <input
              type="text"
              value={filterState}
              onChange={(e) => {
                const val = e.target.value.toUpperCase().slice(0, 2);
                setFilterState(val);
                setDeal((prev) => ({ ...prev, state: val }));
              }}
              placeholder="FL"
              className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm font-mono text-slate-900 uppercase focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Industry / Business Type</label>
            <NaicsCombobox
              value={filterIndustry}
              onChange={(val) => {
                setFilterIndustry(val);
                setDeal((prev) => ({ ...prev, industry: val }));
              }}
              placeholder="Select NAICS industry…"
              triggerClassName="bg-slate-50 py-1.5 rounded"
            />
          </div>
        </div>
      </div>

      {/* Eligibility bar */}
      {dataEntered && (
        <div className="rounded-xl border border-slate-200 p-4" style={{ background: "#ffffff" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-widest">Eligibility</span>
            <span className="text-xs font-mono text-gray-400">
              {viableResults.length > 0 ? Math.round((passedCount / viableResults.length) * 100) : 0}% of viable lenders ({viableResults.length} with full guidelines)
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-500"
              style={{ width: `${viableResults.length > 0 ? (passedCount / viableResults.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {!dataEntered && (
        <div className="rounded-lg border border-blue-800/40 bg-blue-900/10 px-4 py-3 text-xs text-blue-400 font-mono">
          Select a client above to load their file and run lender matching. A bank analysis is used when one exists — otherwise the match runs on the profile captured at vault creation.
        </div>
      )}

      {/* Save bar — UW saves their selection; it is submittable on save and
          admins are notified for information. */}
      {selectedClientId && recommendedCount > 0 && (
        <div className="rounded-xl border border-slate-200 p-3 flex items-center justify-between flex-wrap gap-3" style={{ background: "#ffffff" }}>
          <div className="text-xs text-gray-500 font-mono">
            <span className="text-emerald-600 font-bold">{recommendedCount} selected</span>
            {" · ready to submit on save · admin notified in Slack"}
          </div>
          <div className="flex items-center gap-3">
            {saveSuccess && <span className="text-xs text-emerald-600 font-mono">✓ Saved successfully</span>}
            <button
              onClick={saveAssignments}
              disabled={isSaving}
              className="px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-wider rounded border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:border-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? "Saving..." : "Save Assignments"}
            </button>
          </div>
        </div>
      )}

      {/* Results summary — at-a-glance breakdown of the three result buckets */}
      {dataEntered && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-green-200 bg-green-50/60 px-4 py-3">
            <div className="text-2xl font-black tabular-nums text-green-600">{shownEligible}</div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-green-700/80 mt-0.5">Eligible</div>
            <div className="text-[10px] font-mono text-green-600/60 mt-0.5">meets all criteria</div>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50/50 px-4 py-3">
            <div className="text-2xl font-black tabular-nums text-red-500">{shownFlagged}</div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-red-600/80 mt-0.5">Flagged</div>
            <div className="text-[10px] font-mono text-red-500/60 mt-0.5">has issues to review</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-2xl font-black tabular-nums text-slate-400">{shownIncomplete}</div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-0.5">Not scored</div>
            <div className="text-[10px] font-mono text-slate-400 mt-0.5">no guidelines — pick by hand</div>
          </div>
        </div>
      )}

      {/* Program tabs + results only render once a client's deal is loaded.
          Without a deal there's nothing to check against, so the matcher flags
          nothing and every lender trivially "passes" — a misleading full
          Eligible list. Gate the whole block on dataEntered. */}
      {dataEntered && (
      <>
      {/* Program tabs — multi-select. Empty selection = all programs. Defaults to
          the client's proposed loan type when a client is loaded. */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setSelectedSpecialties(new Set())}
          className={`px-2.5 py-1 text-xs font-mono uppercase tracking-wider rounded border transition-all ${selectedSpecialties.size === 0
              ? "bg-emerald-600 border-emerald-600 text-white"
              : "border-slate-200 text-gray-500 hover:border-emerald-500 hover:text-emerald-600"
            }`}
        >
          All
        </button>
        {specialtyTabs.map((tab) => {
          const active = selectedSpecialties.has(tab.key);
          return (
            <button
              key={tab.key}
              onClick={() => toggleSpecialty(tab.key)}
              aria-pressed={active}
              className={`px-2.5 py-1 text-xs font-mono uppercase tracking-wider rounded border transition-all ${active
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : "border-slate-200 text-gray-500 hover:border-emerald-500 hover:text-emerald-600"
                }`}
            >
              {tab.label}
            </button>
          );
        })}
        <button
          onClick={() => setShowPassedOnly(!showPassedOnly)}
          className={`px-3 py-1 text-xs font-mono uppercase tracking-wider rounded border transition-all ${showPassedOnly
              ? "bg-emerald-100 border-emerald-300 text-emerald-700"
              : "border-slate-200 text-gray-500 hover:text-emerald-600"
            }`}
        >
          {showPassedOnly ? "✓ Eligible Only" : "Show All"}
        </button>
        <span className="text-xs text-gray-600 font-mono ml-auto">
          {selectedSpecialties.size > 0 && (
            <button
              onClick={() => setSelectedSpecialties(new Set())}
              className="text-emerald-600 hover:text-emerald-700 underline mr-2"
            >
              clear {selectedSpecialties.size}
            </button>
          )}
          {filteredViable.length + filteredIncomplete.length} shown
        </span>
      </div>

      {/* Matched Lenders Section */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setCollapsedSections((s) => ({ ...s, matched: !s.matched }))}
          className="flex items-center gap-3 w-full group"
        >
          <div className="h-px flex-1 bg-slate-100" />
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 group-hover:text-gray-700 uppercase tracking-[0.2em] transition-colors">
            <span className="text-[8px] leading-none inline-block w-2">{collapsedSections.matched ? "▶" : "▼"}</span>
            Matched Lenders ({filteredViable.length})
          </span>
          <div className="h-px flex-1 bg-slate-100" />
        </button>

        {!collapsedSections.matched && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filteredViable.length === 0 && (
            <div className="lg:col-span-2 py-8 text-center border border-dashed border-slate-200 rounded-xl">
              <span className="text-xs text-gray-600 font-mono uppercase">No matched lenders found</span>
            </div>
          )}
          {filteredViable.map((result, i) => renderLenderCard(result, `viable-${i}`))}
        </div>
        )}
      </div>

      {/* Incomplete Guidelines Section */}
      <div className="space-y-3 pt-4">
        <button
          type="button"
          onClick={() => setCollapsedSections((s) => ({ ...s, incomplete: !s.incomplete }))}
          className="flex items-center gap-3 w-full group"
        >
          <div className="h-px flex-1 bg-slate-100" />
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 group-hover:text-gray-700 uppercase tracking-[0.2em] transition-colors">
            <span className="text-[8px] leading-none inline-block w-2">{collapsedSections.incomplete ? "▶" : "▼"}</span>
            Incomplete Guidelines ({filteredIncomplete.length})
          </span>
          <div className="h-px flex-1 bg-slate-100" />
        </button>

        {!collapsedSections.incomplete && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filteredIncomplete.length === 0 && (
            <div className="lg:col-span-2 py-8 text-center border border-dashed border-slate-200 rounded-xl">
              <span className="text-xs text-gray-600 font-mono uppercase">No lenders with incomplete guidelines</span>
            </div>
          )}
          {filteredIncomplete.map((result, i) => renderLenderCard(result, `incomplete-${i}`, true))}
        </div>
        )}
      </div>
      </>
      )}
    </div>
  );

  function renderLenderCard(result: MatchResult, key: string, isIncomplete = false) {
    const dKey = decisionKey(result.lender);
    const decision = decisions[dKey] ?? null;
    // What this lender said on an earlier round, if anything. Advisory only —
    // it never disables the checkbox. A decline can be months stale and the
    // file may have changed underneath it; UW is told and decides.
    const prior = priorOutcomes.get(result.lender.lender_name) ?? null;
    const isExpanded = expandedKey === key;
    const specColor = SPECIALTY_COLORS[result.lender.specialty ?? ""] ?? "bg-slate-100 text-gray-400 border-slate-200";
    const minF = typeof result.lender.min_funding === "number" ? result.lender.min_funding : null;
    const maxF = typeof result.lender.max_funding === "number" ? result.lender.max_funding : null;

    const cardBorder =
      decision === "approved" ? "border-emerald-400" :
        decision === "rejected" ? "border-orange-300" :
          result.passed && !isIncomplete ? "border-green-200 hover:border-green-400" :
            "border-slate-200 hover:border-red-300";

    const cardBg =
      decision === "approved" ? "#ecfdf5" :
        decision === "rejected" ? "#fff7ed" :
          result.passed && !isIncomplete ? "#ffffff" : "#f8fafc";

    // Left accent stripe encodes the result bucket at a glance.
    const accent =
      decision === "approved" ? "border-l-emerald-500" :
        decision === "rejected" ? "border-l-orange-400" :
          isIncomplete ? "border-l-slate-300" :
            result.passed ? "border-l-green-400" : "border-l-red-400";

    // Status pill — the single most useful label for triaging a card.
    const statusPill = isIncomplete
      ? { text: "Incomplete", cls: "bg-slate-100 text-slate-500 border-slate-200" }
      : result.passed
        ? { text: "✓ Eligible", cls: "bg-green-100 text-green-700 border-green-300" }
        : { text: `${result.flags.length} issue${result.flags.length === 1 ? "" : "s"}`, cls: "bg-red-100 text-red-700 border-red-300" };

    return (
      <div key={key} className={`rounded-xl border border-l-4 transition-all ${cardBorder} ${accent} ${isIncomplete ? 'opacity-80' : ''}`} style={{ background: cardBg }}>
        <div
          className="flex items-start gap-3 px-3 pt-3 pb-2 cursor-pointer"
          onClick={() => setExpandedKey(isExpanded ? null : key)}
        >
          <div
            className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${isIncomplete ? 'bg-slate-300' : (result.passed ? "bg-green-400" : "bg-red-500")}`}
            style={{ boxShadow: !isIncomplete ? (result.passed ? "0 0 6px #4ade80" : "0 0 6px #f87171") : "none" }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-900 font-mono">{result.lender.lender_name}</span>
              <span className={`text-[10px] font-mono font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 ${statusPill.cls}`}>
                {statusPill.text}
              </span>
              {result.lender.specialty && (
                <span className={`text-xs font-mono border rounded px-1.5 py-0.5 ${specColor}`}>
                  {result.lender.specialty}
                </span>
              )}
              {result.lender.tier_label && (
                <span className="text-xs font-mono border rounded px-1.5 py-0.5 bg-slate-100 text-slate-600 border-slate-300">
                  {result.lender.tier_label}
                </span>
              )}
              {(minF || maxF) && (
                <span className="text-xs text-gray-500 font-mono">
                  {minF ? `$${(minF / 1000).toFixed(0)}K` : ""}
                  {minF && maxF ? " – " : ""}
                  {maxF ? `$${(maxF / 1000).toFixed(0)}K` : ""}
                </span>
              )}
              {decision === "approved" && (
                <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 rounded px-1.5 py-0.5">
                  RECOMMENDED
                </span>
              )}
              {prior && (
                <span
                  title={describeOutcome(prior)}
                  className={`text-[10px] font-mono font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 ${
                    prior.status === "funded"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                      : prior.is_warning
                        ? "bg-amber-50 text-amber-800 border-amber-300"
                        : "bg-slate-100 text-slate-600 border-slate-300"
                  }`}
                >
                  {prior.round_no ? `R${prior.round_no} ` : ""}
                  {prior.status === "funded"
                    ? "funded"
                    : prior.status === "declined_by_lender"
                      ? "declined"
                      : prior.status === "approved_by_lender"
                        ? "approved"
                        : "submitted"}
                </span>
              )}
            </div>
            {/* The reason, spelled out. The badge alone says "they passed";
                what UW actually acts on is WHY, and whether it still holds. */}
            {prior?.note && (
              <div
                className={`text-xs mt-1 ${prior.is_warning ? "text-amber-700" : "text-slate-500"}`}
              >
                {prior.is_warning ? "⚠ " : ""}
                {describeOutcome(prior)}
              </div>
            )}
            {!isIncomplete && result.passed && result.warnings.length === 0 && (
              <div className="text-xs text-green-600 mt-0.5">✓ Meets all entered criteria</div>
            )}
            {isIncomplete && (
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">
                Not scored — no guidelines on file. Selectable anyway.
              </div>
            )}
            {result.flags.length > 0 && !isIncomplete && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {result.flags.slice(0, 2).map((f, fi) => (
                  <span key={fi} className="text-xs bg-red-50 border border-red-200 text-red-600 rounded px-1.5 py-0.5 font-mono">
                    {f}
                  </span>
                ))}
                {result.flags.length > 2 && (
                  <span className="text-xs text-gray-500 font-mono">+{result.flags.length - 2} more</span>
                )}
              </div>
            )}
            {result.warnings.map((w, wi) => (
              <div key={wi} className="text-xs text-orange-600 mt-0.5">⚠ {w}</div>
            ))}
          </div>
          <span className="text-gray-600 text-xs flex-shrink-0 mt-1">{isExpanded ? "▲" : "▼"}</span>
        </div>

        {/* Action row.
            EVERY card can be selected, including the ones with no guidelines.
            Incomplete used to offer only "+ Add guidelines", which made an
            unscoreable lender unselectable — and some lenders simply never give
            us their guidelines, so the card was a dead end for exactly the
            lenders that need to be picked by hand. Adding guidelines is still
            offered there, as the secondary action it actually is. */}
        <div className="flex items-center gap-2 px-3 pb-3">
          <button
            onClick={() => toggleRecommended(result.lender)}
            className={`flex-1 py-1.5 text-xs font-mono font-bold uppercase tracking-wider rounded border transition-all ${decision === "approved"
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "border-emerald-300 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-500"
              }`}
          >
            {decision === "approved" ? "★ Selected — click to remove" : "★ Select for Submission"}
          </button>
          {isIncomplete && (
            <Link
              href={guidelinesHref(result.lender.lender_name)}
              onClick={(e) => e.stopPropagation()}
              className="py-1.5 px-3 text-xs font-mono font-bold uppercase tracking-wider rounded border border-slate-300 text-slate-600 hover:bg-slate-100 hover:text-slate-800 hover:border-slate-400 transition-all text-center whitespace-nowrap"
            >
              + Guidelines
            </Link>
          )}
        </div>

        {isExpanded && (
          <div className="px-3 pb-3 border-t border-slate-200 pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {([
                ["Min FICO", result.lender.min_fico ?? "—"],
                ["Min TIB", result.lender.time_in_business_months ? `${result.lender.time_in_business_months}mo` : "—"],
                ["Min Monthly Revenue", result.lender.avg_monthly_revenue ? fmt$(result.lender.avg_monthly_revenue) : "—"],
                ["Max Neg Days", result.lender.negative_days ?? "—"],
                ["Min Positions", result.lender.min_positions ?? "—"],
                ["Max Positions", result.lender.number_of_positions ?? "—"],
                ["Payment Type", result.lender.payment_type ?? "—"],
                ["Bankruptcies OK", result.lender.bankruptcies ?? "—"],
                ["Restricted States", result.lender.restricted_states || "None"],
              ] as [string, string | number][]).map(([label, val]) => (
                <div key={label} className="flex justify-between gap-2 bg-slate-50 rounded px-2 py-1">
                  <span className="text-gray-500">{label}</span>
                  <span className={`font-mono text-right ${val === 0 || val === "—" ? 'text-red-500/70' : 'text-slate-700'}`}>{String(val)}</span>
                </div>
              ))}
            </div>
            {result.lender.preferred_industries && (
              <div className="bg-slate-50 rounded px-2 py-2">
                <div className="text-xs text-green-600 uppercase tracking-wider mb-1">Preferred Industries</div>
                <div className="text-xs text-slate-600 leading-relaxed">{result.lender.preferred_industries}</div>
              </div>
            )}
            {result.lender.restricted_industries && (
              <div className="bg-slate-50 rounded px-2 py-2">
                <div className="text-xs text-red-600 uppercase tracking-wider mb-1">Restricted Industries</div>
                <div className="text-xs text-slate-600 leading-relaxed">{result.lender.restricted_industries}</div>
              </div>
            )}
            {result.lender.restricted_industry_exceptions && (
              <div className="bg-slate-50 rounded px-2 py-2">
                <div className="text-xs text-orange-500 uppercase tracking-wider mb-1">Exceptions</div>
                <div className="text-xs text-slate-600 leading-relaxed">{result.lender.restricted_industry_exceptions}</div>
              </div>
            )}
            {result.lender.additional_info && (
              <div className="bg-slate-50 rounded px-2 py-2">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Additional Notes</div>
                <div className="text-xs text-slate-600 leading-relaxed">{result.lender.additional_info}</div>
              </div>
            )}
            {result.flags.length > 0 && !isIncomplete && (
              <div className="space-y-1">
                {result.flags.map((f, fi) => (
                  <div key={fi} className="text-xs bg-red-50 border border-red-200 text-red-600 rounded px-2 py-1 font-mono">
                    ✗ {f}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
}
