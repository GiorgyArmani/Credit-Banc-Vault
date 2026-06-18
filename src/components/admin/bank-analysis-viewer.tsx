"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, BarChart3, Download } from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";
import { toast } from "@/lib/toast";

interface BankAnalysisRow {
    id: string;
    client_id: string;
    business_name: string | null;
    owner_name: string | null;
    fico: number | null;
    tib_months: number | null;
    avg_revenue: number | null;
    avg_daily_balance: number | null;
    avg_monthly_deposits: number | null;
    total_neg_days: number | null;
    num_open_positions: number | null;
    has_bankruptcy: boolean | null;
    capital_requested: number | null;
    accounts_data: any;
    positions_data: any;
    questions_data: any;
    company_state: string | null;
    industry: string | null;
    created_at: string;
    updated_at: string;
}

interface Props {
    clientId: string;
    isOpen: boolean;
    onClose: () => void;
}

const fmt_money = (v: number | null | undefined) =>
    v == null ? "—" : `$${Math.round(v).toLocaleString()}`;

const fmt_num = (v: number | null | undefined) =>
    v == null ? "—" : v.toLocaleString();

/**
 * Read-only viewer for a saved bank_analysis_results row.
 * Opens as a modal on the unified client view so admins/UW don't have to
 * navigate to the editor when they just want to see the saved numbers.
 * Re-running or editing still happens on the dedicated /bank-analysis page.
 */
