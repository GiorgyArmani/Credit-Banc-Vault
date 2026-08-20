"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

// The lender-side pipeline: submitted → (approved | declined) by lender →
// funded. This is the only verdict the card tracks now, so it drives both the
// row's pill and its avatar — an admin reads the lender's answer without
// leaving the page, and can record it here too.
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
 * Admin-only card on the unified client view: WHICH lenders were chosen and
 * WHAT each one answered. Not an approval queue.
 *
 * It used to be one — UW picked, the admin approved or rejected each lender,
 * and only then could it go out. That gate is gone: admins are informed, not
 * asked. What remains is
 *   • the list of chosen lenders and their live lender-side status,
 *   • each lender's recorded response (offer / stips / decline reasons),
 *   • "Add lender" for the common case where the admin already knows exactly
 *     who this file is going to — no match run, no bank analysis needed,
 *   • "Mark submitted" so that same admin can push it out from here instead of
 *     handing off to the UW screen,
 *   • "Remove", to take a mistaken pick off the list. That is list-keeping, not
 *     a veto: nothing waits on it and nothing is pending without it.
 */
export function AdminLenderReviewCard({ clientId }: Props) {
    const supabase = createClient();
    const [assignments, set_assignments] = useState<LenderAssignment[]>([]);
    const [is_loading, set_is_loading] = useState(true);
    const [is_bank_analysis_open, set_is_bank_analysis_open] = useState(false);
    const [lender_options, set_lender_options] = useState<LenderGuideline[]>([]);
    const [taken_lender_names, set_taken_lender_names] = useState<Set<string>>(new Set());
    const [is_picker_open, set_is_picker_open] = useState(false);
    const [is_adding_lender, set_is_adding_lender] = useState(false);
    /** Assignment id whose Remove is one click from happening. Two-step instead
     *  of a browser confirm(), which blocks the whole tab. */
    const [confirm_remove_id, set_confirm_remove_id] = useState<string | null>(null);
    const [busy_row_id, set_busy_row_id] = useState<string | null>(null);

    async function fetch_assignments() {
        set_is_loading(true);
        // Two queries: one for the visible list, one for the set of lender
        // names the picker should hide. Both exclude REMOVED rows — a removed
        // lender is off the list but back on offer, because removing is now a
        // one-click operation and the POST restores such a row instead of
        // refusing it. Hiding them permanently would make a misclick final.
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
                .eq("client_id", clientId)
                .neq("admin_review", "rejected"),
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

    // Hide lenders already on this client's list. Removed ones are NOT hidden:
    // re-picking one restores it. Backend POST enforces the same rule; this
    // filter just stops the UI from offering picks that would 409.
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
            toast.success(
                result.restored
                    ? `${lender.lender_name} put back on this file`
                    : `Added ${lender.lender_name} — ready to submit, UW notified`
            );
            // Picker stays OPEN. An admin who already knows the file's lenders
            // usually knows more than one, and closing after each pick made
            // adding three lenders three round-trips through the popover.
            // fetch_assignments refreshes taken_lender_names, so the one just
            // added drops out of the list on its own.
            await fetch_assignments();
        } catch (err: any) {
            console.error('AdminLenderReviewCard add error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_adding_lender(false);
        }
    }

    /**
     * Push this lender out to market from here. Same endpoint the UW screen
     * calls; it accepts admins too. The point is that an admin who added a
     * lender they already knew shouldn't have to hand the file to another
     * screen just to mark it sent.
     */
    async function mark_submitted(assignment_id: string, lender_name: string) {
        set_busy_row_id(assignment_id);
        try {
            const res = await fetch(`/api/lender-assignments/${assignment_id}/submit`, {
                method: 'PATCH',
            });
            const result = await res.json();
            if (!res.ok || !result.success) {
                toast.error(result?.error || 'Failed to mark as submitted');
                return;
            }
            toast.success(`${lender_name} marked as submitted — posted to the deal channel`);
            await fetch_assignments();
        } catch (err: any) {
            console.error('AdminLenderReviewCard mark_submitted error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_busy_row_id(null);
        }
    }

    /**
     * Record what the lender came back with. Same endpoint the UW screen's
     * dropdown calls. An admin who added the lender and marked it submitted has
     * to be able to close the loop here too — otherwise the card shows a
     * verdict it can never receive.
     */
    async function set_lender_response(
        assignment_id: string,
        lender_name: string,
        status: 'submitted' | 'approved_by_lender' | 'declined_by_lender'
    ) {
        set_busy_row_id(assignment_id);
        try {
            const res = await fetch(`/api/lender-assignments/${assignment_id}/response`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            const result = await res.json();
            if (!res.ok || !result.success) {
                toast.error(result?.error || 'Failed to record the response');
                return;
            }
            toast.success(
                status === 'approved_by_lender' ? `${lender_name} approved`
                    : status === 'declined_by_lender' ? `${lender_name} declined`
                    : `${lender_name} back to awaiting`
            );
            await fetch_assignments();
        } catch (err: any) {
            console.error('AdminLenderReviewCard set_lender_response error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_busy_row_id(null);
        }
    }

    /**
     * Take a lender off this client's list. Reuses the review endpoint's
     * 'rejected' state, which is what hides the row and stops it being
     * submitted — but it is no longer a review step: the list is complete and
     * submittable without anyone touching this.
     */
    async function remove_lender(assignment_id: string, lender_name: string) {
        set_busy_row_id(assignment_id);
        try {
            const res = await fetch('/api/admin/lender-reviews', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: [{ assignment_id, decision: 'rejected', notes: 'Removed by admin' }],
                }),
            });
            const result = await res.json();
            if (!res.ok || !result.success) {
                toast.error(result?.error || 'Failed to remove lender');
                return;
            }
            toast.success(`${lender_name} removed from this file`);
            set_confirm_remove_id(null);
            await fetch_assignments();
        } catch (err: any) {
            console.error('AdminLenderReviewCard remove error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_busy_row_id(null);
        }
    }

    // Headline counts describe the OUTREACH, not a review backlog: how many
    // lenders this file is going to, and how many are already out the door.
    const selected_count = assignments.length;
    const out_count = assignments.filter(a =>
        ['submitted', 'approved_by_lender', 'declined_by_lender', 'funded'].includes(a.status)
    ).length;

    return (
        <>
        <div className="p-6">
            <div className="pb-4 mb-2 border-b border-slate-100 flex flex-row items-center justify-between gap-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {selected_count} lender{selected_count === 1 ? '' : 's'} selected
                    {out_count > 0 && ` · ${out_count} out to lender`}
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
                </div>
            </div>

            {/* Says the quiet part out loud. This card used to be a gate — UW
                could not submit until an admin cleared each lender — and an
                admin who still reads it as an approval queue will assume the
                deal is waiting on them, which is exactly what left seven
                lenders parked for months. Nothing here is pending on anyone. */}
            {!is_loading && assignments.length > 0 && (
                <p className="mb-1 text-[11px] leading-relaxed text-slate-400">
                    Nothing here needs your approval — this is who the file is going to and
                    what each lender said back. Add a lender if you already know who this
                    one is for.
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
                            No lenders on this file yet
                        </p>
                        <p className="text-[11px] font-medium text-slate-400 mt-2">
                            Add the lender directly if you already know who this deal is going to,
                            or run the match tool.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {assignments.map((a) => {
                            const is_busy = busy_row_id === a.id;
                            // Only rows still sitting with us can be marked out
                            // or pulled; once a lender has the file, its state
                            // is driven by their answer, not by us.
                            const is_actionable = a.status === 'pending';

                            return (
                                <div key={a.id} className="p-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex items-center gap-3 min-w-0">
                                            {/* Avatar tracks the LENDER's answer, which is the
                                                only verdict that matters now. */}
                                            <div className={clsx(
                                                "w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shadow-sm shrink-0",
                                                a.status === 'funded' ? "bg-violet-500 text-white" :
                                                a.status === 'approved_by_lender' ? "bg-emerald-500 text-white" :
                                                a.status === 'declined_by_lender' ? "bg-rose-500 text-white" :
                                                a.status === 'submitted' ? "bg-blue-500 text-white" :
                                                "bg-slate-200 text-slate-500"
                                            )}>
                                                {a.status === 'funded' ? '★' :
                                                 a.status === 'approved_by_lender' ? '✓' :
                                                 a.status === 'declined_by_lender' ? '✕' :
                                                 a.status === 'submitted' ? '→' : '•'}
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
                                            {/* One pill, the lender's status. The old second pill
                                                echoed admin_review ("approved") next to it, which
                                                read as a decision the admin had made. */}
                                            <Badge className={clsx(
                                                "font-black text-[9px] uppercase tracking-widest px-3 py-1",
                                                LENDER_STATUS_PILL[a.status]?.classes
                                                    ?? "bg-slate-100 text-slate-500 hover:bg-slate-100"
                                            )}>
                                                {LENDER_STATUS_PILL[a.status]?.label ?? 'Not sent yet'}
                                            </Badge>
                                            {a.assigned_at && (
                                                <p className="text-[8px] font-bold text-slate-300 mt-1 uppercase tracking-tighter">
                                                    Selected {format(new Date(a.assigned_at), 'MMM d')}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action row — only for a lender that hasn't gone out yet.
                                        Send it, or take it off the list. No decision to record. */}
                                    {is_actionable && (
                                        <div className="mt-4 flex items-center gap-2 flex-wrap">
                                            <Button
                                                size="sm"
                                                onClick={() => mark_submitted(a.id, a.lender_name)}
                                                disabled={is_busy}
                                                className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white"
                                            >
                                                {is_busy ? (
                                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                ) : (
                                                    <Check className="h-3 w-3 mr-1" />
                                                )}
                                                Mark submitted
                                            </Button>
                                            {confirm_remove_id === a.id ? (
                                                <>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => remove_lender(a.id, a.lender_name)}
                                                        disabled={is_busy}
                                                        className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest border-orange-300 text-orange-600 hover:bg-orange-50"
                                                    >
                                                        <X className="h-3 w-3 mr-1" />
                                                        Confirm remove
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => set_confirm_remove_id(null)}
                                                        className="h-8 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-500"
                                                    >
                                                        Cancel
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => set_confirm_remove_id(a.id)}
                                                    disabled={is_busy}
                                                    className="h-8 px-2 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600"
                                                >
                                                    Remove
                                                </Button>
                                            )}
                                        </div>
                                    )}

                                    {/* Historical admin note, from back when this card recorded
                                        review decisions. Read-only — nothing writes these now. */}
                                    {a.admin_review_notes && (
                                        <div className="mt-3">
                                            <p className="text-xs text-slate-500 italic px-3 py-2 bg-slate-50 rounded-lg">
                                                {a.admin_review_notes}
                                            </p>
                                        </div>
                                    )}

                                    {/* What the lender said. Editable up to (not including)
                                        funded — that one is set by the Loan Funded flow, which
                                        records amounts and terms, and must not be reachable from
                                        a three-button toggle. */}
                                    {a.status !== 'pending' && a.status !== 'funded' && (
                                        <div className="mt-4 flex items-center gap-2 flex-wrap">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                                                Lender said
                                            </span>
                                            {([
                                                { value: 'submitted', label: 'Awaiting' },
                                                { value: 'approved_by_lender', label: 'Approved' },
                                                { value: 'declined_by_lender', label: 'Declined' },
                                            ] as const).map(({ value, label }) => (
                                                <Button
                                                    key={value}
                                                    size="sm"
                                                    variant={a.status === value ? 'default' : 'outline'}
                                                    disabled={is_busy || a.status === value}
                                                    onClick={() => set_lender_response(a.id, a.lender_name, value)}
                                                    className={clsx(
                                                        "h-7 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-100",
                                                        a.status === value && value === 'approved_by_lender' && "bg-emerald-500 hover:bg-emerald-500 text-white",
                                                        a.status === value && value === 'declined_by_lender' && "bg-rose-500 hover:bg-rose-500 text-white",
                                                        a.status === value && value === 'submitted' && "bg-blue-500 hover:bg-blue-500 text-white"
                                                    )}
                                                >
                                                    {label}
                                                </Button>
                                            ))}
                                        </div>
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
