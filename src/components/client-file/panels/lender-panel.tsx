// src/components/client-file/panels/lender-panel.tsx
//
// The lenders on this file: header counters + actions, then one row per
// assignment for the active round.
//
// Lifted verbatim out of the underwriting client page's
// `render_lender_assignments()` so the same panel can be mounted on the admin
// client file in phase 3. Presentational: every value it used to close over is
// a prop, so it never reads `pathname`, `router` or page state. Navigation
// (match tool) and the re-submit dialog stay with the caller.

"use client";

import { BarChart3, ChevronDown, ExternalLink, Loader2, RotateCcw, Star } from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyLine } from "@/components/client-file/empty-line";
import { ShareWithLenderButton } from "@/components/share/share-with-lender-button";
import { LenderResponsePanel } from "@/components/lender/lender-response-panel";
import { UwAddLenderButton } from "@/components/lender/uw-add-lender-button";
import { LenderApiRowActions } from "@/components/lender-api/lender-api-row-actions";
import type { useLenderApiAssignments } from "@/components/lender-api/use-lender-api-assignments";

export interface LenderAssignment {
    id: string;
    lender_name: string;
    specialty: string | null;
    decision: 'approved' | 'rejected';
    payment_type: string | null;
    min_funding: number | null;
    max_funding: number | null;
    assigned_at: string;
    admin_review: 'pending' | 'approved' | 'rejected';
    admin_review_notes: string | null;
    admin_reviewed_at: string | null;
    source: 'match_tool' | 'admin_manual';
    status: 'pending' | 'submitted' | 'approved_by_lender' | 'declined_by_lender' | 'funded';
}

/** The three statuses a submitted row can be moved between from the inline dropdown. */
export type SubmittedLifecycleStatus = 'submitted' | 'approved_by_lender' | 'declined_by_lender';

// Effective UI states for a lender assignment. The matching engine proposes
// (decision), UW selects, and the selection is cleared for outreach on the spot
// (admin_review='approved' at insert). UW then physically pushes the file out
// (status='submitted') and records the lender's verdict
// (status='approved_by_lender' | 'declined_by_lender'). The label rendered to
// UW is the derived combination of those columns.
//
// Admins do not approve lenders any more — they are informed of them. The only
// thing admin_review still expresses is REMOVAL: 'rejected' means the lender was
// taken off the file (removed_by_admin, and the submit route refuses it).
// 'pending' — the state every legacy row was left in, never backfilled — now
// reads as "nobody removed this", so those rows are submittable like any other.
export type LenderRowState =
    | 'rejected_by_matcher'   // decision = rejected
    | 'removed_by_admin'       // decision = approved, admin_review = rejected
    | 'ready_to_submit'        // on the file, status = pending
    | 'submitted'              // status = submitted, awaiting lender
    | 'approved_by_lender'     // lender approved the submission
    | 'declined_by_lender'     // lender declined the submission
    | 'funded';                // deal funded

export function derive_lender_row_state(a: LenderAssignment): LenderRowState {
    if (a.decision !== 'approved') return 'rejected_by_matcher';
    if (a.admin_review === 'rejected') return 'removed_by_admin';
    if (a.status === 'funded') return 'funded';
    if (a.status === 'approved_by_lender') return 'approved_by_lender';
    if (a.status === 'declined_by_lender') return 'declined_by_lender';
    if (a.status === 'submitted') return 'submitted';
    return 'ready_to_submit';
}

export type LenderPanelProps = {
    /** Already scoped to the active round by the caller. */
    assignments: LenderAssignment[];
    api_summaries: ReturnType<typeof useLenderApiAssignments>["summaries"];
    /** Reload assignments + api summaries. */
    on_api_changed: () => void | Promise<void>;
    response_panel_epoch: Record<string, number>;
    submitting_assignment_id: string | null;
    on_mark_submitted: (assignment_id: string) => void;
    on_mark_status: (assignment_id: string, status: SubmittedLifecycleStatus) => void;
    on_resubmit_request: (row: { id: string; lender_name: string; status: string }) => void;
    on_open_bank_analysis: () => void;
    on_open_match_tool: () => void;
    client_id: string;
    business_profile_id: string | null;
    on_lender_added: () => void;
};

