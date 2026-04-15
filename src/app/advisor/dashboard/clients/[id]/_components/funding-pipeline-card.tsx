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
    const currentIdx = PIPELINE_STEPS.findIndex((s) => s.status === current_pipeline_status);
    const canAdvance = currentIdx >= 0 && currentIdx < 3;
    const nextStep = canAdvance ? PIPELINE_STEPS[currentIdx + 1] : null;

    return (
        <section className="mb-8">
            <div className="flex items-center justify-between mb-4 px-1">
                <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                    <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Funding Pipeline
                </h3>
                {nextStep && (
                    <button
                        onClick={() => on_status_change(nextStep.status as LoanStatus)}
                        className="h-8 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black uppercase tracking-widest text-[9px] shadow-lg shadow-emerald-600/20 transition-colors"
                    >
                        Mark {nextStep.shortLabel} Completed
                    </button>
                )}
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl shadow-sm p-8">
                <LoanPipelineFull
                    currentStatus={current_pipeline_status}
                    history={pipeline_history}
                    onStatusChange={(status) => on_status_change(status)}
                />
            </div>
        </section>
    );
}
