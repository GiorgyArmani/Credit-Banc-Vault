"use client";

import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { ReactNode, useState } from "react";

interface KanbanColumnProps {
  title: string;
  count: number;
  stage: string;
  colorClass: string;
  totalValue?: number;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onDrop: (dealId: string, newStage: string) => void;
  children: ReactNode;
}

function format_short_currency(n: number): string {
  if (!n) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

export function KanbanColumn({
  title,
  count,
  stage,
  colorClass,
  totalValue = 0,
  collapsed = false,
  onToggleCollapsed,
  onDrop,
  children,
}: KanbanColumnProps) {
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(true);
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const dealId = e.dataTransfer.getData("dealId");
    if (dealId) {
      onDrop(dealId, stage);
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "h-full w-full rounded-xl border transition-all flex flex-col items-center justify-start py-3 gap-2",
          "bg-slate-50 dark:bg-slate-900/50",
          isOver
            ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20"
            : "border-slate-200/60 dark:border-slate-800/60 hover:border-slate-300 dark:hover:border-slate-700"
        )}
        title={`Expand ${title} (${count})`}
      >
        <div className={cn("w-1.5 h-1.5 rounded-full", colorClass)} />
        <div
          className="text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-400"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {title}
        </div>
        <span className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[9px] font-black px-1.5 py-0.5 rounded-full tabular-nums">
          {count}
        </span>
      </button>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col h-full rounded-xl bg-slate-50/70 dark:bg-slate-900/40 border transition-all duration-200",
        isOver
          ? "border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/20 shadow-lg ring-2 ring-emerald-200/40"
          : "border-slate-200/60 dark:border-slate-800/60"
      )}
    >
      {/* Column header — matches GHL pattern: title row + count/value row */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-200/50 dark:border-slate-800/50 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={cn("w-2 h-2 rounded-full flex-shrink-0", colorClass)} />
            <h3 className="font-black text-slate-800 dark:text-slate-200 text-[12px] uppercase tracking-wider truncate">
              {title}
            </h3>
          </div>
          {onToggleCollapsed && (
            <button
              onClick={onToggleCollapsed}
              title={`Collapse ${title}`}
              className="text-slate-300 hover:text-slate-600 dark:hover:text-slate-300 flex-shrink-0"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
          <span className="font-black text-slate-700 dark:text-slate-300">
            {count} {count === 1 ? "deal" : "deals"}
          </span>
          <span className="text-slate-300">·</span>
          <span className="font-bold text-slate-500 dark:text-slate-400">
            {format_short_currency(totalValue)}
          </span>
        </div>
      </div>

      {/* Cards area — independently scrollable, scrollbar visible */}
      <div className="pipeline-column-scroll flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {children}
        {count === 0 && (
          <div className="h-24 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center bg-white/40 dark:bg-slate-900/10">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Empty</p>
          </div>
        )}
      </div>
    </div>
  );
}
