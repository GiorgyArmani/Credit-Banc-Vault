"use client";

import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import type { LoanStatus } from "@/app/actions/pipeline";

interface Stage {
  label: string;
  status: LoanStatus;
  color: string;
  accent: string;
}

interface StageRailProps {
  stages: Stage[];
  stats: Map<LoanStatus, { count: number; total: number }>;
  collapsed: Set<LoanStatus>;
  onJump: (status: LoanStatus) => void;
  onToggleCollapsed: (status: LoanStatus) => void;
}

function format_short_currency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  if (n > 0) return `$${n}`;
  return "$0";
}

export function StageRail({ stages, stats, collapsed, onJump, onToggleCollapsed }: StageRailProps) {
  return (
    <div className="px-2 md:px-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {stages.map((stage) => {
          const entry = stats.get(stage.status) || { count: 0, total: 0 };
          const isCollapsed = collapsed.has(stage.status);
          return (
            <div
              key={stage.status}
              className={cn(
                "group flex-shrink-0 inline-flex items-center gap-2 rounded-xl border bg-white dark:bg-slate-900 transition-all",
                isCollapsed
                  ? "border-slate-200/50 dark:border-slate-800/50 opacity-60"
                  : "border-slate-200 dark:border-slate-800 hover:border-emerald-300 hover:shadow-sm"
              )}
            >
              <button
                onClick={() => onJump(stage.status)}
                className="flex items-center gap-2 pl-3 pr-2 py-1.5"
              >
                <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", stage.color)} />
                <span className="text-[10px] md:text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  {stage.label}
                </span>
                <span className="text-[10px] md:text-[11px] font-bold text-slate-400 tabular-nums">
                  {entry.count}
                </span>
                {entry.total > 0 && (
                  <span className={cn("text-[10px] md:text-[11px] font-black tabular-nums", stage.accent)}>
                    {format_short_currency(entry.total)}
                  </span>
                )}
              </button>
              <button
                onClick={() => onToggleCollapsed(stage.status)}
                title={isCollapsed ? `Expand ${stage.label}` : `Collapse ${stage.label}`}
                className="pr-2 pl-1 py-1.5 text-slate-300 hover:text-slate-600 dark:hover:text-slate-300 border-l border-slate-100 dark:border-slate-800/50"
              >
                {isCollapsed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
