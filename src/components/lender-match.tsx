"use client";

/**
 * LenderMatch.tsx
 * ───────────────
 * Standalone lender-criteria matching component.
 * Use AFTER a bank analysis is complete by passing a DealSummary object.
 *
 * Usage:
 *   import LenderMatch from "@/components/LenderMatch";
 *   import type { DealSummary } from "@/components/BankAnalysis";
 *
 *   <LenderMatch deal={dealSummary} />
 *
 * All deal data (FICO, revenue, TIB, positions, etc.) flows in via props.
 * State and Industry can also be pre-populated from the deal or edited inline.
 */

import { useState, useMemo, useEffect } from "react";
import type { DealSummary } from "./bank-analysis";
import { createClient } from "@/lib/supabase/client";

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

const fmt$ = (v: number) =>
  v === 0 ? "—" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const SPECIALTY_COLORS: Record<string, string> = {
  MCA: "bg-blue-900/40 text-blue-300 border-blue-700/40",
  SBA: "bg-green-900/40 text-green-300 border-green-700/40",
  LOC: "bg-purple-900/40 text-purple-300 border-purple-700/40",
  Equipment: "bg-yellow-900/40 text-yellow-300 border-yellow-700/40",
  "Term Loan": "bg-orange-900/40 text-orange-300 border-orange-700/40",
  "Real Estate": "bg-cyan-900/40 text-cyan-300 border-cyan-700/40",
  Trucking: "bg-red-900/40 text-red-300 border-red-700/40",
  "Invoice Factoring": "bg-pink-900/40 text-pink-300 border-pink-700/40",
  Consolidation: "bg-indigo-900/40 text-indigo-300 border-indigo-700/40",
  "Reverse consolidation": "bg-teal-900/40 text-teal-300 border-teal-700/40",
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
};

// ─── Matching Engine ──────────────────────────────────────────────────────────

