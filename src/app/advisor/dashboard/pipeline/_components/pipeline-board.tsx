"use client";

import { ReactNode, useMemo, useRef, useState } from "react";
import { KanbanColumn } from "./kanban-column";
import { PipelineDealCard } from "./pipeline-card";
import { StageRail } from "./stage-rail";
import type { LoanStatus } from "@/app/actions/pipeline";
import { HelpCircle, X } from "lucide-react";
import { ACTIVITY_STATE_LEGEND } from "@/components/advisor/activity-age-badge";
import { differenceInDays } from "date-fns";
import clsx from "clsx";

// The pipeline is a working board, not an archive: a closed deal (funded or
// "closed lost") stops being time-sensitive after a quarter. We drop funded /
// declined deals whose last activity is older than this so the board only shows
// live, actionable work. Active-stage deals are always shown.
const CLOSED_DEAL_MAX_AGE_DAYS = 90;

export interface PipelineDeal {
  id: string;
  user_id: string;
  advisor_id: string | null;
  client_name: string;
  company_name: string;
  client_email: string;
  client_phone: string;
  capital_requested: number;
  pipeline_status: LoanStatus;
  document_count: number;
  total_required_docs: number;
  created_at: string;
  last_activity_at?: string;
  reassigned_to_catch_all_at?: string | null;
  reassignment_paused_until?: string | null;
}

export interface PipelineStage {
  label: string;
  status: LoanStatus;
  color: string;
  accent: string;
  /** Plain-language explanation of what this stage means, shown in the legend. */
  description: string;
}

export const STAGE_MAP: PipelineStage[] = [
  { label: "New Lead",        status: "created",             color: "bg-slate-400",   accent: "text-slate-600",  description: "Application created. No documents requested yet — needs first outreach." },
  { label: "Docs Requested",  status: "onboarding",          color: "bg-blue-400",    accent: "text-blue-600",   description: "Client invited and onboarding. Working through their initial document list." },
  { label: "Pending Docs",    status: "documents_requested", color: "bg-amber-400",   accent: "text-amber-600",  description: "Specific documents have been requested and we're waiting on the client to upload them." },
  { label: "Docs Received",   status: "documents_received",  color: "bg-cyan-400",    accent: "text-cyan-600",   description: "Required documents are in and ready to be packaged for underwriting review." },
  { label: "Underwriting",    status: "under_review",        color: "bg-purple-400",  accent: "text-purple-600", description: "Vault submitted and under active underwriting review." },
  { label: "Offer Received",  status: "lender_matched",      color: "bg-indigo-400",  accent: "text-indigo-600", description: "Matched with a lender and an offer is on the table for the client." },
  { label: "Deal Funded",     status: "funded",              color: "bg-emerald-500", accent: "text-emerald-600", description: "Deal closed and funded. 🎉 Set only from Underwriting's \"Loan Funded\" dialog, which records the lender, amount and term — cards can't be dragged in here." },
  { label: "Consulting Program", status: "consulting_program", color: "bg-teal-400", accent: "text-teal-600", description: "Post-funding consultative track — nurturing a funded client toward renewal and their next round of capital through credit building, tax planning, lien resolution, operations, and accounting." },
  { label: "Closed Lost",     status: "declined",            color: "bg-red-500",     accent: "text-red-600",    description: "Declined or lost. No longer active in the pipeline." },
];

interface PipelineBoardProps {
  deals: PipelineDeal[];
  detailHrefBase: string;
  onDrop: (dealId: string, newStatus: LoanStatus) => void | Promise<void>;
  /** Optional right-side header content (filters/toggles specific to a context). */
  headerActions?: ReactNode;
  title?: string;
  subtitleSuffix?: ReactNode;
}

