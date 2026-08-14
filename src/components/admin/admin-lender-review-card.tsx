"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Loader2, Check, X, ExternalLink, BarChart3, Plus } from "lucide-react";
import Link from "next/link";
import { BankAnalysisViewer } from "./bank-analysis-viewer";
import { LenderResponsePanel } from "@/components/lender/lender-response-panel";
import { toast } from "@/lib/toast";
import clsx from "clsx";
import { format } from "date-fns";

interface LenderGuideline {
    id: string;
    lender_name: string;
    specialty: string | null;
    tier_label: string | null;
    payment_type: string | null;
    min_funding: number | null;
    max_funding: number | null;
}

interface LenderAssignment {
    id: string;
    client_id: string;
    lender_name: string;
    specialty: string | null;
    tier_label: string | null;
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

// The lender-side pipeline status, set by UW after admin clears a lender for
// outreach: submitted → (approved | declined) by lender → funded. Rendered as
// a secondary pill so admins see the lender's verdict without leaving the page.
const LENDER_STATUS_PILL: Record<
    LenderAssignment['status'],
    { label: string; classes: string } | null
> = {
    pending:            null,
    submitted:          { label: 'Submitted · awaiting lender', classes: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
    approved_by_lender: { label: 'Approved by lender',          classes: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' },
    declined_by_lender: { label: 'Declined by lender',          classes: 'bg-rose-100 text-rose-700 hover:bg-rose-100' },
    funded:             { label: 'Funded',                      classes: 'bg-violet-100 text-violet-700 hover:bg-violet-100' },
};

interface Props {
    clientId: string;
}

/**
 * Admin-only card on the unified client view.
 * Shows the lender matching results UW saved (rows where decision='approved')
 * and lets admins approve or reject each lender for outreach. Decisions are
 * batched locally so the admin can mark several lenders, optionally add notes,
 * and submit in one round-trip via /api/admin/lender-reviews.
 */
export function AdminLenderReviewCard({ clientId }: Props) {
    const supabase = createClient();
    const [assignments, set_assignments] = useState<LenderAssignment[]>([]);
    const [is_loading, set_is_loading] = useState(true);
    const [is_submitting, set_is_submitting] = useState(false);
    const [pending, set_pending] = useState<
        Record<string, { decision: 'approved' | 'rejected'; notes: string }>
    >({});
    const [is_bank_analysis_open, set_is_bank_analysis_open] = useState(false);
    const [lender_options, set_lender_options] = useState<LenderGuideline[]>([]);
    const [taken_lender_names, set_taken_lender_names] = useState<Set<string>>(new Set());
    const [is_picker_open, set_is_picker_open] = useState(false);
    const [is_adding_lender, set_is_adding_lender] = useState(false);

    async function fetch_assignments() {
        set_is_loading(true);
        // Two queries: one filtered for the visible list (no rejected rows),
        // one unfiltered to know which lenders have ever been used on this
        // client so the + Add Lender picker hides them too. Lender selection
        // is per-client — once a lender is rejected for client X, it's off
        // the table for client X regardless of how the admin re-opens the
        // file. (Matches the backend duplicate check in POST.)
        const [{ data: visible, error: visible_error }, { data: all_for_client, error: all_error }] = await Promise.all([
            supabase
                .from("client_lender_assignments")
                .select("*")
                .eq("client_id", clientId)
                .eq("decision", "approved")
                .neq("admin_review", "rejected")
                .order("assigned_at", { ascending: false }),
            supabase
                .from("client_lender_assignments")
                .select("lender_name")
                .eq("client_id", clientId),
        ]);
        if (visible_error) {
            console.error("AdminLenderReviewCard fetch error:", visible_error);
        }
        if (all_error) {
            console.error("AdminLenderReviewCard taken-names fetch error:", all_error);
        }
        set_assignments(visible ?? []);
        set_taken_lender_names(new Set(
            (all_for_client ?? []).map(r => (r.lender_name as string).toLowerCase())
        ));
        set_is_loading(false);
    }

    async function fetch_lender_options() {
        const { data, error } = await supabase
            .from("lender_guidelines")
            .select("id, lender_name, specialty, tier_label, payment_type, min_funding, max_funding")
            .order("lender_name", { ascending: true });
        if (error) {
            console.error("AdminLenderReviewCard lender_guidelines fetch error:", error);
            return;
        }
        set_lender_options(data ?? []);
    }

    useEffect(() => {
        fetch_assignments();
        fetch_lender_options();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId]);

    // Hide lenders that have ever been assigned to this client — including
    // previously rejected ones, since lender selection is per-client and a
    // skip means "off the table for this client". Backend POST enforces the
    // same rule, this filter just stops the UI from offering doomed picks.
    const available_lenders = useMemo(() => {
        return lender_options.filter(l => !taken_lender_names.has(l.lender_name.toLowerCase()));
    }, [lender_options, taken_lender_names]);

    async function add_lender_manually(lender: LenderGuideline) {
        set_is_adding_lender(true);
        try {
            const res = await fetch('/api/admin/lender-reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: clientId,
                    lender_guideline_id: lender.id,
                }),
            });
            const result = await res.json();
            if (!res.ok || !result.success) {
                toast.error(result?.error || 'Failed to add lender');
                return;
            }
            toast.success(`Added ${lender.lender_name} — cleared for submission, UW notified`);
            set_is_picker_open(false);
            // No staging any more. The row lands admin_review='approved' and the
            // POST notifies UW itself, so there is nothing left for Save Review
            // to do here — auto-staging a decision would just leave a dirty
            // panel the admin has to clear.
            await fetch_assignments();
        } catch (err: any) {
            console.error('AdminLenderReviewCard add error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_adding_lender(false);
        }
    }

    const stage_decision = (assignment_id: string, decision: 'approved' | 'rejected') => {
        set_pending(prev => ({
            ...prev,
            [assignment_id]: { decision, notes: prev[assignment_id]?.notes ?? "" },
        }));
    };

    const stage_notes = (assignment_id: string, notes: string) => {
        set_pending(prev => ({
            ...prev,
            [assignment_id]: { decision: prev[assignment_id]?.decision ?? 'approved', notes },
        }));
    };

    const clear_pending = (assignment_id: string) => {
        set_pending(prev => {
            const next = { ...prev };
            delete next[assignment_id];
            return next;
        });
    };

    async function submit_review() {
        const items = Object.entries(pending).map(([assignment_id, v]) => ({
            assignment_id,
            decision: v.decision,
            notes: v.notes || undefined,
        }));
        if (items.length === 0) return;

        set_is_submitting(true);
        try {
            const res = await fetch('/api/admin/lender-reviews', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items }),
            });
            const result = await res.json();
            if (!res.ok || !result.success) {
                toast.error(result?.error || 'Failed to save review');
                return;
            }
            toast.success(`Saved review for ${items.length} lender${items.length > 1 ? 's' : ''}`);
            set_pending({});
            await fetch_assignments();
        } catch (err: any) {
            console.error('AdminLenderReviewCard submit error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_submitting(false);
        }
    }

    const pending_count = Object.keys(pending).length;
    const approved_final = assignments.filter(a => a.admin_review === 'approved').length;
    // Only legacy rows can still be 'pending' — every new assignment, from the
    // match tool and both manual paths, is born cleared. Kept because rows
    // written before that change are still on file and must not look cleared.
    const still_pending = assignments.filter(a => a.admin_review === 'pending').length;

    return (
        <>
        <div className="p-6">
            <div className="pb-4 mb-2 border-b border-slate-100 flex flex-row items-center justify-between gap-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {approved_final} cleared to submit
                    {still_pending > 0 && ` · ${still_pending} awaiting decision`}
                </p>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => set_is_bank_analysis_open(true)}
                        className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest border-slate-200"
                    >
                        <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
                        View Bank Analysis
                    </Button>
                    <Link href={`/admin/uw/lender-match?client=${clientId}`}>
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest border-slate-200"
                        >
                            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                            Match Tool
                        </Button>
                    </Link>
                    <Popover open={is_picker_open} onOpenChange={set_is_picker_open}>
                        <PopoverTrigger asChild>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={is_adding_lender}
                                className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest border-slate-200"
                            >
                                {is_adding_lender ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                ) : (
                                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                                )}
                                Add Lender
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-80 p-0 rounded-2xl">
                            <Command>
                                <CommandInput placeholder="Search lenders..." className="h-10 text-sm" />
                                <CommandList className="max-h-72">
                                    <CommandEmpty>
                                        <p className="text-xs text-slate-500 py-4">
                                            {lender_options.length === 0
                                                ? 'No lenders in database.'
                                                : 'No matching lender available.'}
                                        </p>
                                    </CommandEmpty>
                                    <CommandGroup heading="Lender Database">
                                        {available_lenders.map((lender) => (
                                            <CommandItem
                                                key={lender.id}
                                                value={lender.lender_name}
                                                onSelect={() => add_lender_manually(lender)}
                                                disabled={is_adding_lender}
                                                className="cursor-pointer"
                                            >
                                                <div className="flex flex-col gap-0.5 min-w-0 w-full">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-bold text-slate-900 truncate">
                                                            {lender.lender_name}
                                                        </span>
                                                        {lender.specialty && (
                                                            <Badge variant="outline" className="text-[8px] font-black tracking-widest uppercase py-0 px-2 border-slate-200 text-slate-500">
                                                                {lender.specialty}
                                                            </Badge>
                                                        )}
                                                        {lender.tier_label && (
                                                            <Badge variant="outline" className="text-[8px] font-black tracking-widest uppercase py-0 px-2 border-slate-300 text-slate-600 bg-slate-100">
                                                                {lender.tier_label}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    {(lender.min_funding != null || lender.max_funding != null) && (
                                                        <span className="text-[10px] text-slate-400 font-medium">
                                                            {lender.min_funding != null && `Min $${(lender.min_funding / 1000).toFixed(0)}k`}
                                                            {lender.min_funding != null && lender.max_funding != null && ' • '}
                                                            {lender.max_funding != null && `Max $${(lender.max_funding / 1000).toFixed(0)}k`}
                                                        </span>
                                                    )}
                                                </div>
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                    {pending_count > 0 && (
                        <Button
                            size="sm"
                            onClick={submit_review}
                            disabled={is_submitting}
                            className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm"
                        >
                            {is_submitting ? (
                                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving</>
                            ) : (
                                `Save review (${pending_count})`
                            )}
                        </Button>
                    )}
                </div>
            </div>

            {/* Says the quiet part out loud. This card used to be a gate — UW
                could not submit until an admin cleared each lender — and the
                buttons still look like an approval queue. Without this line an
                admin reasonably assumes the deal is waiting on them, which is
                the exact behaviour that left seven lenders parked for months. */}
            {!is_loading && assignments.length > 0 && (
                <p className="mb-1 text-[11px] leading-relaxed text-slate-400">
                    These lenders are already cleared and UW can submit them.
                    Use <span className="font-bold text-slate-500">Skip</span> only
                    if you want one pulled before it goes out.
                </p>
            )}

            <div>
                {is_loading ? (
                    <div className="p-10 text-center">
                        <Loader2 className="h-6 w-6 text-emerald-500 animate-spin mx-auto" />
                    </div>
                ) : assignments.length === 0 ? (
                    <div className="p-10 text-center">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                            No lender matches yet
                        </p>
                        <p className="text-[11px] font-medium text-slate-400 mt-2">
                            UW hasn't run the lender match for this client.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {assignments.map((a) => {
                            const staged = pending[a.id];
                            const effective = staged?.decision ?? a.admin_review;
                            const is_pending_review = a.admin_review === 'pending' && !staged;

                            return (
                                <div key={a.id} className="p-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={clsx(
                                                "w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shadow-sm shrink-0",
                                                effective === 'approved' ? "bg-emerald-500 text-white" :
                                                effective === 'rejected' ? "bg-orange-500 text-white" :
                                                "bg-slate-200 text-slate-500"
                                            )}>
                                                {effective === 'approved' ? '✓' : effective === 'rejected' ? '✕' : '?'}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="font-black text-slate-900 uppercase tracking-tight truncate">
                                                        {a.lender_name}
                                                    </p>
                                                    {a.specialty && (
                                                        <Badge variant="outline" className="text-[8px] font-black tracking-widest uppercase py-0 px-2 border-slate-200 text-slate-500">
                                                            {a.specialty}
                                                        </Badge>
                                                    )}
                                                    {a.tier_label && (
                                                        <Badge variant="outline" className="text-[8px] font-black tracking-widest uppercase py-0 px-2 border-slate-300 text-slate-600 bg-slate-100">
                                                            {a.tier_label}
                                                        </Badge>
                                                    )}
                                                    {a.source === 'admin_manual' && (
                                                        <Badge className="text-[8px] font-black tracking-widest uppercase py-0 px-2 bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                            Manual
                                                        </Badge>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                                    <span>{a.payment_type || 'Custom Terms'}</span>
                                                    {a.min_funding != null && (
                                                        <>
                                                            <span className="opacity-30">•</span>
                                                            <span>Min: ${(a.min_funding / 1000).toFixed(0)}k</span>
                                                        </>
                                                    )}
                                                    {a.max_funding != null && (
                                                        <>
                                                            <span className="opacity-30">•</span>
                                                            <span>Max: ${(a.max_funding / 1000).toFixed(0)}k</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                                            <Badge className={clsx(
                                                "font-black text-[9px] uppercase tracking-widest px-3 py-1",
                                                effective === 'approved' ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" :
                                                effective === 'rejected' ? "bg-orange-100 text-orange-700 hover:bg-orange-100" :
                                                "bg-slate-100 text-slate-500 hover:bg-slate-100"
                                            )}>
                                                {staged ? `${effective} (unsaved)` : effective}
                                            </Badge>
                                            {LENDER_STATUS_PILL[a.status] && (
                                                <Badge className={clsx(
                                                    "font-black text-[9px] uppercase tracking-widest px-3 py-1",
                                                    LENDER_STATUS_PILL[a.status]!.classes
                                                )}>
                                                    {LENDER_STATUS_PILL[a.status]!.label}
                                                </Badge>
                                            )}
                                            {a.admin_reviewed_at && !staged && (
                                                <p className="text-[8px] font-bold text-slate-300 mt-1 uppercase tracking-tighter">
                                                    Reviewed {format(new Date(a.admin_reviewed_at), 'MMM d')}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action row — only while a decision is still needed or being
                                        staged. Once the lender has been marked Contact/Skip and saved,
                                        collapse to a single "Change decision" link so reviewed rows
                                        don't keep showing the buttons. */}
                                    {(is_pending_review || staged) ? (
                                        <div className="mt-4 flex items-center gap-2 flex-wrap">
                                            <Button
                                                size="sm"
                                                variant={effective === 'approved' ? "default" : "outline"}
                                                onClick={() => stage_decision(a.id, 'approved')}
                                                className={clsx(
                                                    "h-8 rounded-lg text-[10px] font-black uppercase tracking-widest",
                                                    effective === 'approved' && "bg-emerald-500 hover:bg-emerald-600 text-white"
                                                )}
                                            >
                                                <Check className="h-3 w-3 mr-1" />
                                                Contact
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant={effective === 'rejected' ? "default" : "outline"}
                                                onClick={() => stage_decision(a.id, 'rejected')}
                                                className={clsx(
                                                    "h-8 rounded-lg text-[10px] font-black uppercase tracking-widest",
                                                    effective === 'rejected' && "bg-orange-500 hover:bg-orange-600 text-white"
                                                )}
                                            >
                                                <X className="h-3 w-3 mr-1" />
                                                Skip
                                            </Button>
                                            {staged && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => clear_pending(a.id)}
                                                    className="h-8 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-500"
                                                >
                                                    Cancel
                                                </Button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="mt-4">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => stage_decision(a.id, a.admin_review === 'rejected' ? 'rejected' : 'approved')}
                                                className="h-8 px-2 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600"
                                            >
                                                Change decision
                                            </Button>
                                        </div>
                                    )}

                                    {/* Notes — show when staging or when notes exist */}
                                    {(staged || a.admin_review_notes) && (
                                        <div className="mt-3">
                                            {staged ? (
                                                <Textarea
                                                    value={staged.notes}
                                                    onChange={(e) => stage_notes(a.id, e.target.value)}
                                                    placeholder="Optional note (visible to UW)…"
                                                    className="min-h-[60px] rounded-xl border-slate-200 text-sm"
                                                />
                                            ) : (
                                                <p className="text-xs text-slate-500 italic px-3 py-2 bg-slate-50 rounded-lg">
                                                    {a.admin_review_notes}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {is_pending_review && !staged && (
                                        <p className="mt-2 text-[10px] font-bold text-amber-600 uppercase tracking-widest">
                                            Awaiting admin decision
                                        </p>
                                    )}

                                    {/* Lender's recorded response (note + screenshots) once the
                                        deal is out to the lender. Lazily loads on expand. */}
                                    {a.status !== 'pending' && (
                                        <LenderResponsePanel assignmentId={a.id} status={a.status} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>

        <BankAnalysisViewer
            clientId={clientId}
            isOpen={is_bank_analysis_open}
            onClose={() => set_is_bank_analysis_open(false)}
        />
        </>
    );
}
