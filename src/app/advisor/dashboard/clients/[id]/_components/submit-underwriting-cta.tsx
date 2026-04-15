"use client";

import { ShieldCheck, CheckCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";

interface SubmitUnderwritingCTAProps {
    client_name: string;
    completion_percentage: number;
    submission_status: string | null;
    submitted_at: string | null;
    is_submitting: boolean;
    on_submit: () => void;
}

export function SubmitUnderwritingCTA({
    client_name,
    completion_percentage,
    submission_status,
    submitted_at,
    is_submitting,
    on_submit,
}: SubmitUnderwritingCTAProps) {
    const already_submitted = submission_status === "locked" && completion_percentage === 100;
    const ready_to_submit = completion_percentage === 100 && !already_submitted;

    return (
        <section className={clsx(
            "rounded-2xl p-6 flex items-center justify-between shadow-sm",
            already_submitted
                ? "bg-emerald-50 border border-emerald-200"
                : "bg-gradient-to-r from-emerald-950 to-emerald-900"
        )}>
            <div>
                <h4 className={clsx(
                    "font-extrabold text-base mb-1",
                    already_submitted ? "text-emerald-800" : "text-white"
                )}>
                    {already_submitted ? "Vault Submitted to Underwriting" : "Submit to Underwriting"}
                </h4>
                <p className={clsx(
                    "text-sm",
                    already_submitted ? "text-emerald-600" : "text-emerald-300"
                )}>
                    {already_submitted
                        ? submitted_at
                            ? `Submitted on ${format(new Date(submitted_at), "MMM d, yyyy")}.`
                            : "This vault has been sent to the underwriting team."
                        : ready_to_submit
                            ? submission_status === "submitted"
                                ? `${client_name} submitted their vault. Review and send to underwriting.`
                                : "All documents approved — ready for final submission."
                            : `${completion_percentage}% complete. Approve all required documents to unlock submission.`
                    }
                </p>
            </div>

            <div className="flex-shrink-0 ml-6">
                {already_submitted ? (
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-100 border border-emerald-300 rounded-xl text-emerald-800 font-bold text-sm">
                        <CheckCircle className="h-4 w-4" />
                        Submitted
                    </div>
                ) : (
                    <button
                        onClick={on_submit}
                        disabled={!ready_to_submit || is_submitting}
                        className={clsx(
                            "flex items-center gap-2 px-6 py-3 rounded-xl font-black text-sm transition-all",
                            ready_to_submit
                                ? "bg-emerald-400 hover:bg-emerald-300 text-emerald-950 shadow-lg shadow-emerald-900/40 hover:scale-[1.02]"
                                : "bg-emerald-900/40 text-emerald-700 cursor-not-allowed"
                        )}
                    >
                        {is_submitting ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Submitting…
                            </>
                        ) : (
                            <>
                                <ShieldCheck className="h-4 w-4" />
                                Submit
                            </>
                        )}
                    </button>
                )}
            </div>
        </section>
    );
}
