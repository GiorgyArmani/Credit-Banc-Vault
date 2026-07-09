"use client";

import { LoanStatus, PipelineStatusEntry } from "@/app/actions/pipeline";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Pipeline step definitions ─────────────────────────────────────────

export const PIPELINE_STEPS: { status: LoanStatus; label: string; shortLabel: string }[] = [
  { status: "created", label: "Application Created", shortLabel: "Created" },
  { status: "onboarding", label: "Client Onboarding", shortLabel: "Onboarding" },
  { status: "documents_requested", label: "Documents Requested", shortLabel: "Docs Requested" },
  { status: "documents_received", label: "Documents Received", shortLabel: "Docs In" },
  { status: "under_review", label: "Under Review", shortLabel: "In Review" },
  { status: "lender_matched", label: "Lender Matched", shortLabel: "Matched" },
  { status: "consulting_program", label: "Consulting Program", shortLabel: "Consulting" },
  { status: "funded", label: "Loan Funded", shortLabel: "Funded" },
];

const DECLINED_STATUS: LoanStatus = "declined";

const STATUS_ORDER: LoanStatus[] = PIPELINE_STEPS.map((s) => s.status);

function getStepIndex(status: LoanStatus): number {
  return STATUS_ORDER.indexOf(status);
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ─── Full Pipeline (used on client detail page) ───────────────────────────────

interface LoanPipelineFullProps {
  currentStatus: LoanStatus;
  history: PipelineStatusEntry[];
  onStatusChange?: (status: LoanStatus) => void;
  className?: string;
  showAllSteps?: boolean;
}

export function LoanPipelineFull({ currentStatus, history, onStatusChange, className, showAllSteps = true }: LoanPipelineFullProps) {
  // The Consulting Program stage only applies to clients we're actively priming
  // on a consultative basis. On the client-facing bar (showAllSteps = false) we
  // hide it entirely unless this client has actually touched consulting — either
  // they're in it now or their history contains a consulting_program entry.
  const inConsulting =
    currentStatus === 'consulting_program' ||
    history.some(h => h.status === 'consulting_program');

  const displayedSteps = showAllSteps
    ? PIPELINE_STEPS
    : PIPELINE_STEPS.filter(
        s =>
          s.status !== 'created' &&
          s.status !== 'onboarding' &&
          (s.status !== 'consulting_program' || inConsulting)
      );

  const isDeclined = currentStatus === DECLINED_STATUS;
  const currentIndex = isDeclined ? -1 : displayedSteps.findIndex(s => s.status === currentStatus);

  // Map status → history entry for tooltip (ensure we show the LATEST entry for bi-directional moves)
  const historyMap = new Map<LoanStatus, PipelineStatusEntry>();
  const sortedHistory = [...history].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  for (const entry of sortedHistory) {
    historyMap.set(entry.status as LoanStatus, entry);
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn("w-full", className)}>
        {isDeclined ? (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl">
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <Circle className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <p className="font-black text-red-700 text-sm uppercase tracking-tight">Application Declined</p>
              {historyMap.get(DECLINED_STATUS) && (
                <p className="text-[11px] text-red-500 font-bold mt-0.5">
                  {formatDate(historyMap.get(DECLINED_STATUS)!.created_at)}
                  {historyMap.get(DECLINED_STATUS)!.note && ` · ${historyMap.get(DECLINED_STATUS)!.note}`}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="relative">
            {/* Connector line */}
            <div className="absolute top-5 left-5 right-5 h-0.5 bg-slate-100 -z-0" />
            <div
              className="absolute top-5 left-5 h-0.5 bg-emerald-400 -z-0 transition-all duration-700"
              style={{
                width: currentIndex <= 0
                  ? "0%"
                  : `${(currentIndex / (displayedSteps.length - 1)) * 100}%`,
              }}
            />

            <div className="flex justify-between relative z-10">
              {displayedSteps.map((step, idx) => {
                const isCompleted = idx < currentIndex;
                const isCurrent = idx === currentIndex;
                const historyEntry = historyMap.get(step.status);

                return (
                  <Tooltip key={step.status}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "flex flex-col items-center gap-2 min-w-0 transition-opacity",
                          onStatusChange ? "cursor-pointer hover:opacity-80" : "cursor-default"
                        )}
                        onClick={() => onStatusChange?.(step.status)}
                      >
                        {/* Circle indicator */}
                        <div
                          className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-500 flex-shrink-0",
                            isCompleted
                              ? "bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-200"
                              : isCurrent
                                ? "bg-white border-emerald-400 text-emerald-500 shadow-lg shadow-emerald-100 ring-4 ring-emerald-100"
                                : "bg-white border-slate-200 text-slate-300"
                          )}
                        >
                          {isCompleted ? (
                            <CheckCircle2 className="h-5 w-5" />
                          ) : isCurrent ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Circle className="h-4 w-4" />
                          )}
                        </div>

                        {/* Label */}
                        <span
                          className={cn(
                            "text-[9px] font-black uppercase tracking-widest text-center leading-tight max-w-[60px]",
                            isCompleted ? "text-emerald-600" : isCurrent ? "text-slate-900" : "text-slate-300"
                          )}
                        >
                          {step.shortLabel}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[200px] text-center">
                      <p className="font-black text-xs">{step.label}</p>
                      {historyEntry ? (
                        <>
                          <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(historyEntry.created_at)}</p>
                          {historyEntry.changed_by_role && (
                            <p className="text-[10px] text-slate-400">by {historyEntry.changed_by_role}</p>
                          )}
                          {historyEntry.note && (
                            <p className="text-[10px] italic text-slate-500 mt-1">{historyEntry.note}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-[10px] text-slate-400 mt-0.5">Not yet reached</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// ─── Compact Badge (used on dashboard cards) ──────────────────────────────────

interface LoanPipelineBadgeProps {
  currentStatus: LoanStatus;
  className?: string;
}

const STATUS_CONFIG: Record<LoanStatus, { label: string; color: string }> = {
  created: { label: "Created", color: "bg-slate-100 text-slate-600 border-slate-200" },
  onboarding: { label: "Onboarding", color: "bg-blue-100 text-blue-700 border-blue-200" },
  documents_requested: { label: "Docs Requested", color: "bg-amber-100 text-amber-700 border-amber-200" },
  documents_received: { label: "Docs Received", color: "bg-cyan-100 text-cyan-700 border-cyan-200" },
  under_review: { label: "Under Review", color: "bg-purple-100 text-purple-700 border-purple-200" },
  lender_matched: { label: "Lender Matched", color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  consulting_program: { label: "Consulting Program", color: "bg-teal-100 text-teal-700 border-teal-200" },
  funded: { label: "Funded 🎉", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  declined: { label: "Declined", color: "bg-red-100 text-red-700 border-red-200" },
};

export function LoanPipelineBadge({ currentStatus, className }: LoanPipelineBadgeProps) {
  const config = STATUS_CONFIG[currentStatus] ?? STATUS_CONFIG["created"];
  const stepIndex = getStepIndex(currentStatus);
  const totalSteps = PIPELINE_STEPS.length - 1;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border",
          config.color
        )}
      >
        {config.label}
      </span>
      {currentStatus !== "declined" && (
        <span className="text-[9px] font-bold text-slate-400">
          Step {stepIndex + 1}/{totalSteps + 1}
        </span>
      )}
    </div>
  );
}