function matchLender(lender: Lender, deal: DealSummary): MatchResult {
  const flags: string[] = [];
  const warnings: string[] = [];

  if (lender.min_fico && lender.min_fico > 0 && deal.fico > 0 && deal.fico < lender.min_fico)
    flags.push(`FICO ${deal.fico} < min ${lender.min_fico}`);

  if (lender.time_in_business_months && lender.time_in_business_months > 0 && deal.tibMonths > 0 && deal.tibMonths < lender.time_in_business_months)
    flags.push(`TIB ${deal.tibMonths}mo < min ${lender.time_in_business_months}mo`);

  if (lender.avg_monthly_revenue && deal.avgRevenue > 0 && deal.avgRevenue < lender.avg_monthly_revenue)
    flags.push(`Revenue ${fmt$(deal.avgRevenue)} < min ${fmt$(lender.avg_monthly_revenue)}`);

  if (lender.negative_days !== null && deal.totalNegDays > 0 && deal.totalNegDays > lender.negative_days)
    flags.push(`Neg days ${deal.totalNegDays} > max ${lender.negative_days}`);

  if (lender.monthly_deposits && deal.avgMonthlyDeposits > 0 && deal.avgMonthlyDeposits < lender.monthly_deposits)
    flags.push(`Deposits ${deal.avgMonthlyDeposits} < min ${lender.monthly_deposits}`);

  if (lender.number_of_positions !== null && deal.numOpenPositions > 0 && deal.numOpenPositions > lender.number_of_positions)
    flags.push(`${deal.numOpenPositions} positions > max ${lender.number_of_positions}`);

  if (lender.avg_daily_balance && deal.avgDailyBalance > 0 && deal.avgDailyBalance < lender.avg_daily_balance)
    flags.push(`Avg daily bal ${fmt$(deal.avgDailyBalance)} < min ${fmt$(lender.avg_daily_balance)}`);

  if (lender.bankruptcies === "No" && deal.hasBankruptcy)
    flags.push("Lender does not accept bankruptcies");

  if (lender.restricted_states && deal.state) {
    const stateParts = lender.restricted_states.toUpperCase().split(/[,\s]+/).filter((s) => s.length === 2);
    if (stateParts.includes(deal.state.toUpperCase()))
      flags.push(`State ${deal.state.toUpperCase()} is restricted`);
  }

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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LenderMatchProps {
  dealSummary?: Partial<DealSummary>;
  state?: string;
  industry?: string;
}

interface ClientOption {
  id: string;
  client_name: string;
  company_name: string;
  company_state: string;
  industry: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LenderMatch({ dealSummary: propDeal = DEFAULT_DEAL, state: propState = "", industry: propIndustry = "" }: LenderMatchProps) {
  // Internal state for the "active" deal being matched
  const [deal, setDeal] = useState<DealSummary>({ ...DEFAULT_DEAL, ...propDeal });
  const [filterState, setFilterState] = useState(propState || propDeal.state || "");
  const [filterIndustry, setFilterIndustry] = useState(propIndustry || propDeal.industry || "");
  
  const [clientList, setClientList] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [isLoadingClient, setIsLoadingClient] = useState(false);
  const [specialtyFilter, setSpecialtyFilter] = useState("All");
  const [showPassedOnly, setShowPassedOnly] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Sync state with props when dealSummary changes
  useEffect(() => {
    if (Object.keys(propDeal).length > 0) {
      setDeal(prev => ({ ...prev, ...propDeal }));
      if (propDeal.state) setFilterState(propDeal.state);
      if (propDeal.industry) setFilterIndustry(propDeal.industry);
    }
  }, [propDeal]);

  // Fetch clients for the selector
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("client_data_vault")
      .select("id, client_name, company_name, company_state, industry")
      .order("client_name", { ascending: true })
      .then(({ data }) => {
        if (data) setClientList(data as ClientOption[]);
      });
  }, []);

  async function loadClientResults(clientId: string) {
    if (!clientId) return;
    setIsLoadingClient(true);
    const supabase = createClient();
    
    // Get analysis results
    const { data: analysis, error: aError } = await supabase
      .from("bank_analysis_results")
      .select("*")
      .eq("client_id", clientId)
      .single();

    if (analysis && !aError) {
      const client = clientList.find(c => c.id === clientId);
      const newDeal: DealSummary = {
        fico: analysis.fico || 0,
        tibMonths: analysis.tib_months || 0,
        avgRevenue: Number(analysis.avg_revenue) || 0,
        avgDailyBalance: Number(analysis.avg_daily_balance) || 0,
        totalNegDays: analysis.total_neg_days || 0,
        numOpenPositions: analysis.num_open_positions || 0,
        avgMonthlyDeposits: Number(analysis.avg_monthly_deposits) || 0,
        hasBankruptcy: analysis.has_bankruptcy || false,
        state: client?.company_state || "",
        industry: client?.industry || "",
        businessName: analysis.business_name || client?.company_name || "",
        ownerName: analysis.owner_name || client?.client_name || "",
        capitalRequested: Number(analysis.capital_requested) || 0,
      };
      
      setDeal(newDeal);
      setFilterState(newDeal.state || "");
      setFilterIndustry(newDeal.industry || "");
    } else {
      // Fallback or alert if no analysis found
      console.log("No saved analysis found for this client");
    }
    setIsLoadingClient(false);
  }

  const [lenderData, setLenderData] = useState<Lender[]>([]);
  const [loadingLenders, setLoadingLenders] = useState(true);

  // Load lenders from Supabase
  useEffect(() => {
    async function fetchLenders() {
      setLoadingLenders(true);
      const supabase = createClient();
      const { data, error } = await supabase.from("lender_guidelines").select("*");
      if (!error && data) {
        // Deduplicate by name + specialty
        const uniqueMap = new Map<string, Lender>();
        (data as Lender[]).forEach((l) => {
          const key = `${l.lender_name}-${l.specialty || ""}`;
          // If we see it again, only keep it if the current one has more data or just keep first
          if (!uniqueMap.has(key)) {
            uniqueMap.set(key, l);
          }
        });
        setLenderData(Array.from(uniqueMap.values()));
      }
      setLoadingLenders(false);
    }
    fetchLenders();
  }, []);

  const results = useMemo(() =>
    lenderData
      .map((l) => matchLender(l, deal))
      .sort((a, b) => {
        if (a.passed !== b.passed) return a.passed ? -1 : 1;
        return a.flags.length - b.flags.length;
      }),
    [deal, filterState, filterIndustry, lenderData]
  );

  const passed = results.filter((r) => r.passed);
  const specialties = ["All", ...Array.from(new Set(lenderData.map((l) => l.specialty ?? "Unknown"))).sort()];

  const filtered = results.filter((r) => {
    if (showPassedOnly && !r.passed) return false;
    if (specialtyFilter !== "All" && (r.lender.specialty ?? "Unknown") !== specialtyFilter) return false;
    return true;
  });

  const dataEntered = deal.fico || deal.tibMonths || deal.avgRevenue || filterState || filterIndustry;

  return (
    <div
      className="min-h-screen text-gray-100 space-y-4 p-4"
      style={{ background: "#0d1117", fontFamily: "'IBM Plex Mono', monospace" }}
    >
      {/* Header */}
      <div className="rounded-xl border border-gray-700 p-4" style={{ background: "#161b22" }}>
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
                className="bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono text-gray-100 focus:outline-none focus:border-blue-500 min-w-[240px]"
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
                <span className="text-lg font-mono font-bold text-green-400">{passed.length}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Disqualified</span>
                <span className="text-lg font-mono font-bold text-red-400">{results.length - passed.length}</span>
              </div>
            </div>
          )}
        </div>

        {/* Deal summary pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: "FICO", value: deal.fico && deal.fico > 0 ? String(deal.fico) : null },
            { label: "TIB", value: deal.tibMonths && deal.tibMonths > 0 ? `${deal.tibMonths}mo` : null },
            { label: "Avg Revenue", value: deal.avgRevenue && deal.avgRevenue > 0 ? fmt$(deal.avgRevenue) : null },
            { label: "Neg Days", value: deal.totalNegDays && deal.totalNegDays > 0 ? String(deal.totalNegDays) : null },
            { label: "Positions", value: deal.numOpenPositions && deal.numOpenPositions > 0 ? String(deal.numOpenPositions) : null },
            { label: "Deposits", value: deal.avgMonthlyDeposits && deal.avgMonthlyDeposits > 0 ? String(deal.avgMonthlyDeposits) : null },
            { label: "Requested", value: deal.capitalRequested && deal.capitalRequested > 0 ? fmt$(deal.capitalRequested) : null },
            { label: "Bankruptcy", value: deal.hasBankruptcy ? "Yes" : null },
          ].filter((p) => p.value !== null).map(({ label, value }) => (
            <div key={label} className="flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1">
              <span className="text-xs text-gray-500">{label}</span>
              <span className="text-xs font-mono font-bold text-blue-400">{value}</span>
            </div>
          ))}
        </div>
      </div>
      
      {loadingLenders && (
        <div className="text-sm text-blue-400 font-mono animate-pulse">Loading lender guidelines...</div>
      )}

      {/* Override inputs — state & industry */}
      <div className="rounded-xl border border-gray-700 p-4" style={{ background: "#161b22" }}>
        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Match Filters</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Business State</label>
            <input
              type="text"
              value={filterState}
              onChange={(e) => setFilterState(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="FL"
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono text-gray-100 uppercase focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Industry / Business Type</label>
            <input
              type="text"
              value={filterIndustry}
              onChange={(e) => setFilterIndustry(e.target.value)}
              placeholder="e.g. Restaurant, Trucking..."
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono text-gray-100 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Match bar */}
      {dataEntered && (
        <div className="rounded-xl border border-gray-700 p-4" style={{ background: "#161b22" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 uppercase tracking-widest">Eligibility</span>
            <span className="text-xs font-mono text-gray-400">
              {results.length > 0 ? Math.round((passed.length / results.length) * 100) : 0}% of lenders
            </span>
          </div>
          <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-green-500 to-blue-500 transition-all duration-500"
              style={{ width: `${results.length > 0 ? (passed.length / results.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {!dataEntered && (
        <div className="rounded-lg border border-blue-800/40 bg-blue-900/10 px-4 py-3 text-xs text-blue-400 font-mono">
          💡 Pass a <code>DealSummary</code> from a completed BankAnalysis to run matching. Enter State and Industry above to apply geographic/industry filters.
        </div>
      )}

      {/* Specialty tabs + filter toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        {specialties.map((s) => (
          <button
            key={s}
            onClick={() => setSpecialtyFilter(s)}
            className={`px-2.5 py-1 text-xs font-mono uppercase tracking-wider rounded border transition-all ${specialtyFilter === s
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-gray-700 text-gray-500 hover:border-blue-600 hover:text-blue-400"
              }`}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => setShowPassedOnly(!showPassedOnly)}
          className={`px-3 py-1 text-xs font-mono uppercase tracking-wider rounded border transition-all ${showPassedOnly
              ? "bg-green-900/30 border-green-600/60 text-green-400"
              : "border-gray-700 text-gray-500 hover:text-green-400"
            }`}
        >
          {showPassedOnly ? "✓ Eligible Only" : "Show All"}
        </button>
        <span className="text-xs text-gray-600 font-mono ml-auto">{filtered.length} shown</span>
      </div>

      {/* Lender cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filtered.map((result, i) => {
          const key = `${result.lender.lender_name}-${result.lender.specialty}-${i}`;
          const isExpanded = expandedKey === key;
          const specColor = SPECIALTY_COLORS[result.lender.specialty ?? ""] ?? "bg-gray-900/40 text-gray-400 border-gray-700/40";
          const minF = typeof result.lender.min_funding === "number" ? result.lender.min_funding : null;
          const maxF = typeof result.lender.max_funding === "number" ? result.lender.max_funding : null;

          return (
            <div
              key={key}
              className={`rounded-xl border transition-all ${result.passed
                  ? "border-green-800/40 hover:border-green-600/60"
                  : "border-gray-800 hover:border-red-800/40"
                }`}
              style={{ background: result.passed ? "#161b22" : "#13191f" }}
            >
              <div
                className="flex items-start gap-3 px-3 py-3 cursor-pointer"
                onClick={() => setExpandedKey(isExpanded ? null : key)}
              >
                <div
                  className={`mt-1 flex-shrink-0 w-2 h-2 rounded-full ${result.passed ? "bg-green-400" : "bg-red-500"}`}
                  style={{ boxShadow: result.passed ? "0 0 6px #4ade80" : "0 0 6px #f87171" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-100 font-mono">{result.lender.lender_name}</span>
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
                  </div>
                  {result.passed && result.warnings.length === 0 && (
                    <div className="text-xs text-green-400 mt-0.5">✓ Meets all entered criteria</div>
                  )}
                  {result.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {result.flags.slice(0, 2).map((f, fi) => (
                        <span key={fi} className="text-xs bg-red-900/20 border border-red-800/40 text-red-400 rounded px-1.5 py-0.5 font-mono">
                          {f}
                        </span>
                      ))}
                      {result.flags.length > 2 && (
                        <span className="text-xs text-gray-500 font-mono">+{result.flags.length - 2} more</span>
                      )}
                    </div>
                  )}
                  {result.warnings.map((w, wi) => (
                    <div key={wi} className="text-xs text-orange-400 mt-0.5">⚠ {w}</div>
                  ))}
                </div>
                <span className="text-gray-600 text-xs flex-shrink-0 mt-1">{isExpanded ? "▲" : "▼"}</span>
              </div>

              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-800 pt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {([
                      ["Min FICO", result.lender.min_fico ?? "—"],
                      ["Min TIB", result.lender.time_in_business_months ? `${result.lender.time_in_business_months}mo` : "—"],
                      ["Min Revenue", result.lender.avg_monthly_revenue ? fmt$(result.lender.avg_monthly_revenue) : "—"],
                      ["Max Neg Days", result.lender.negative_days ?? "—"],
                      ["Max Positions", result.lender.number_of_positions ?? "—"],
                      ["Payment Type", result.lender.payment_type ?? "—"],
                      ["Bankruptcies OK", result.lender.bankruptcies ?? "—"],
                      ["Restricted States", result.lender.restricted_states || "None"],
                    ] as [string, string | number][]).map(([label, val]) => (
                      <div key={label} className="flex justify-between gap-2 bg-gray-950 rounded px-2 py-1">
                        <span className="text-gray-500">{label}</span>
                        <span className="text-gray-200 font-mono text-right">{String(val)}</span>
                      </div>
                    ))}
                  </div>
                  {result.lender.preferred_industries && (
                    <div className="bg-gray-950 rounded px-2 py-2">
                      <div className="text-xs text-green-600 uppercase tracking-wider mb-1">Preferred Industries</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{result.lender.preferred_industries}</div>
                    </div>
                  )}
                  {result.lender.restricted_industries && (
                    <div className="bg-gray-950 rounded px-2 py-2">
                      <div className="text-xs text-red-600 uppercase tracking-wider mb-1">Restricted Industries</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{result.lender.restricted_industries}</div>
                    </div>
                  )}
                  {result.lender.restricted_industry_exceptions && (
                    <div className="bg-gray-950 rounded px-2 py-2">
                      <div className="text-xs text-orange-500 uppercase tracking-wider mb-1">Exceptions</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{result.lender.restricted_industry_exceptions}</div>
                    </div>
                  )}
                  {result.lender.additional_info && (
                    <div className="bg-gray-950 rounded px-2 py-2">
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Additional Notes</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{result.lender.additional_info}</div>
                    </div>
                  )}
                  {result.flags.length > 0 && (
                    <div className="space-y-1">
                      {result.flags.map((f, fi) => (
                        <div key={fi} className="text-xs bg-red-900/20 border border-red-800/40 text-red-400 rounded px-2 py-1 font-mono">
                          ✗ {f}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
