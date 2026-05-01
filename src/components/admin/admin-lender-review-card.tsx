"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Check, X, Star, ExternalLink, BarChart3 } from "lucide-react";
import Link from "next/link";
import { BankAnalysisViewer } from "./bank-analysis-viewer";
import { toast } from "sonner";
import clsx from "clsx";
import { format } from "date-fns";

interface LenderAssignment {
    id: string;
    client_id: string;
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
}

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

    async function fetch_assignments() {
        set_is_loading(true);
        const { data, error } = await supabase
            .from("client_lender_assignments")
            .select("*")
            .eq("client_id", clientId)
            .eq("decision", "approved") // only show lenders the matching engine cleared
            .order("assigned_at", { ascending: false });
        if (error) {
            console.error("AdminLenderReviewCard fetch error:", error);
        }
        set_assignments(data ?? []);
        set_is_loading(false);
    }

    useEffect(() => {
        fetch_assignments();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId]);

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
    const rejected_final = assignments.filter(a => a.admin_review === 'rejected').length;
    const still_pending = assignments.filter(a => a.admin_review === 'pending').length;

    return (
        <>
        <Card className="rounded-[2.5rem] border-slate-200 overflow-hidden shadow-sm">
            <CardHeader className="pb-4 border-b border-slate-100 flex flex-row items-center justify-between bg-slate-50/30">
                <div className="flex items-center gap-3">
                    <div className="bg-emerald-500/10 p-2 rounded-xl">
                        <Star className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div>
                        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                            Lender Match — Admin Review
                        </CardTitle>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                            {still_pending} pending · {approved_final} approved · {rejected_final} rejected
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
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
            </CardHeader>

            <CardContent className="p-0">
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
                                        <div className="text-right shrink-0">
                                            <Badge className={clsx(
                                                "font-black text-[9px] uppercase tracking-widest px-3 py-1",
                                                effective === 'approved' ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" :
                                                effective === 'rejected' ? "bg-orange-100 text-orange-700 hover:bg-orange-100" :
                                                "bg-slate-100 text-slate-500 hover:bg-slate-100"
                                            )}>
                                                {staged ? `${effective} (unsaved)` : effective}
                                            </Badge>
                                            {a.admin_reviewed_at && !staged && (
                                                <p className="text-[8px] font-bold text-slate-300 mt-1 uppercase tracking-tighter">
                                                    Reviewed {format(new Date(a.admin_reviewed_at), 'MMM d')}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Action row */}
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
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>

        <BankAnalysisViewer
            clientId={clientId}
            isOpen={is_bank_analysis_open}
            onClose={() => set_is_bank_analysis_open(false)}
        />
        </>
    );
}
