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
// Used by the underwriting client file (/underwriting/dashboard/clients/[id]).
// The advisor/admin/partner workspace file now uses
// components/client-file/file-header.tsx instead.

import React, { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FoldVertical,
  Loader2,
  UnfoldVertical,
} from "lucide-react";
import type { LoanStatus, PipelineStatusEntry } from "@/app/actions/pipeline";
import { LoanPipelineFull } from "@/components/loan-pipeline-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BarIconButton, PipelineRail, getNextStep } from "@/components/client-file/pipeline-rail";

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
  const next_step = getNextStep(current_status, advance_limit_index);

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
            <PipelineRail
              current_status={current_status}
              pipeline_history={pipeline_history}
              on_status_change={on_status_change}
              details_open={details_open}
              on_toggle_details={() => set_details_open((v) => !v)}
            />

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
