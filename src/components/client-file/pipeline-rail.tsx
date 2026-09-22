"use client";

// The compact pipeline rail: one segment per step, with tooltips carrying the
// timestamp and who moved it, click-to-move, and the history toggle. Extracted
// from ClientCommandBar so the client-file header and the command bar render
// the same rail.

import React from "react";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoanStatus, PipelineStatusEntry } from "@/app/actions/pipeline";
import { PIPELINE_STEPS } from "@/components/loan-pipeline-status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function format_stamp(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Square icon button — the bar's default control. */
export function BarIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-25"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs font-bold">{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function getNextStep(current_status: LoanStatus, advance_limit_index?: number | null) {
  const current_index = PIPELINE_STEPS.findIndex((s) => s.status === current_status);
  const ceiling = advance_limit_index ?? PIPELINE_STEPS.length - 1;
  return current_index >= 0 && current_index < Math.min(ceiling, PIPELINE_STEPS.length - 1)
    ? PIPELINE_STEPS[current_index + 1]
    : null;
}

export function PipelineRail({
  current_status,
  pipeline_history,
  on_status_change,
  details_open,
  on_toggle_details,
  label_variant = "bar",
}: {
  current_status: LoanStatus;
  pipeline_history: PipelineStatusEntry[];
  on_status_change?: (status: LoanStatus) => void;
  details_open: boolean;
  on_toggle_details: () => void;
  /** "bar" (default): ClientCommandBar's uppercase-tracked label, unchanged.
   *  "header": the client-file header's sentence-case label. */
  label_variant?: "bar" | "header";
}) {
  const is_declined = current_status === "declined";
  const current_index = PIPELINE_STEPS.findIndex((s) => s.status === current_status);
  const current_step = current_index >= 0 ? PIPELINE_STEPS[current_index] : null;

  // Latest entry per status. A deal can move backwards, and the newest stamp
  // is the one worth showing.
  const history_map = new Map<LoanStatus, PipelineStatusEntry>();
  for (const entry of [...pipeline_history].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )) {
    history_map.set(entry.status as LoanStatus, entry);
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex min-w-[7.5rem] flex-1 items-center gap-1">
        {PIPELINE_STEPS.map((step, idx) => {
          const is_done = !is_declined && idx < current_index;
          const is_current = !is_declined && idx === current_index;
          const entry = history_map.get(step.status);
          return (
            <Tooltip key={step.status}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => on_status_change?.(step.status)}
                  disabled={!on_status_change}
                  aria-label={`Move to ${step.label}`}
                  aria-current={is_current ? "step" : undefined}
                  className={cn(
                    "h-1.5 min-w-[10px] flex-1 rounded-full transition-all duration-300",
                    on_status_change
                      ? "cursor-pointer hover:brightness-95"
                      : "cursor-default",
                    is_declined
                      ? "bg-rose-200"
                      : is_done
                        ? "bg-emerald-300"
                        : is_current
                          ? "h-2.5 bg-emerald-600 shadow-[0_0_0_3px_rgba(5,150,105,0.18)]"
                          : "bg-slate-200"
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-center">
                <p className="text-xs font-black">{step.label}</p>
                {entry ? (
                  <>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {format_stamp(entry.created_at)}
                    </p>
                    {entry.changed_by_role && (
                      <p className="text-[10px] text-slate-400">by {entry.changed_by_role}</p>
                    )}
                  </>
                ) : (
                    <p className="mt-0.5 text-[10px] text-slate-400">Not yet reached</p>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {label_variant === "header" ? (
          <div className="shrink-0">
            <p className={cn("text-sm font-semibold", is_declined ? "text-rose-600" : "text-cb-ink")}>
              {is_declined ? "Declined" : (current_step?.shortLabel ?? "—")}
            </p>
            {!is_declined && current_index >= 0 && (
              <p className="text-xs text-cb-ink/40 tabular-nums">
                Step {current_index + 1} of {PIPELINE_STEPS.length}
              </p>
            )}
          </div>
        ) : (
        <div className="shrink-0 leading-none">
          <p
            className={cn(
              "text-[11px] font-black uppercase tracking-widest",
              is_declined ? "text-rose-600" : "text-slate-900"
            )}
          >
            {is_declined ? "Declined" : (current_step?.shortLabel ?? "—")}
          </p>
          {!is_declined && current_index >= 0 && (
            <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-400 tabular-nums">
              Step {current_index + 1} of {PIPELINE_STEPS.length}
            </p>
          )}
        </div>
      )}

      <BarIconButton
        label={details_open ? "Hide stage history" : "Show stage history"}
        onClick={on_toggle_details}
      >
        <History className={cn("h-4 w-4", details_open && "text-emerald-600")} />
      </BarIconButton>
    </div>
  );
}