/**
 * LenderPanel: the lenders on this file.
 *
 * Renders even with NONE on it. It used to return null on an empty list,
 * which hid the whole card — and with it the Add Lender button — on exactly
 * the file that needs it: the common case is an admin naming the lender and
 * UW attaching and contacting it, no match run at all. The empty card is
 * where that starts, so it has to be on screen.
 */
export function LenderPanel({
    assignments,
    api_summaries,
    on_api_changed,
    response_panel_epoch,
    submitting_assignment_id,
    on_mark_submitted,
    on_mark_status,
    on_resubmit_request,
    on_open_bank_analysis,
    on_open_match_tool,
    client_id,
    business_profile_id,
    on_lender_added,
}: LenderPanelProps) {
    const ready_count = assignments.filter(a => derive_lender_row_state(a) === 'ready_to_submit').length;
    const submitted_count = assignments.filter(a => derive_lender_row_state(a) === 'submitted').length;

    const STATE_BADGE: Record<LenderRowState, { label: string; classes: string }> = {
        rejected_by_matcher: { label: 'Rejected (matcher)', classes: 'bg-rose-100 text-rose-700 hover:bg-rose-100' },
        removed_by_admin:    { label: 'Removed (admin)',     classes: 'bg-orange-100 text-orange-700 hover:bg-orange-100' },
        ready_to_submit:     { label: 'Ready to submit',     classes: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' },
        submitted:           { label: 'Submitted · awaiting lender', classes: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
        approved_by_lender:  { label: 'Approved by lender',  classes: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' },
        declined_by_lender:  { label: 'Declined by lender',  classes: 'bg-rose-100 text-rose-700 hover:bg-rose-100' },
        funded:              { label: 'Funded',              classes: 'bg-violet-100 text-violet-700 hover:bg-violet-100' },
    };

    return (
        <div>
            <div className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-black/5 px-5 py-4">
                <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-emerald-500/10 p-2">
                        <Star className="h-4 w-4 text-emerald-600" />
                    </div>
                    <p className="text-sm text-cb-ink/60">
                        {ready_count} ready · {submitted_count} submitted · {assignments.length} total
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={on_open_bank_analysis}
                        className="h-8 gap-1.5 rounded-lg border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream"
                    >
                        <BarChart3 className="h-3.5 w-3.5" />
                        View bank analysis
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={on_open_match_tool}
                        className="h-8 gap-1.5 rounded-lg border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream"
                    >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Match tool
                    </Button>
                    <UwAddLenderButton
                        clientId={client_id}
                        businessProfileId={business_profile_id}
                        assignedLenderNames={assignments.map((a) => a.lender_name)}
                        onAdded={on_lender_added}
                    />
                    <ShareWithLenderButton
                        clientId={client_id}
                        businessProfileId={business_profile_id}
                        triggerLabel="Share"
                        lenderOptions={assignments.map((a) => a.lender_name)}
                        className="h-8 gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream"
                    />
                </div>
            </div>
            <div>
                {assignments.length === 0 && (
                    <div className="px-5 py-3">
                        <EmptyLine>
                            No lenders on this file yet — add one directly, or open the match tool to score the file
                        </EmptyLine>
                    </div>
                )}
                <div className="divide-y divide-black/5">
                    {assignments.map((assign) => {
                        const row_state = derive_lender_row_state(assign);
                        const badge = STATE_BADGE[row_state];
                        const is_submitting_this = submitting_assignment_id === assign.id;
                        // Rows that are out the door (and not yet funded) get the inline
                        // status dropdown instead of a static badge.
                        const is_lifecycle_row =
                            row_state === 'submitted' ||
                            row_state === 'approved_by_lender' ||
                            row_state === 'declined_by_lender';
                        const tile_classes =
                            row_state === 'submitted'           ? 'bg-blue-500 text-white' :
                            row_state === 'approved_by_lender'  ? 'bg-emerald-500 text-white' :
                            row_state === 'ready_to_submit'     ? 'bg-emerald-500 text-white' :
                            row_state === 'funded'              ? 'bg-violet-500 text-white' :
                            row_state === 'removed_by_admin'    ? 'bg-orange-500 text-white' :
                                                                   'bg-rose-500 text-white';
                        const tile_glyph =
                            row_state === 'submitted'           ? '→' :
                            row_state === 'approved_by_lender'  ? '✓' :
                            row_state === 'ready_to_submit'     ? '✓' :
                            row_state === 'funded'              ? '★' :
                                                                   '✕';

                        return (
                            <div key={assign.id} className="group p-4 transition-colors hover:bg-black/[0.02]">
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-4 min-w-0">
                                    <div className={clsx(
                                        "w-10 h-10 rounded-xl flex items-center justify-center font-semibold text-sm shrink-0",
                                        tile_classes
                                    )}>
                                        {tile_glyph}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="truncate font-semibold text-cb-ink transition-colors group-hover:text-emerald-700">
                                                {assign.lender_name}
                                            </p>
                                            {assign.specialty && (
                                                <Badge variant="outline" className="shrink-0 rounded-full border-black/10 bg-black/5 px-2 py-0.5 text-[11px] font-medium text-cb-ink/60">
                                                    {assign.specialty}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="mt-1 flex items-center gap-3 text-xs text-cb-ink/40">
                                            <span>{assign.payment_type || 'Custom terms'}</span>
                                            {assign.min_funding && (
                                                <>
                                                    <span aria-hidden className="text-cb-ink/25">·</span>
                                                    <span>Min: ${(assign.min_funding / 1000).toFixed(0)}k</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <LenderApiRowActions
                                        assignmentId={assign.id}
                                        assignmentStatus={assign.status}
                                        summary={api_summaries[assign.id]}
                                        onChanged={on_api_changed}
                                    />
                                    {row_state === 'ready_to_submit' && (
                                        <Button
                                            size="sm"
                                            disabled={is_submitting_this}
                                            onClick={() => on_mark_submitted(assign.id)}
                                            className="h-8 gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                                        >
                                            {is_submitting_this ? (
                                                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Submitting</>
                                            ) : (
                                                'Mark as submitted'
                                            )}
                                        </Button>
                                    )}
                                    {/* A lender that has answered can be worked again: get what it
                                        asked for, send the same file back. Separate from the status
                                        dropdown on purpose — the dropdown is for correcting a
                                        misclick, and only this button retires the recorded response. */}
                                    {(row_state === 'approved_by_lender' || row_state === 'declined_by_lender') && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={is_submitting_this}
                                            onClick={() => on_resubmit_request({ id: assign.id, lender_name: assign.lender_name, status: assign.status })}
                                            className="h-8 gap-1.5 rounded-lg border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream"
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                            Re-submit
                                        </Button>
                                    )}
                                    <div className="text-right flex flex-col items-end">
                                        {is_lifecycle_row ? (
                                            // Submitted-lifecycle rows: the status pill is a dropdown so
                                            // UW can record the lender's verdict (or correct it) inline.
                                            <div className="relative inline-flex items-center">
                                                <select
                                                    value={assign.status}
                                                    disabled={is_submitting_this}
                                                    onChange={(e) => on_mark_status(assign.id, e.target.value as SubmittedLifecycleStatus)}
                                                    className={clsx(
                                                        "cursor-pointer appearance-none rounded-full border-0 py-1 pl-3 pr-7 text-xs font-semibold outline-none disabled:opacity-60",
                                                        badge.classes
                                                    )}
                                                >
                                                    <option value="submitted">Submitted · awaiting lender</option>
                                                    <option value="approved_by_lender">Lender approved</option>
                                                    <option value="declined_by_lender">Lender declined</option>
                                                </select>
                                                {is_submitting_this ? (
                                                    <Loader2 className="h-3 w-3 animate-spin absolute right-2 pointer-events-none" />
                                                ) : (
                                                    <ChevronDown className="h-3 w-3 absolute right-2 pointer-events-none opacity-70" />
                                                )}
                                            </div>
                                        ) : (
                                            <Badge className={clsx(
                                                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                                badge.classes
                                            )}>
                                                {badge.label}
                                            </Badge>
                                        )}
                                        <p className="mt-1 text-xs text-cb-ink/40">
                                            Assigned {format(new Date(assign.assigned_at), 'MMM d')}
                                        </p>
                                    </div>
                                </div>
                              </div>
                              {is_lifecycle_row && (
                                <LenderResponsePanel
                                    key={`${assign.id}:${response_panel_epoch[assign.id] ?? 0}`}
                                    assignmentId={assign.id}
                                    status={assign.status}
                                />
                              )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
