"use client";

// One bar to run a client file from. Before this, a detail page opened with
// three stacked strips — queue nav, a row of status chips, and a full-height
// "Funding Pipeline" card — that between them ate the entire first screen
// before any actual file content. They are now a single sticky bar:
//
//   [‹ prev · back to queue 5/169 · next ›] │ ▰▰▰▰▰▱▱▱ Matched · step 6 of 8
//                                            [→ Funded] [Decline] │ [⤢] [⤡]
//
// The pipeline keeps everything it had — per-step tooltips with timestamps,
// click-a-step to move the deal, the advance and decline actions — but reads
// as a progress rail instead of eight labelled circles. The old circle view is
// still one click away behind the chevron, since that is where the history
// timestamps are easiest to scan.
//
// Shared by every portal that shows a client file: underwriting/admin
// (/underwriting/dashboard/clients/[id]) and the advisor/admin/partner
// workspace (components/workspace/workspace-client-file.tsx).

import React, { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FoldVertical,
  History,
  Loader2,
  UnfoldVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoanStatus, PipelineStatusEntry } from "@/app/actions/pipeline";
import { PIPELINE_STEPS, LoanPipelineFull } from "@/components/loan-pipeline-status";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
function BarIconButton({
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

function Divider() {
  return <div className="hidden h-6 w-px shrink-0 bg-slate-200 lg:block" />;
}

export type ClientCommandBarProps = {
  /** Queue navigation. `on_prev`/`on_next` omitted (or null ids) disable the arrows. */
  back_label: string;
  on_back: () => void;
  on_prev?: () => void;
  on_next?: () => void;
  /** 1-based position in the queue; both must be > 0 for the counter to show. */
  nav_index?: number;
  nav_total?: number;

  /** Pipeline. `on_status_change` omitted makes the rail read-only. */
  current_status: LoanStatus;
  pipeline_history: PipelineStatusEntry[];
  on_status_change?: (status: LoanStatus) => void;
  on_decline?: () => void;
  is_advancing?: boolean;

  /**
   * Highest step index this role may advance INTO via the button. Advisors
   * stop after documents_received; underwriting has no cap. The rail itself
   * stays clickable either way — this only gates the one-click advance.
   */
  advance_limit_index?: number;

  /** Section folding, broadcast to every CollapsibleSection on the page. */
  on_expand_all: () => void;
  on_collapse_all: () => void;

  /** Status chips (activity age, stale-upload alerts) rendered inside the bar. */
  chips?: React.ReactNode;
};

export function ClientCommandBar({
  back_label,
  on_back,
  on_prev,
  on_next,
  nav_index,
  nav_total,
  current_status,
  pipeline_history,
  on_status_change,
  on_decline,
  is_advancing,
  advance_limit_index,
  on_expand_all,
  on_collapse_all,
  chips,
}: ClientCommandBarProps) {
  const [details_open, set_details_open] = useState(false);

  const is_declined = current_status === "declined";
  const current_index = PIPELINE_STEPS.findIndex((s) => s.status === current_status);
  const current_step = current_index >= 0 ? PIPELINE_STEPS[current_index] : null;
  const advance_ceiling = advance_limit_index ?? PIPELINE_STEPS.length - 1;
  const next_step =
    current_index >= 0 && current_index < Math.min(advance_ceiling, PIPELINE_STEPS.length - 1)
      ? PIPELINE_STEPS[current_index + 1]
      : null;

  // Latest entry per status — a deal can move backwards, and the newest stamp
  // is the one worth showing.
  const history_map = new Map<LoanStatus, PipelineStatusEntry>();
  for (const entry of [...pipeline_history].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )) {
    history_map.set(entry.status as LoanStatus, entry);
  }

  const show_counter = !!nav_index && !!nav_total && nav_index > 0 && nav_total > 0;

  return (
    <TooltipProvider delayDuration={150}>
      {/* Full-bleed cream backing so page content scrolls UNDER the bar rather
          than beside its rounded corners. Sticky only from md up — below that
          the shells stack their own header rows and a second sticky strip would
          eat most of a phone screen. */}
      <div className="z-20 -mx-4 bg-cb-cream/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 md:sticky md:top-16 lg:-mx-8 lg:px-8">
        <div className="rounded-2xl border border-black/5 bg-white shadow-[0_16px_40px_-32px_rgba(0,3,33,0.55)]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2 lg:flex-nowrap">
            {/* ── Queue navigation ─────────────────────────────────── */}
            <div className="flex shrink-0 items-center gap-0.5">
              <BarIconButton label="Previous client" onClick={on_prev} disabled={!on_prev}>
                <ChevronLeft className="h-4 w-4" />
              </BarIconButton>
              <button
                type="button"
                onClick={on_back}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-black uppercase tracking-widest text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{back_label}</span>
                {show_counter && (
                  <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-emerald-700 tabular-nums">
                    {nav_index}/{nav_total}
                  </span>
                )}
              </button>
              <BarIconButton label="Next client" onClick={on_next} disabled={!on_next}>
                <ChevronRight className="h-4 w-4" />
              </BarIconButton>
            </div>

            <Divider />

            {/* ── Pipeline rail ────────────────────────────────────── */}
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

              <BarIconButton
                label={details_open ? "Hide stage history" : "Show stage history"}
                onClick={() => set_details_open((v) => !v)}
              >
                <History className={cn("h-4 w-4", details_open && "text-emerald-600")} />
              </BarIconButton>
            </div>

            {/* ── Status chips (activity age, stale-upload alerts) ──── */}
            {chips && (
              <>
                <Divider />
                <div className="flex shrink-0 flex-wrap items-center gap-2">{chips}</div>
              </>
            )}

            {/* ── Stage actions ────────────────────────────────────── */}
            {(next_step || on_decline) && <Divider />}
            <div className="flex shrink-0 items-center gap-1.5">
              {next_step && on_status_change && (
                <button
                  type="button"
                  onClick={() => on_status_change(next_step.status)}
                  disabled={is_advancing}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-[10px] font-black uppercase tracking-widest text-white shadow-sm shadow-emerald-500/25 transition-colors hover:bg-emerald-600 disabled:opacity-60"
                >
                  {is_advancing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <ArrowRight className="h-3.5 w-3.5" />
                      {next_step.shortLabel}
                    </>
                  )}
                </button>
              )}
              {on_decline && !is_declined && current_status !== "funded" && (
                <button
                  type="button"
                  onClick={on_decline}
                  disabled={is_advancing}
                  className="inline-flex h-8 items-center rounded-lg border border-rose-200 px-3 text-[10px] font-black uppercase tracking-widest text-rose-500 transition-colors hover:bg-rose-50 disabled:opacity-60"
                >
                  Decline
                </button>
              )}
            </div>

            <Divider />

            {/* ── Section folding ──────────────────────────────────── */}
            <div className="flex shrink-0 items-center gap-0.5">
              <BarIconButton label="Expand all sections" onClick={on_expand_all}>
                <UnfoldVertical className="h-4 w-4" />
              </BarIconButton>
              <BarIconButton label="Collapse all sections" onClick={on_collapse_all}>
                <FoldVertical className="h-4 w-4" />
              </BarIconButton>
            </div>
          </div>

          {/* Pipeline detail — the old circles-and-timestamps view, on demand. */}
          {details_open && (
            <div className="border-t border-slate-100 px-6 py-5">
              <LoanPipelineFull
                currentStatus={current_status}
                history={pipeline_history}
                onStatusChange={on_status_change}
              />
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
