"use client";

import { ReactNode, useMemo, useRef, useState } from "react";
import { KanbanColumn } from "./kanban-column";
import { PipelineDealCard } from "./pipeline-card";
import { StageRail } from "./stage-rail";
import type { LoanStatus } from "@/app/actions/pipeline";
import clsx from "clsx";

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
}

export interface PipelineStage {
  label: string;
  status: LoanStatus;
  color: string;
  accent: string;
}

export const STAGE_MAP: PipelineStage[] = [
  { label: "New Lead",        status: "created",             color: "bg-slate-400",   accent: "text-slate-600" },
  { label: "Docs Requested",  status: "onboarding",          color: "bg-blue-400",    accent: "text-blue-600" },
  { label: "Pending Docs",    status: "documents_requested", color: "bg-amber-400",   accent: "text-amber-600" },
  { label: "Docs Received",   status: "documents_received",  color: "bg-cyan-400",    accent: "text-cyan-600" },
  { label: "Underwriting",    status: "under_review",        color: "bg-purple-400",  accent: "text-purple-600" },
  { label: "Offer Received",  status: "lender_matched",      color: "bg-indigo-400",  accent: "text-indigo-600" },
  { label: "Deal Funded",     status: "funded",              color: "bg-emerald-500", accent: "text-emerald-600" },
  { label: "Closed Lost",     status: "declined",            color: "bg-red-500",     accent: "text-red-600" },
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
  const boardRef = useRef<HTMLDivElement>(null);

  const stageStats = useMemo(() => {
    const map = new Map<LoanStatus, { count: number; total: number }>();
    for (const stage of STAGE_MAP) map.set(stage.status, { count: 0, total: 0 });
    for (const deal of deals) {
      const entry = map.get(deal.pipeline_status);
      if (!entry) continue;
      entry.count += 1;
      entry.total += deal.capital_requested || 0;
    }
    return map;
  }, [deals]);

  const totalCapital = useMemo(
    () => deals.reduce((sum, d) => sum + (d.capital_requested || 0), 0),
    [deals]
  );

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
            {deals.length} {deals.length === 1 ? "deal" : "deals"}
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="font-bold text-slate-700 dark:text-slate-300">
              {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(totalCapital)}
            </span>
            <span className="text-slate-400"> in flight</span>
            {subtitleSuffix}
          </p>
        </div>

        {headerActions && (
          <div className="flex items-center gap-2 flex-wrap">{headerActions}</div>
        )}
      </div>

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
            const stageDeals = deals.filter(d => d.pipeline_status === stage.status);
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
                >
                  {stageDeals.map(deal => (
                    <PipelineDealCard
                      key={deal.id}
                      deal={deal}
                      detailHref={`${detailHrefBase}${deal.id}`}
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
