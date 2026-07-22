"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { LOAN_TYPES } from "@/data/loan-types";

interface Lender {
  id: string;
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
  /** Minimum open positions the lender will accept on a file.
   *  0 = first-position lender (no existing debt); N = won't fund unless
   *  there are at least N existing positions. Paired with number_of_positions
   *  (max) to define the lender's tolerated range. */
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
  /** When these guidelines were last confirmed current (edit or "Mark reviewed").
   *  Optional so INITIAL_LENDER_FIELDS need not seed it — the DB defaults it. */
  last_reviewed_at?: string | null;
}

// Guidelines should be re-checked against the lender twice a year; past this we
// flag the card as due for review.
const REVIEW_INTERVAL_MS = 1000 * 60 * 60 * 24 * 183; // ~6 months

// Mirror of hasMinViableGuidelines() in lender-match.tsx — a program row counts
// as "complete" once it carries at least ONE real underwriting threshold (FICO,
// revenue, time-in-business, or a funding ceiling). Keep these two definitions
// in sync so this dashboard's "missing" count matches exactly what the matcher
// drops into its "Incomplete Guidelines" bucket.
function programComplete(
  p: Pick<Lender, "min_fico" | "avg_monthly_revenue" | "time_in_business_months" | "max_funding">
): boolean {
  return (p.min_fico ?? 0) > 0
    || (p.avg_monthly_revenue ?? 0) > 0
    || (p.time_in_business_months ?? 0) > 0
    || (Number(p.max_funding) || 0) > 0;
}

type StatusFilter = "all" | "complete" | "missing" | "due";

interface GroupedLender {
  name: string;
  programs: Lender[];
}

interface EditingGroup {
  lender_name: string;
  originalName: string;
  programs: Record<string, Partial<Lender>>; // specialty -> guidelines
  activeSpecialty: string;
}

// Shared with bank-analysis.tsx via src/data/loan-types.ts — keep both in sync.
const AVAILABLE_SPECIALTIES = LOAN_TYPES;

const INITIAL_LENDER_FIELDS: Omit<Lender, "id" | "lender_name" | "specialty"> = {
  min_fico: 0,
  min_sbss: 0,
  time_in_business_months: 0,
  negative_days: 0,
  monthly_deposits: 0,
  avg_monthly_revenue: 0,
  avg_daily_balance: 0,
  preferred_industries: "",
  restricted_industries: "",
  restricted_industry_exceptions: "",
  restricted_states: "",
  ownership_percentage: 0,
  number_of_positions: 0,
  min_positions: 0,
  bankruptcies: "",
  tax_liens_limit: "",
  min_funding: 0,
  max_funding: 0,
  auto_decline_reasons: "",
  holdback_percentage: 0,
  payment_type: "",
  consolidation_positions: 0,
  additional_info: "",
};

