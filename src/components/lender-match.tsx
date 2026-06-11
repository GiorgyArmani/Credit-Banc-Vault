"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { DealSummary } from "./bank-analysis";
import { createClient } from "@/lib/supabase/client";
import { notifyAdminsOfLenderMatchSaved } from "@/app/actions/lender-match-notifications";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lender {
  lender_name: string;
  specialty: string | null;
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
// New, simpler model: UW selects which matched lenders to recommend to admin.
// Admin then approves/rejects via admin_review on the unified client view.
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

function hasMinViableGuidelines(l: Lender): boolean {
  return (l.min_fico ?? 0) > 0 && (l.time_in_business_months ?? 0) > 0 && (l.avg_monthly_revenue ?? 0) > 0;
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

// Picker dropdown + ownership display only.
// State/industry/match criteria come from bank_analysis_results.
interface ClientOption {
  id: string;
  client_name: string;
  company_name: string;
  industry?: string;
  company_state?: string;
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function LenderMatch({ dealSummary: propDeal = DEFAULT_DEAL, state: propState = "", industry: propIndustry = "" }: LenderMatchProps) {
  const searchParams = useSearchParams();
  const [deal, setDeal] = useState<DealSummary>({ ...DEFAULT_DEAL, ...propDeal });
  const [filterState, setFilterState] = useState(propState || propDeal.state || "");
  const [filterIndustry, setFilterIndustry] = useState(propIndustry || propDeal.industry || "");

  // Accept ?client=<id> from URL so deep-links from the client detail view
  // auto-select the client and load their saved match.
  const initial_client_id = searchParams?.get("client") ?? "";
  const [clientList, setClientList] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>(initial_client_id);
  const [isLoadingClient, setIsLoadingClient] = useState(false);
  const [specialtyFilter, setSpecialtyFilter] = useState("All");
  const [showPassedOnly, setShowPassedOnly] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
        proposed_loan_type, loan_purpose, business_start_date, number_of_owners,
        owner_1_name, owner_1_ownership_pct,
        owner_2_name, owner_2_ownership_pct,
        owner_3_name, owner_3_ownership_pct,
        owner_4_name, owner_4_ownership_pct,
        owner_5_name, owner_5_ownership_pct
      `)
      .order("client_name", { ascending: true })
      .then(({ data }) => {
        if (data) setClientList(data as any as ClientOption[]);
      });
  }, []);

  const loadDecisions = useCallback(async (clientId: string) => {
    if (!clientId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("client_lender_assignments")
      .select("lender_name, specialty, decision")
      .eq("client_id", clientId);
    if (data) {
      const map: Record<string, LenderDecision> = {};
      data.forEach((row: any) => {
        map[`${row.lender_name}-${row.specialty ?? ""}`] = row.decision;
      });
      setDecisions(map);
    }
  }, []);

  // Change 2: Single query — bank_analysis_results is source of truth
  async function loadClientResults(clientId: string) {
    if (!clientId) return;
    setIsLoadingClient(true);
    const supabase = createClient();

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

    if (analysis && !aError) {
      const client = clientList.find((c) => c.id === clientId);
      const newDeal: DealSummary = {
        fico: analysis.fico || 0,
        tibMonths: analysis.tib_months || 0,
        avgRevenue: Number(analysis.avg_revenue) || 0,
        avgDailyBalance: Number(analysis.avg_daily_balance) || 0,
        totalNegDays: analysis.total_neg_days || 0,
        numOpenPositions: analysis.num_open_positions || 0,
        avgMonthlyDeposits: Number(analysis.avg_monthly_deposits) || 0,
        hasBankruptcy: analysis.has_bankruptcy || false,
        capitalRequested: Number(analysis.capital_requested) || 0,
        state: analysis.company_state || client?.company_state || "",
        industry: analysis.industry || client?.industry || "",
        businessName: analysis.business_name || client?.company_name || "",
        ownerName: analysis.owner_name || client?.client_name || "",
        proposedLoanType: client?.proposed_loan_type || "",
        loanPurpose: client?.loan_purpose || "",
        businessStartDate: client?.business_start_date
          ? new Date(client.business_start_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "",
        numOwners: client?.number_of_owners || "",
        ownershipDetails: [
          { name: client?.owner_1_name || "", pct: Number(client?.owner_1_ownership_pct) || 0 },
          { name: client?.owner_2_name || "", pct: Number(client?.owner_2_ownership_pct) || 0 },
          { name: client?.owner_3_name || "", pct: Number(client?.owner_3_ownership_pct) || 0 },
          { name: client?.owner_4_name || "", pct: Number(client?.owner_4_ownership_pct) || 0 },
          { name: client?.owner_5_name || "", pct: Number(client?.owner_5_ownership_pct) || 0 },
        ].filter((o) => o.name && o.pct > 0),
      };
      setDeal(newDeal);
      setFilterState(newDeal.state || "");
      setFilterIndustry(newDeal.industry || "");
      setDecisions({});
      await loadDecisions(clientId);
    } else {
      console.warn(`No bank analysis found for client ${clientId}`);
    }
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
        const uniqueMap = new Map<string, Lender>();
        (data as Lender[]).forEach((l) => {
          const key = `${l.lender_name}-${l.specialty || ""}`;
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
  const specialties = ["All", ...Array.from(new Set(lenderData.map((l) => l.specialty ?? "Unknown"))).sort()];

  const applyFilters = (list: MatchResult[]) =>
    list.filter((r) => {
      if (showPassedOnly && !r.passed) return false;
      if (specialtyFilter !== "All" && (r.lender.specialty ?? "Unknown") !== specialtyFilter) return false;
      return true;
    });

  const filteredViable = applyFilters(viableResults);
  const filteredIncomplete = applyFilters(incompleteResults);

  const decisionKey = (lender: Lender) => `${lender.lender_name}-${lender.specialty ?? ""}`;

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

    // Re-running the match wipes prior matches AND any admin reviews on them.
    // Only rows from the matching tool are cleared — admin-added manual lenders
    // (source = 'admin_manual') are preserved so the admin doesn't lose their
    // additions when UW re-runs the engine.
    await supabase
      .from("client_lender_assignments")
      .delete()
      .eq("client_id", selectedClientId)
      .eq("source", "match_tool");

    // Only insert lenders UW recommended (decision === "approved").
    // Skipped/unselected matches are simply not stored — admin sees a clean
    // list of recommendations on their review queue, not every machine match.
    const rows = Object.entries(decisions)
      .filter(([, d]) => d === "approved")
      .map(([key]) => {
        const dashIdx = key.indexOf("-");
        const lenderName = key.slice(0, dashIdx);
        const specialty = key.slice(dashIdx + 1) || null;
        const matchedLender = lenderData.find(
          (l) => l.lender_name === lenderName && (l.specialty ?? "") === (specialty ?? "")
        );
        return {
          client_id: selectedClientId,
          lender_name: lenderName,
          specialty,
          decision: "approved" as const,
          payment_type: matchedLender?.payment_type ?? null,
          min_funding: matchedLender?.min_funding ?? null,
          max_funding: matchedLender?.max_funding ?? null,
          assigned_at: new Date().toISOString(),
          source: "match_tool",
        };
      });

    if (rows.length > 0) {
      await supabase.from("client_lender_assignments").insert(rows);
      const recommendedNames = rows
        .map((r) => `${r.lender_name}${r.specialty ? ` (${r.specialty})` : ""}`)
        .join(", ");
      await supabase.from("loan_status_history").insert({
        client_vault_id: selectedClientId,
        status: "lender_matched",
        changed_by_role: "underwriting",
        note: `${rows.length} lender${rows.length > 1 ? "s" : ""} recommended for admin review: ${recommendedNames}`,
      });
    }

    // Fan out admin notifications (best-effort, non-blocking for UX).
    // Admins land on /admin/dashboard's "Pending lender reviews" tile and the
    // notification bell next to a deep-link to the unified client view.
    try {
      const { notified, emailed, admins } = await notifyAdminsOfLenderMatchSaved(
        selectedClientId,
        rows.map((r) => ({ lender_name: r.lender_name, specialty: r.specialty }))
      );
      if (rows.length === 0) {
        toast.success("Cleared recommendations");
      } else if (admins === 0) {
        toast.warning("Saved, but no admins are configured to notify");
      } else {
        toast.success(
          `Saved · ${notified}/${admins} admin${admins > 1 ? "s" : ""} notified${emailed > 0 ? `, ${emailed} emailed` : ""}`
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
          <div>
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">Lender Match</div>
            <div className="flex items-center gap-3 mt-2">
              <select
                value={selectedClientId}
                onChange={(e) => {
                  setSelectedClientId(e.target.value);
                  loadClientResults(e.target.value);
                }}
                className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm font-mono text-slate-900 focus:outline-none focus:border-emerald-500 min-w-[240px]"
              >
                <option value="">Select Client Analysis...</option>
                {clientList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name} ({c.client_name})
                  </option>
                ))}
              </select>
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

        {/* Deal summary pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: "FICO", value: deal.fico && deal.fico > 0 ? String(deal.fico) : null },
            { label: "TIB", value: deal.tibMonths && deal.tibMonths > 0 ? `${deal.tibMonths}mo${deal.businessStartDate ? ` (${deal.businessStartDate})` : ""}` : null },
            { label: "Avg Revenue", value: deal.avgRevenue && deal.avgRevenue > 0 ? fmt$(deal.avgRevenue) : null },
            { label: "Neg Days", value: deal.totalNegDays && deal.totalNegDays > 0 ? String(deal.totalNegDays) : null },
            { label: "Positions", value: deal.numOpenPositions && deal.numOpenPositions > 0 ? String(deal.numOpenPositions) : null },
            { label: "Requested", value: deal.capitalRequested && deal.capitalRequested > 0 ? fmt$(deal.capitalRequested) : null },
            { label: "Type", value: deal.proposedLoanType || null },
            { label: "Purpose", value: deal.loanPurpose || null },
            { label: "Start Date", value: deal.businessStartDate || null },
            { label: "Owners", value: deal.numOwners || null },
            { label: "Bankruptcy", value: deal.hasBankruptcy ? "Yes" : null },
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
            <input
              type="text"
              value={filterIndustry}
              onChange={(e) => {
                setFilterIndustry(e.target.value);
                setDeal((prev) => ({ ...prev, industry: e.target.value }));
              }}
              placeholder="e.g. Restaurant, Trucking..."
              className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm font-mono text-slate-900 focus:outline-none focus:border-emerald-500 transition-colors"
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
          Select a client above to load their bank analysis and run lender matching.
        </div>
      )}

      {/* Save bar — UW saves their recommendations; admins are notified */}
      {selectedClientId && recommendedCount > 0 && (
        <div className="rounded-xl border border-slate-200 p-3 flex items-center justify-between flex-wrap gap-3" style={{ background: "#ffffff" }}>
          <div className="text-xs text-gray-500 font-mono">
            <span className="text-emerald-600 font-bold">{recommendedCount} recommended</span>
            {" · admin will be notified to approve which lenders to contact"}
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

      {/* Specialty tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {specialties.map((s) => (
          <button
            key={s}
            onClick={() => setSpecialtyFilter(s)}
            className={`px-2.5 py-1 text-xs font-mono uppercase tracking-wider rounded border transition-all ${specialtyFilter === s
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "border-slate-200 text-gray-500 hover:border-emerald-500 hover:text-emerald-600"
              }`}
          >
            {s}
          </button>
        ))}
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
          {filteredViable.length + filteredIncomplete.length} shown
        </span>
      </div>

      {/* Matched Lenders Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-100" />
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">Matched Lenders ({filteredViable.length})</span>
          <div className="h-px flex-1 bg-slate-100" />
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filteredViable.length === 0 && (
            <div className="lg:col-span-2 py-8 text-center border border-dashed border-slate-200 rounded-xl">
              <span className="text-xs text-gray-600 font-mono uppercase">No matched lenders found</span>
            </div>
          )}
          {filteredViable.map((result, i) => renderLenderCard(result, `viable-${i}`))}
        </div>
      </div>

      {/* Incomplete Guidelines Section */}
      <div className="space-y-3 pt-4">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-100" />
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">Incomplete Guidelines ({filteredIncomplete.length})</span>
          <div className="h-px flex-1 bg-slate-100" />
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filteredIncomplete.length === 0 && (
            <div className="lg:col-span-2 py-8 text-center border border-dashed border-slate-200 rounded-xl">
              <span className="text-xs text-gray-600 font-mono uppercase">No lenders with incomplete guidelines</span>
            </div>
          )}
          {filteredIncomplete.map((result, i) => renderLenderCard(result, `incomplete-${i}`, true))}
        </div>
      </div>
    </div>
  );

  function renderLenderCard(result: MatchResult, key: string, isIncomplete = false) {
    const dKey = decisionKey(result.lender);
    const decision = decisions[dKey] ?? null;
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

    return (
      <div key={key} className={`rounded-xl border transition-all ${cardBorder} ${isIncomplete ? 'opacity-70' : ''}`} style={{ background: cardBg }}>
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
              {result.lender.specialty && (
                <span className={`text-xs font-mono border rounded px-1.5 py-0.5 ${specColor}`}>
                  {result.lender.specialty}
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
                  ★ RECOMMENDED
                </span>
              )}
            </div>
            {!isIncomplete && result.passed && result.warnings.length === 0 && (
              <div className="text-xs text-green-600 mt-0.5">✓ Meets all entered criteria</div>
            )}
            {isIncomplete && (
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Incomplete Guidelines</div>
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

        {/* Recommend toggle — UW selects which matches to send to admin for review */}
        <div className="flex items-center gap-2 px-3 pb-3">
          <button
            onClick={() => toggleRecommended(result.lender)}
            className={`flex-1 py-1.5 text-xs font-mono font-bold uppercase tracking-wider rounded border transition-all ${decision === "approved"
                ? "bg-emerald-600 border-emerald-600 text-white"
                : "border-emerald-300 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-500"
              }`}
          >
            {decision === "approved" ? "★ Recommended — click to remove" : "★ Recommend to Admin"}
          </button>
        </div>

        {isExpanded && (
          <div className="px-3 pb-3 border-t border-slate-200 pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {([
                ["Min FICO", result.lender.min_fico ?? "—"],
                ["Min TIB", result.lender.time_in_business_months ? `${result.lender.time_in_business_months}mo` : "—"],
                ["Min Revenue", result.lender.avg_monthly_revenue ? fmt$(result.lender.avg_monthly_revenue) : "—"],
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