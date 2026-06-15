"use client";

import { LoanPipelineFull, PIPELINE_STEPS } from "@/components/loan-pipeline-status";
import { LoanStatus, PipelineStatusEntry } from "@/app/actions/pipeline";

interface FundingPipelineCardProps {
    current_pipeline_status: LoanStatus;
    pipeline_history: PipelineStatusEntry[];
    on_status_change: (status: LoanStatus) => void;
}

export function FundingPipelineCard({
    current_pipeline_status,
    pipeline_history,
    on_status_change,
}: FundingPipelineCardProps) {
    return (
        <div className="p-8">
            <LoanPipelineFull
                currentStatus={current_pipeline_status}
                history={pipeline_history}
                onStatusChange={(status) => on_status_change(status)}
            />
        </div>
    );
}

/**
 * The "Mark <next step> Completed" button that used to live in the
 * FundingPipelineCard header. Rendered into the CollapsibleSection `accessory`
 * slot so it stays on the right of the section header.
 */
export function FundingPipelineAdvanceButton({
    current_pipeline_status,
    on_status_change,
}: {
    current_pipeline_status: LoanStatus;
    on_status_change: (status: LoanStatus) => void;
}) {
    const currentIdx = PIPELINE_STEPS.findIndex((s) => s.status === current_pipeline_status);
    const canAdvance = currentIdx >= 0 && currentIdx < 3;
    const nextStep = canAdvance ? PIPELINE_STEPS[currentIdx + 1] : null;

    if (!nextStep) return null;

    return (
        <button
            onClick={() => on_status_change(nextStep.status as LoanStatus)}
            className="h-8 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black uppercase tracking-widest text-[9px] shadow-lg shadow-emerald-600/20 transition-colors"
        >
            Mark {nextStep.shortLabel} Completed
        </button>
    );
}