export function BankAnalysisViewer({ clientId, isOpen, onClose }: Props) {
    const supabase = createClient();
    const [analysis, set_analysis] = useState<BankAnalysisRow | null>(null);
    const [is_loading, set_is_loading] = useState(true);
    const [error_message, set_error_message] = useState<string | null>(null);
    const [is_exporting, set_is_exporting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        (async () => {
            set_is_loading(true);
            set_error_message(null);
            // Latest snapshot only — the table is now append-only so each
            // save adds a new row. The admin viewer is read-only and meant
            // to surface "what does UW have right now," which is the most
            // recent row.
            const { data, error } = await supabase
                .from("bank_analysis_results")
                .select("*")
                .eq("client_id", clientId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            if (cancelled) return;
            if (error) {
                console.error("bank analysis fetch error:", error);
                set_error_message("Failed to load saved bank analysis.");
            }
            set_analysis((data as BankAnalysisRow) ?? null);
            set_is_loading(false);
        })();
        return () => { cancelled = true; };
    }, [isOpen, clientId, supabase]);

    const tib_display = (months: number | null | undefined) => {
        if (months == null) return "—";
        const y = Math.floor(months / 12);
        const m = months % 12;
        if (y === 0) return `${m} mo`;
        if (m === 0) return `${y} yr`;
        return `${y}yr ${m}mo`;
    };

    const accounts: any[] = Array.isArray(analysis?.accounts_data) ? analysis!.accounts_data : [];
    const positions: any[] = Array.isArray(analysis?.positions_data)
        ? analysis!.positions_data.filter((p: any) => p && (p.funderLender || p.balance || p.amount))
        : [];

    /**
     * Generates the same PDF the editor produces, but built from the saved
     * bank_analysis_results row plus a small lookup for advisor + followers.
     * Dynamic import keeps @react-pdf/renderer out of the initial bundle.
     */
    async function export_pdf() {
        if (!analysis) return;
        set_is_exporting(true);
        const toast_id = toast.loading("Generating PDF…");
        try {
            const [{ pdf }, { default: BankAnalysisPDF }] = await Promise.all([
                import("@react-pdf/renderer"),
                import("@/components/pdf/bank-analysis-pdf"),
            ]);

            // Look up assigned team for the PDF's Team card. Non-fatal.
            let advisor_name: string | undefined;
            const follower_names: string[] = [];
            try {
                const { data: vault_row } = await supabase
                    .from("client_data_vault")
                    .select("advisor_id, advisor_name, business_start_date")
                    .eq("id", clientId)
                    .maybeSingle();

                if (vault_row?.advisor_id) {
                    const { data: advisor_row } = await supabase
                        .from("advisors")
                        .select("first_name, last_name")
                        .eq("id", vault_row.advisor_id)
                        .maybeSingle();
                    if (advisor_row) {
                        advisor_name = `${advisor_row.first_name ?? ""} ${advisor_row.last_name ?? ""}`.trim();
                    }
                }
                if (!advisor_name && vault_row?.advisor_name && vault_row.advisor_name !== "Unknown") {
                    advisor_name = vault_row.advisor_name;
                }

                const { data: follower_rows } = await supabase
                    .from("client_followers")
                    .select("advisors:advisor_id(first_name, last_name)")
                    .eq("client_vault_id", clientId);

                (follower_rows ?? []).forEach((r: any) => {
                    const a = Array.isArray(r.advisors) ? r.advisors[0] : r.advisors;
                    if (!a) return;
                    const name = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
                    if (name) follower_names.push(name);
                });
            } catch (lookup_err) {
                console.error("team lookup failed (non-fatal):", lookup_err);
            }

            // The DB row doesn't store monthRange/activeMonthIndices (those
            // are editor-only state), so we infer them from the first account's
            // months[]: any month slot with a non-zero deposit/balance counts
            // as "active". This matches what the user actually saw on screen.
            const MONTH_LABELS_3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const first_account_months: any[] = Array.isArray(accounts[0]?.months) ? accounts[0].months : [];
            const active_indices: number[] = [];
            first_account_months.forEach((m: any, idx: number) => {
                const td = parseFloat(m?.totalDeposits ?? "0") || 0;
                const eb = parseFloat(m?.endingBalance ?? "0") || 0;
                const bb = parseFloat(m?.beginningBalance ?? "0") || 0;
                if (td !== 0 || eb !== 0 || bb !== 0) active_indices.push(idx);
            });
            const month_range = (active_indices.length === 4 || active_indices.length === 6 || active_indices.length === 8 || active_indices.length === 12)
                ? active_indices.length
                : 3;
            const final_active_indices = active_indices.length > 0 ? active_indices : [
                // fallback: assume the most recent 3 months
                ...Array.from({ length: 3 }, (_, i) => ((new Date().getMonth() - 1 - 2 + i + 12) % 12)),
            ];
            const active_month_labels = final_active_indices.map(i => MONTH_LABELS_3[i] ?? "");

            const avg_neg_days =
                analysis.total_neg_days != null && final_active_indices.length > 0
                    ? analysis.total_neg_days / final_active_indices.length
                    : 0;

            const pdfData = {
                businessName: analysis.business_name || "—",
                ownerName: analysis.owner_name || "",
                state: analysis.company_state || "",
                industry: analysis.industry || "",
                avgRevenue: analysis.avg_revenue ?? 0,
                avgDailyBalance: analysis.avg_daily_balance ?? 0,
                avgMonthlyDeposits: analysis.avg_monthly_deposits ?? 0,
                totalNegDays: analysis.total_neg_days ?? 0,
                avgNegDays: avg_neg_days,
                numOpenPositions: analysis.num_open_positions ?? positions.length,
                capitalRequested: analysis.capital_requested ?? 0,
                fico: analysis.fico ?? 0,
                tibMonths: analysis.tib_months ?? 0,
                hasBankruptcy: !!analysis.has_bankruptcy,
                monthRange: month_range,
                activeMonths: active_month_labels,
                activeMonthIndices: final_active_indices,
                accounts: accounts as any,
                positions: positions as any,
                questions: (analysis.questions_data ?? {}) as Record<string, string>,
                advisorName: advisor_name,
                followers: follower_names,
                generatedAt: new Date().toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                }),
            };

            const blob = await pdf(<BankAnalysisPDF data={pdfData} />).toBlob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const safe_name = (analysis.business_name || "bank-analysis")
                .replace(/[^a-z0-9\-_]+/gi, "_")
                .slice(0, 60);
            const stamp = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `${safe_name}_bank-analysis_${stamp}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast.success("PDF downloaded", { id: toast_id });
        } catch (err: any) {
            console.error("bank analysis PDF export error:", err);
            toast.error("Failed to generate PDF", { id: toast_id });
        } finally {
            set_is_exporting(false);
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="bg-emerald-500/10 p-2 rounded-xl">
                                <BarChart3 className="h-4 w-4 text-emerald-600" />
                            </div>
                            <div>
                                <DialogTitle>Bank Analysis</DialogTitle>
                                <DialogDescription>
                                    {analysis?.business_name || "Saved analysis"}
                                    {analysis?.updated_at && (
                                        <> · Last updated {format(new Date(analysis.updated_at), "MMM d, yyyy")}</>
                                    )}
                                </DialogDescription>
                            </div>
                        </div>
                        {analysis && (
                            <Button
                                size="sm"
                                onClick={export_pdf}
                                disabled={is_exporting}
                                className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm shrink-0"
                            >
                                {is_exporting ? (
                                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Generating</>
                                ) : (
                                    <><Download className="h-3.5 w-3.5 mr-1.5" />Download PDF</>
                                )}
                            </Button>
                        )}
                    </div>
                </DialogHeader>

                {is_loading ? (
                    <div className="py-16 text-center">
                        <Loader2 className="h-6 w-6 text-emerald-500 animate-spin mx-auto" />
                    </div>
                ) : error_message ? (
                    <div className="py-10 text-center">
                        <p className="text-sm font-bold text-red-600">{error_message}</p>
                    </div>
                ) : !analysis ? (
                    <div className="py-10 text-center">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                            No saved bank analysis
                        </p>
                        <p className="text-[11px] font-medium text-slate-400 mt-2">
                            UW hasn't analyzed this client yet. Use the Match Tool to run one.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Deal qualifiers */}
                        <section>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
                                Deal Qualifiers
                            </h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <Stat label="FICO" value={fmt_num(analysis.fico)} />
                                <Stat label="Time in Biz" value={tib_display(analysis.tib_months)} />
                                <Stat label="Capital Req." value={fmt_money(analysis.capital_requested)} />
                                <Stat
                                    label="Bankruptcy"
                                    value={analysis.has_bankruptcy === true ? "Yes" : analysis.has_bankruptcy === false ? "No" : "—"}
                                    tone={analysis.has_bankruptcy ? "warn" : "ok"}
                                />
                                <Stat label="State" value={analysis.company_state || "—"} />
                                <Stat label="Industry" value={analysis.industry || "—"} />
                                <Stat label="Owner" value={analysis.owner_name || "—"} />
                                <Stat label="Open Positions" value={fmt_num(analysis.num_open_positions)} />
                            </div>
                        </section>

                        {/* Cash flow summary */}
                        <section>
                            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
                                Cash Flow Summary
                            </h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <Stat label="Avg Revenue" value={fmt_money(analysis.avg_revenue)} />
                                <Stat label="Avg Daily Bal." value={fmt_money(analysis.avg_daily_balance)} />
                                <Stat label="Avg Mo. Deposits" value={fmt_money(analysis.avg_monthly_deposits)} />
                                <Stat
                                    label="Total Neg Days"
                                    value={fmt_num(analysis.total_neg_days)}
                                    tone={
                                        analysis.total_neg_days != null && analysis.total_neg_days > 5
                                            ? "warn"
                                            : "ok"
                                    }
                                />
                            </div>
                        </section>

                        {/* Footnote: download PDF for full per-month + per-position detail */}
                        <p className="text-[10px] font-medium text-slate-400 italic text-center pt-2 border-t border-slate-100">
                            {accounts.length > 0 && (
                                <>{accounts.length} account{accounts.length === 1 ? "" : "s"}</>
                            )}
                            {accounts.length > 0 && positions.length > 0 && <> · </>}
                            {positions.length > 0 && (
                                <>{positions.length} open position{positions.length === 1 ? "" : "s"}</>
                            )}
                            {(accounts.length > 0 || positions.length > 0) && <> · </>}
                            Download PDF for the full statement breakdown.
                        </p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
    return (
        <div className={clsx(
            "rounded-xl p-3 border",
            tone === "warn" ? "bg-amber-50 border-amber-200" :
            tone === "ok" ? "bg-emerald-50 border-emerald-100" :
            "bg-slate-50 border-slate-200"
        )}>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</p>
            <p className={clsx(
                "text-sm font-black",
                tone === "warn" ? "text-amber-700" :
                tone === "ok" ? "text-emerald-700" :
                "text-slate-900"
            )}>
                {value}
            </p>
        </div>
    );
}
