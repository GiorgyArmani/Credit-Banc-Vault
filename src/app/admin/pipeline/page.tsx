"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PipelineBoard, type PipelineDeal } from "@/app/advisor/dashboard/pipeline/_components/pipeline-board";
import { enrichDeals } from "@/app/advisor/dashboard/pipeline/page";
import { updateLoanStatus, type LoanStatus } from "@/app/actions/pipeline";
import { getActivityState, ACTIVITY_STATES, type ActivityState } from "@/components/advisor/activity-age-badge";
import { toast } from "@/lib/toast";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import clsx from "clsx";

interface AdvisorOption {
  id: string;
  label: string;
}

export default function AdminPipelinePage() {
  const supabase = createClient();
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [advisors, setAdvisors] = useState<AdvisorOption[]>([]);
  const [myAdvisorId, setMyAdvisorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [advisorFilter, setAdvisorFilter] = useState<string>("");
  // Activity-decay state filter (Fresh/Watch/Alert/Urgent/Stale) — same
  // classification the card badges + the reassign-stale-files cron use.
  const [activityFilter, setActivityFilter] = useState<ActivityState | "">("");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchAll = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: myAdvisor } = await supabase
        .from("advisors")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (myAdvisor?.id) setMyAdvisorId(myAdvisor.id);

      const [{ data: clients, error }, { data: advisorRows }] = await Promise.all([
        supabase
          .from("client_data_vault")
          .select("id, user_id, advisor_id, client_name, client_email, client_phone, company_name, capital_requested, created_at, reassigned_to_catch_all_at, reassignment_paused_until"),
        supabase.from("advisors").select("id, first_name, last_name, email"),
      ]);

      if (error) throw error;

      const advisorOpts: AdvisorOption[] = (advisorRows || []).map((a: any) => ({
        id: a.id,
        label: [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || a.email || "Unnamed advisor",
      }));
      advisorOpts.sort((a, b) => a.label.localeCompare(b.label));
      setAdvisors(advisorOpts);

      if (!clients || clients.length === 0) {
        setDeals([]);
        return;
      }

      const enriched = await enrichDeals(supabase, clients);
      setDeals(enriched);
    } catch (error: any) {
      toast.error("Failed to load pipeline: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    import("drag-drop-touch");
  }, []);

  // Restore the All/My Deals scope on mount so drilling into a client and
  // coming back keeps the rep's chosen view instead of resetting to All Deals.
  useEffect(() => {
    const saved = localStorage.getItem("admin-pipeline-scope");
    if (saved === "mine" || saved === "all") setScope(saved);
  }, []);

  // The toggle is sticky: persist on the user's click (not in an effect, which
  // would race the restore-on-mount above and clobber the saved value).
  const applyScope = (next: "all" | "mine") => {
    setScope(next);
    localStorage.setItem("admin-pipeline-scope", next);
  };

  const filteredDeals = useMemo(() => {
    let out = deals;
    if (scope === "mine") {
      if (!myAdvisorId) return [];
      out = out.filter(d => d.advisor_id === myAdvisorId);
    }
    if (advisorFilter) {
      if (advisorFilter === "__unassigned__") {
        out = out.filter(d => !d.advisor_id);
      } else {
        out = out.filter(d => d.advisor_id === advisorFilter);
      }
    }
    if (activityFilter) {
      out = out.filter(d => getActivityState(d.created_at, d.last_activity_at, d.reassigned_to_catch_all_at) === activityFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      out = out.filter(d =>
        d.client_name.toLowerCase().includes(q) ||
        d.company_name.toLowerCase().includes(q) ||
        d.client_email.toLowerCase().includes(q)
      );
    }
    return out;
  }, [deals, scope, advisorFilter, activityFilter, searchQuery, myAdvisorId]);

  const handleDrop = async (dealId: string, newStatus: LoanStatus) => {
    const old = [...deals];
    setDeals(prev => prev.map(d => (d.id === dealId ? { ...d, pipeline_status: newStatus } : d)));
    try {
      const result = await updateLoanStatus(dealId, newStatus, "Moved in Pipeline");
      if (!result.success) throw new Error(result.error);
      toast.success("Deal status updated");
    } catch (error: any) {
      setDeals(old);
      toast.error("Failed to update status: " + error.message);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 text-emerald-500 animate-spin mb-4" />
        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Synchronizing Pipeline...</p>
      </div>
    );
  }

  const headerActions = (
    <>
      {/* Scope: All vs Mine */}
      <div className="bg-slate-100 dark:bg-slate-900 p-0.5 rounded-xl flex border border-slate-200 dark:border-slate-800">
        <button
          onClick={() => applyScope("all")}
          className={clsx(
            "px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all",
            scope === "all"
              ? "bg-white dark:bg-slate-800 text-emerald-600 shadow-sm"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          )}
        >
          All Deals
        </button>
        <button
          onClick={() => applyScope("mine")}
          disabled={!myAdvisorId}
          title={!myAdvisorId ? "No advisor profile linked to your admin account" : undefined}
          className={clsx(
            "px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed",
            scope === "mine"
              ? "bg-white dark:bg-slate-800 text-emerald-600 shadow-sm"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          )}
        >
          My Deals
        </button>
      </div>

      {/* Advisor filter */}
      <select
        value={advisorFilter}
        onChange={(e) => setAdvisorFilter(e.target.value)}
        className="h-9 md:h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[12px] font-bold text-slate-700 dark:text-slate-200 px-3 pr-8 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
      >
        <option value="">All advisors</option>
        <option value="__unassigned__">Unassigned</option>
        {advisors.map(a => (
          <option key={a.id} value={a.id}>{a.label}</option>
        ))}
      </select>

      {/* Activity-state filter (Fresh / Watch / Alert / Urgent / Stale) */}
      <select
        value={activityFilter}
        onChange={(e) => setActivityFilter(e.target.value as ActivityState | "")}
        className="h-9 md:h-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[12px] font-bold text-slate-700 dark:text-slate-200 px-3 pr-8 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
      >
        <option value="">All activity</option>
        {ACTIVITY_STATES.map(state => (
          <option key={state} value={state}>{state}</option>
        ))}
      </select>

      {/* Search */}
      <div className="relative flex-1 md:flex-none">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search deals..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 w-full md:w-64 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl text-sm h-9 md:h-10"
        />
      </div>
    </>
  );

  const subtitleSuffix = filteredDeals.length !== deals.length ? (
    <span className="ml-1.5 text-slate-400">(filtered from {deals.length})</span>
  ) : null;

  return (
    <PipelineBoard
      deals={filteredDeals}
      detailHrefBase="/admin/clients/"
      onDrop={handleDrop}
      headerActions={headerActions}
      subtitleSuffix={subtitleSuffix}
    />
  );
}