export default function LenderGuidelinesManager() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editingGroup, setEditingGroup] = useState<EditingGroup | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    fetchLenders();
  }, []);

  async function fetchLenders() {
    setLoading(true);
    const { data, error } = await supabase
      .from("lender_guidelines")
      .select("*")
      .order("lender_name", { ascending: true });

    if (data) setLenders(data);
    setLoading(false);
  }

  const allGroups = useMemo(() => {
    const groups: Record<string, GroupedLender> = {};
    lenders.forEach(l => {
      if (!groups[l.lender_name]) {
        groups[l.lender_name] = { name: l.lender_name, programs: [] };
      }
      groups[l.lender_name].programs.push(l);
    });
    return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
  }, [lenders]);

  // Dashboard counters. A lender is "complete" only when every one of its
  // programs clears programComplete(); a single empty-shell program makes the
  // whole lender show as missing, since that program would drop into the
  // matcher's Incomplete bucket.
  const metrics = useMemo(() => {
    let completeLenders = 0;
    let missingLenders = 0;
    let dueLenders = 0;
    let totalPrograms = 0;
    let completePrograms = 0;
    for (const g of allGroups) {
      totalPrograms += g.programs.length;
      completePrograms += g.programs.filter(programComplete).length;
      if (g.programs.every(programComplete)) completeLenders++;
      else missingLenders++;
      if (groupReview(g).isDue) dueLenders++;
    }
    return {
      totalLenders: allGroups.length,
      totalPrograms,
      completePrograms,
      missingPrograms: totalPrograms - completePrograms,
      completeLenders,
      missingLenders,
      dueLenders,
    };
    // groupReview is a stable function declaration; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGroups]);

  const groupedLenders = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return allGroups.filter(g => {
      const matchesSearch =
        g.name.toLowerCase().includes(term) ||
        g.programs.some(p => (p.specialty || "").toLowerCase().includes(term));
      if (!matchesSearch) return false;

      const allComplete = g.programs.every(programComplete);
      if (statusFilter === "complete") return allComplete;
      if (statusFilter === "missing") return !allComplete;
      if (statusFilter === "due") return groupReview(g).isDue;
      return true;
    });
    // groupReview is a stable function declaration; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGroups, searchTerm, statusFilter]);

  // Deep-link: /...lender-guidelines?edit=<lender_name> — used by the "Add
  // guidelines" shortcut on Incomplete cards in Lender Match — auto-opens that
  // lender's editor once its rows have loaded. Reads window.location directly so
  // this page doesn't need a Suspense boundary for useSearchParams. Runs once.
  const autoEditHandledRef = useRef(false);
  useEffect(() => {
    if (autoEditHandledRef.current || loading || lenders.length === 0) return;
    autoEditHandledRef.current = true;
    const target = new URLSearchParams(window.location.search).get("edit");
    if (!target) return;
    const group = allGroups.find(
      g => g.name.toLowerCase() === target.toLowerCase()
    );
    if (group) startEditing(group);
    // startEditing is a stable function declaration; safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, lenders, allGroups]);

  function startEditing(group: GroupedLender) {
    const progMap: Record<string, Partial<Lender>> = {};
    group.programs.forEach(p => {
      progMap[p.specialty || "General"] = { ...p };
    });

    setEditingGroup({
      lender_name: group.name,
      originalName: group.name,
      programs: progMap,
      activeSpecialty: group.programs[0]?.specialty || "MCA",
    });
  }

  function startNew() {
    setEditingGroup({
      lender_name: "",
      originalName: "",
      programs: { "MCA": { lender_name: "", specialty: "MCA", ...INITIAL_LENDER_FIELDS } },
      activeSpecialty: "MCA",
    });
  }

  async function handleSave() {
    if (!editingGroup?.lender_name) {
      toast.error("Lender name is required");
      return;
    }
    setIsSaving(true);

    const dbPrograms = lenders.filter(l => l.lender_name === editingGroup.originalName);
    const newPrograms = Object.entries(editingGroup.programs);

    try {
      // 1. Handle Deletions (programs present in DB but not in editor)
      const toDelete = dbPrograms.filter(dbp => !editingGroup.programs[dbp.specialty || "General"]);
      for (const p of toDelete) {
        await supabase.from("lender_guidelines").delete().eq("id", p.id);
      }

      // 2. Handle Upserts (updates and inserts)
      // Saving counts as a review — stamp now so the 6-month clock resets.
      const reviewed_now = new Date().toISOString();
      for (const [spec, data] of newPrograms) {
        const { id, ...cleanData } = data;
        const payload = {
          ...cleanData,
          lender_name: editingGroup.lender_name,
          specialty: spec === "General" ? null : spec,
          last_reviewed_at: reviewed_now,
        };

        if (id) {
          await supabase.from("lender_guidelines").update(payload).eq("id", id);
        } else {
          await supabase.from("lender_guidelines").insert(payload);
        }
      }

      // 3. Handle Renames (Update remaining rows in DB if name changed)
      if (editingGroup.originalName && editingGroup.lender_name !== editingGroup.originalName) {
        await supabase.from("lender_guidelines")
          .update({ lender_name: editingGroup.lender_name })
          .eq("lender_name", editingGroup.originalName);
      }

      await fetchLenders();
      setEditingGroup(null);
      toast.success("All program guidelines saved");
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Error saving guidelines");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteGroup(name: string) {
    if (!confirm(`Are you sure you want to remove ALL programs for ${name}?`)) return;
    const { error } = await supabase.from("lender_guidelines").delete().eq("lender_name", name);
    if (!error) {
      setLenders(prev => prev.filter(l => l.lender_name !== name));
      toast.success(`Removed ${name} from guidelines`);
    } else {
      toast.error("Error removing lender");
    }
  }

  // Oldest review timestamp across a lender's programs — the one that drives the
  // "due" flag (a lender is only as fresh as its stalest program).
  function groupReview(group: GroupedLender): { oldest: Date | null; isDue: boolean } {
    const dates = group.programs
      .map(p => (p.last_reviewed_at ? new Date(p.last_reviewed_at) : null))
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length === 0) return { oldest: null, isDue: true };
    const oldest = dates.reduce((a, b) => (a.getTime() < b.getTime() ? a : b));
    return { oldest, isDue: Date.now() - oldest.getTime() > REVIEW_INTERVAL_MS };
  }

  async function markGroupReviewed(name: string) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("lender_guidelines")
      .update({ last_reviewed_at: now })
      .eq("lender_name", name);
    if (error) {
      toast.error("Couldn't mark as reviewed");
      return;
    }
    setLenders(prev =>
      prev.map(l => (l.lender_name === name ? { ...l, last_reviewed_at: now } : l))
    );
    toast.success(`${name} marked as reviewed`);
  }

  const handleFieldChange = (field: keyof Lender, value: any) => {
    if (!editingGroup) return;
    const active = editingGroup.activeSpecialty;
    setEditingGroup({
      ...editingGroup,
      programs: {
        ...editingGroup.programs,
        [active]: { ...editingGroup.programs[active], [field]: value }
      }
    });
  };

  const handleNumberChange = (field: keyof Lender, value: string, isFloat = false) => {
    if (value === "") {
      handleFieldChange(field, null);
      return;
    }
    const num = isFloat ? parseFloat(value) : parseInt(value);
    handleFieldChange(field, isNaN(num) ? null : num);
  };

  const copyGuidelinesFrom = (sourceSpec: string) => {
    if (!editingGroup || !sourceSpec) return;
    const sourceData = editingGroup.programs[sourceSpec];
    if (!sourceData) return;

    // Copy all fields except ID and Specialty
    const currentActive = editingGroup.activeSpecialty;
    const { id, specialty, lender_name, ...fieldsToCopy } = sourceData;

    setEditingGroup({
      ...editingGroup,
      programs: {
        ...editingGroup.programs,
        [currentActive]: {
          ...editingGroup.programs[currentActive],
          ...fieldsToCopy
        }
      }
    });
    toast.success(`Guidelines copied from ${sourceSpec}`);
  };

  const toggleSpecialty = (spec: string) => {
    if (!editingGroup) return;
    const next = { ...editingGroup.programs };
    if (next[spec]) {
      if (Object.keys(next).length > 1) {
        delete next[spec];
        const remaining = Object.keys(next);
        setEditingGroup({
          ...editingGroup,
          programs: next,
          activeSpecialty: remaining.includes(editingGroup.activeSpecialty) ? editingGroup.activeSpecialty : remaining[0]
        });
      } else {
        toast.error("At least one program is required");
      }
    } else {
      // Copy current guidelines to new program to speed up setup
      const currentData = editingGroup.programs[editingGroup.activeSpecialty] || INITIAL_LENDER_FIELDS;
      next[spec] = { ...currentData, id: undefined, specialty: spec, lender_name: editingGroup.lender_name };
      setEditingGroup({ ...editingGroup, programs: next, activeSpecialty: spec });
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search lenders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-700 focus:outline-none focus:border-emerald-400 transition-all"
          />
        </div>
        <button
          onClick={startNew}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-all uppercase tracking-wider"
        >
          Add Lender
        </button>
      </div>

      {/* Guideline-coverage metrics. The Complete / Missing / Due tiles double as
          filters — click one to narrow the grid, click again to clear. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {([
          { key: "all", label: "Lenders", value: metrics.totalLenders, sub: `${metrics.totalPrograms} programs`, tone: "slate", filter: "all" as StatusFilter },
          { key: "programs", label: "Programs", value: metrics.totalPrograms, sub: `${metrics.completePrograms} complete`, tone: "slate", filter: "all" as StatusFilter },
          { key: "complete", label: "Complete", value: metrics.completeLenders, sub: "all programs set", tone: "emerald", filter: "complete" as StatusFilter },
          { key: "missing", label: "Missing Guidelines", value: metrics.missingLenders, sub: "needs data", tone: "rose", filter: "missing" as StatusFilter },
          { key: "due", label: "Due for Review", value: metrics.dueLenders, sub: "6+ months old", tone: "amber", filter: "due" as StatusFilter },
        ]).map(tile => {
          const active = statusFilter === tile.filter && tile.filter !== "all";
          const toneRing: Record<string, string> = {
            slate: "hover:border-slate-300",
            emerald: active ? "border-emerald-400 ring-2 ring-emerald-100" : "hover:border-emerald-300",
            rose: active ? "border-rose-400 ring-2 ring-rose-100" : "hover:border-rose-300",
            amber: active ? "border-amber-400 ring-2 ring-amber-100" : "hover:border-amber-300",
          };
          const toneText: Record<string, string> = {
            slate: "text-slate-900",
            emerald: "text-emerald-600",
            rose: metrics.missingLenders > 0 ? "text-rose-600" : "text-slate-400",
            amber: metrics.dueLenders > 0 ? "text-amber-600" : "text-slate-400",
          };
          const isFilterTile = tile.filter !== "all";
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => isFilterTile && setStatusFilter(active ? "all" : tile.filter)}
              className={`text-left bg-white border border-slate-200 rounded-xl px-4 py-3 transition-all ${toneRing[tile.tone]} ${isFilterTile ? "cursor-pointer" : "cursor-default"}`}
            >
              <div className={`text-2xl font-black tabular-nums ${toneText[tile.tone]}`}>{tile.value}</div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-0.5">{tile.label}</div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">{tile.sub}</div>
            </button>
          );
        })}
      </div>

      {statusFilter !== "all" && (
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-slate-500">
            Filtered by <span className="font-bold text-slate-700">{statusFilter}</span> · {groupedLenders.length} shown
          </span>
          <button
            onClick={() => setStatusFilter("all")}
            className="font-mono text-emerald-600 hover:text-emerald-700 underline"
          >
            clear
          </button>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
          {loading ? (
            <div className="col-span-full py-12 text-center text-slate-500 animate-pulse font-mono">Loading Guidelines...</div>
          ) : groupedLenders.length === 0 ? (
            <div className="col-span-full py-12 text-center text-slate-500 border border-dashed border-slate-200 rounded-xl">No lenders found.</div>
          ) : (
            groupedLenders.map(group => {
              const review = groupReview(group);
              const completeCount = group.programs.filter(programComplete).length;
              const isComplete = completeCount === group.programs.length;
              return (
              <div
                key={group.name}
                className={`bg-white border rounded-xl p-4 flex flex-col justify-between transition-all group border-l-4 ${
                  isComplete
                    ? "border-slate-200 border-l-emerald-400 hover:border-slate-400"
                    : "border-slate-200 border-l-rose-400 hover:border-rose-300"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-slate-900 font-semibold truncate" title={group.name}>{group.name}</h3>
                        {isComplete ? (
                          <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                            Complete
                          </span>
                        ) : (
                          <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">
                            {group.programs.length - completeCount} missing
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {group.programs.map(p => (
                          <span
                            key={p.id}
                            title={programComplete(p) ? undefined : "No underwriting thresholds set — shows as Incomplete in Lender Match"}
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                              programComplete(p)
                                ? "text-emerald-500 bg-emerald-400/10 border-emerald-400/20"
                                : "text-rose-500 bg-rose-400/10 border-rose-400/30"
                            }`}
                          >
                            {p.specialty || "General"}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                      <button onClick={() => startEditing(group)} className="p-1.5 text-slate-500 hover:text-emerald-500 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5M16.242 5.242a2.828 2.828 0 114 4L11.828 15.172a4 4 0 01-1.414.942l-2.829.942.942-2.828a4 4 0 01.942-1.414l7.409-7.409z" /></svg>
                      </button>
                      <button onClick={() => handleDeleteGroup(group.name)} className="p-1.5 text-slate-500 hover:text-rose-600 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>

                  {/* Summary of first program or combined summary */}
                  <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-slate-500 font-mono">
                    <div className="flex justify-between border-b border-slate-200 pb-1">
                      <span>Programs</span>
                      <span className="text-slate-700">{group.programs.length}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 pb-1">
                      <span>Primary Specialty</span>
                      <span className="text-emerald-500">{group.programs[0]?.specialty || "—"}</span>
                    </div>
                  </div>

                  {/* Review freshness — 6-month guideline check */}
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] font-mono text-slate-500">
                        Reviewed{" "}
                        {review.oldest
                          ? review.oldest.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                          : "—"}
                      </span>
                      {review.isDue && (
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          Due
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => markGroupReviewed(group.name)}
                      className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-700 whitespace-nowrap"
                    >
                      Mark reviewed
                    </button>
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>

      {/* Editor Modal */}
      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {editingGroup.originalName ? `Manage ${editingGroup.originalName}` : "New Lender Profile"}
                </h2>
                <p className="text-xs text-slate-500 mt-1">Configure criteria for multiple programs</p>
              </div>
              <button
                onClick={() => setEditingGroup(null)}
                className="p-2 text-slate-500 hover:text-slate-700 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Sidebar/Top Section: Name and Specialty Selection */}
              <div className="p-6 bg-slate-50 border-b border-slate-200 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Lender Name</label>
                    <input
                      type="text"
                      value={editingGroup.lender_name}
                      onChange={e => setEditingGroup({ ...editingGroup, lender_name: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Programs / Specialties (Select multiple)</label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {AVAILABLE_SPECIALTIES.map(spec => (
                        <button
                          key={spec}
                          onClick={() => toggleSpecialty(spec)}
                          className={`px-2 py-1 text-[10px] font-mono rounded border transition-all ${editingGroup.programs[spec]
                              ? "bg-emerald-400 border-emerald-400 text-white"
                              : "bg-white border-slate-200 text-slate-500 hover:border-emerald-400"
                            }`}
                        >
                          {spec}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Program Tabs and Actions */}
                <div className="flex items-center justify-between border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    {Object.keys(editingGroup.programs).map(spec => (
                      <button
                        key={spec}
                        onClick={() => setEditingGroup({ ...editingGroup, activeSpecialty: spec })}
                        className={`px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all border-b-2 ${editingGroup.activeSpecialty === spec
                            ? "border-emerald-400 text-emerald-500"
                            : "border-transparent text-slate-500 hover:text-slate-700"
                          }`}
                      >
                        {spec}
                      </button>
                    ))}
                  </div>

                  {/* Copy Action */}
                  {Object.keys(editingGroup.programs).length > 1 && (
                    <div className="flex items-center gap-2 px-4 py-1">
                      <select
                        onChange={(e) => copyGuidelinesFrom(e.target.value)}
                        className="bg-white border border-slate-200 rounded px-2 py-1 text-[10px] text-slate-500 outline-none hover:border-emerald-400 transition-all"
                        value=""
                      >
                        <option value="" disabled>Copy guidelines from...</option>
                        {Object.keys(editingGroup.programs)
                          .filter(s => s !== editingGroup.activeSpecialty)
                          .map(s => <option key={s} value={s}>{s}</option>)
                        }
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Guidelines Form for Active Specialty */}
              <div className="p-6 space-y-8">
                {editingGroup.programs[editingGroup.activeSpecialty] ? (
                  <>
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-emerald-500 uppercase tracking-widest">
                          {editingGroup.activeSpecialty} Qualification Thresholds
                        </h3>
                        {Object.keys(editingGroup.programs).length > 1 && (
                          <span className="text-[10px] text-slate-500 font-mono italic">Settings apply only to this tab</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Min FICO</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].min_fico ?? ""}
                            onChange={e => handleNumberChange("min_fico", e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Min SBSS</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].min_sbss ?? ""}
                            onChange={e => handleNumberChange("min_sbss", e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Min TIB (Mo)</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].time_in_business_months ?? ""}
                            onChange={e => handleNumberChange("time_in_business_months", e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Min Revenue</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].avg_monthly_revenue ?? ""}
                            onChange={e => handleNumberChange("avg_monthly_revenue", e.target.value, true)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Avg Daily Bal</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].avg_daily_balance ?? ""}
                            onChange={e => handleNumberChange("avg_daily_balance", e.target.value, true)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Max Neg Days</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].negative_days ?? ""}
                            onChange={e => handleNumberChange("negative_days", e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Min Deposits</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].monthly_deposits ?? ""}
                            onChange={e => handleNumberChange("monthly_deposits", e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Min Positions</label>
                          <input
                            type="number"
                            min={0}
                            value={editingGroup.programs[editingGroup.activeSpecialty].min_positions ?? ""}
                            onChange={e => handleNumberChange("min_positions", e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                            placeholder="0 = first position"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Max Positions</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].number_of_positions ?? ""}
                            onChange={e => handleNumberChange("number_of_positions", e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Min Funding</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].min_funding ?? ""}
                            onChange={e => handleNumberChange("min_funding", e.target.value, true)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Max Funding</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].max_funding ?? ""}
                            onChange={e => handleNumberChange("max_funding", e.target.value, true)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Consol. Positions</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].consolidation_positions ?? ""}
                            onChange={e => handleNumberChange("consolidation_positions", e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Min Ownership %</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].ownership_percentage ?? ""}
                            onChange={e => handleNumberChange("ownership_percentage", e.target.value, true)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tax Liens Limit</label>
                          <input
                            type="text"
                            value={editingGroup.programs[editingGroup.activeSpecialty].tax_liens_limit ?? ""}
                            onChange={e => handleFieldChange("tax_liens_limit", e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Holdback %</label>
                          <input
                            type="number"
                            value={editingGroup.programs[editingGroup.activeSpecialty].holdback_percentage ?? ""}
                            onChange={e => handleNumberChange("holdback_percentage", e.target.value, true)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                          />
                        </div>
                      </div>
                    </section>

                    <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Restricted States</label>
                        <input
                          type="text"
                          value={editingGroup.programs[editingGroup.activeSpecialty].restricted_states || ""}
                          onChange={e => handleFieldChange("restricted_states", e.target.value.toUpperCase())}
                          placeholder="e.g. CA, NY, PR"
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment Type</label>
                        <input
                          type="text"
                          value={editingGroup.programs[editingGroup.activeSpecialty].payment_type || ""}
                          onChange={e => handleFieldChange("payment_type", e.target.value)}
                          placeholder="e.g. Daily ACH, Weekly"
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Preferred Industries</label>
                        <textarea
                          value={editingGroup.programs[editingGroup.activeSpecialty].preferred_industries || ""}
                          onChange={e => handleFieldChange("preferred_industries", e.target.value)}
                          rows={2}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400 resize-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Restricted Industries</label>
                        <textarea
                          value={editingGroup.programs[editingGroup.activeSpecialty].restricted_industries || ""}
                          onChange={e => handleFieldChange("restricted_industries", e.target.value)}
                          rows={2}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400 resize-none"
                        />
                      </div>
                    </section>

                    <section>
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Additional Information / Internal Notes</label>
                      <textarea
                        value={editingGroup.programs[editingGroup.activeSpecialty].additional_info || ""}
                        onChange={e => handleFieldChange("additional_info", e.target.value)}
                        rows={4}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-emerald-400 resize-none"
                      />
                    </section>
                  </>
                ) : (
                  <div className="py-20 text-center">
                    <p className="text-slate-500 font-mono">No active program selected.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
              <button
                onClick={() => setEditingGroup(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-700 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg shadow-lg disabled:opacity-50 transition-all uppercase tracking-wider"
              >
                {isSaving ? "Saving..." : "Save All Programs"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