export function PipelineBoard({
  deals,
  detailHrefBase,
  onDrop,
  headerActions,
  title = "Funding Pipeline",
  subtitleSuffix,
}: PipelineBoardProps) {
  const [collapsedStages, setCollapsedStages] = useState<Set<LoanStatus>>(new Set());
  const [legendOpen, setLegendOpen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  // Prune long-closed deals so the board stays time-sensitive (see constant above).
  const visibleDeals = useMemo(() => {
    const now = new Date();
    return deals.filter((d) => {
      if (d.pipeline_status !== "funded" && d.pipeline_status !== "declined") return true;
      const closedRef = d.last_activity_at || d.created_at;
      return differenceInDays(now, new Date(closedRef)) <= CLOSED_DEAL_MAX_AGE_DAYS;
    });
  }, [deals]);

  const stageStats = useMemo(() => {
    const map = new Map<LoanStatus, { count: number; total: number }>();
    for (const stage of STAGE_MAP) map.set(stage.status, { count: 0, total: 0 });
    for (const deal of visibleDeals) {
      const entry = map.get(deal.pipeline_status);
      if (!entry) continue;
      entry.count += 1;
      entry.total += deal.capital_requested || 0;
    }
    return map;
  }, [visibleDeals]);

  const totalCapital = useMemo(
    () => visibleDeals.reduce((sum, d) => sum + (d.capital_requested || 0), 0),
    [visibleDeals]
  );

  // Column-major order of the currently-visible (filtered) deals. Stashed when a
  // card is opened so the client detail page's prev/next + counter walk exactly
  // the set the user was looking at (e.g. "My Deals") instead of every client.
  const orderedDealIds = useMemo(() => {
    const ids: string[] = [];
    for (const stage of STAGE_MAP) {
      for (const d of visibleDeals) if (d.pipeline_status === stage.status) ids.push(d.id);
    }
    return ids;
  }, [visibleDeals]);

  const stashNavIds = () => {
    try {
      sessionStorage.setItem("pipeline-nav-ids", JSON.stringify(orderedDealIds));
    } catch {}
  };

  const toggleCollapsed = (status: LoanStatus) => {
    setCollapsedStages(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  const scrollToStage = (status: LoanStatus) => {
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-stage="${status}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("dealId", id);
  };

  return (
    <div className="flex flex-col gap-3 md:gap-4 h-[calc(100vh-9rem)] min-h-[600px]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-2 flex-shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl md:text-3xl font-black text-slate-900 dark:text-slate-100 font-headline tracking-tight">
            {title}
          </h1>
          <p className="text-slate-500 text-[11px] md:text-sm mt-0.5">
            {visibleDeals.length} {visibleDeals.length === 1 ? "deal" : "deals"}
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="font-bold text-slate-700 dark:text-slate-300">
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(totalCapital)}
            </span>
            <span className="text-slate-400"> in flight</span>
            {subtitleSuffix}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {headerActions}
          {/* Legend toggle: explains what each pipeline status means. */}
          <button
            onClick={() => setLegendOpen(o => !o)}
            title="What do these statuses mean?"
            className={clsx(
              "inline-flex items-center gap-1.5 h-9 md:h-10 px-3 rounded-xl border text-[12px] font-bold transition-all",
              legendOpen
                ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-emerald-300"
            )}
          >
            <HelpCircle className="h-4 w-4" />
            Legend
          </button>
        </div>
      </div>

      {/* Status legend: plain-language explanation of every stage. */}
      {legendOpen && (
        <div className="flex-shrink-0 mx-2 md:mx-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-500">Status Legend</h2>
            <button
              onClick={() => setLegendOpen(false)}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label="Close legend"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Pipeline stages */}
          <p className="px-4 pt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Pipeline Stage</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 p-4 pt-2">
            {STAGE_MAP.map((stage) => (
              <div key={stage.status} className="flex items-start gap-2.5">
                <span className={clsx("mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0", stage.color)} />
                <div className="min-w-0">
                  <p className={clsx("text-[12px] font-black uppercase tracking-wide", stage.accent)}>{stage.label}</p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">{stage.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Activity badges (card freshness) */}
          <p className="px-4 pt-1 text-[10px] font-black uppercase tracking-widest text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">Activity (card badge)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 p-4 pt-2">
            {ACTIVITY_STATE_LEGEND.map((item) => (
              <div key={item.state} className="flex items-start gap-2.5">
                <span className={clsx("mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0", item.dot)} />
                <div className="min-w-0">
                  <p className="text-[12px] font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">{item.state}</p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stage rail */}
      <div className="flex-shrink-0">
        <StageRail
          stages={STAGE_MAP}
          stats={stageStats}
          collapsed={collapsedStages}
          onJump={scrollToStage}
          onToggleCollapsed={toggleCollapsed}
        />
      </div>

      {/* Board */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          ref={boardRef}
          className="pipeline-board-scroll flex items-stretch gap-3 h-full overflow-x-auto overflow-y-hidden pb-3 px-2 md:px-4 scroll-smooth"
        >
          {STAGE_MAP.map((stage) => {
            const isCollapsed = collapsedStages.has(stage.status);
            const stageDeals = visibleDeals.filter(d => d.pipeline_status === stage.status);
            const stats = stageStats.get(stage.status) || { count: 0, total: 0 };
            return (
              <div
                key={stage.status}
                data-stage={stage.status}
                className={clsx(
                  "flex-shrink-0 transition-[width] duration-300",
                  isCollapsed ? "w-12" : "w-[280px] md:w-[300px]"
                )}
              >
                <KanbanColumn
                  title={stage.label}
                  stage={stage.status}
                  colorClass={stage.color}
                  count={stageDeals.length}
                  totalValue={stats.total}
                  collapsed={isCollapsed}
                  onToggleCollapsed={() => toggleCollapsed(stage.status)}
                  onDrop={(dealId, newStage) => onDrop(dealId, newStage as LoanStatus)}
                  dropDisabled={stage.status === "funded"}
                >
                  {stageDeals.map(deal => (
                    <PipelineDealCard
                      key={deal.id}
                      deal={deal}
                      detailHref={`${detailHrefBase}${deal.id}?from=pipeline`}
                      onOpen={stashNavIds}
                      onDragStart={handleDragStart}
                    />
                  ))}
                </KanbanColumn>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
