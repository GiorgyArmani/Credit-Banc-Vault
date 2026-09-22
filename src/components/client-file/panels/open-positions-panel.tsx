// src/components/client-file/panels/open-positions-panel.tsx
//
// Open positions (previous debt): one row per position already funded against
// this business.
//
// Lifted out of the underwriting client page's "Open Positions (Previous Debt)"
// section so the same table can be mounted on the admin client file in phase 3.
// Purely presentational — it takes the rows and nothing else, so it never reads
// `pathname`, `router` or page state. The card title and the count badge belong
// to the caller (`PanelCard` / `CollapsibleSection`); this renders the body.
//
// Restyled to the phase-1 language: sentence-case headers, cb-* tokens, and a
// single muted line for the empty state instead of the centred icon block.

"use client";

import { EmptyLine } from "@/components/client-file/empty-line";

export interface OpenPosition {
    id: string;
    lender_name: string;
    loan_type: string;
    current_balance: number | null;
    payment_amount: number | null;
    payment_term: string | null;
}

const CELL = "border-b border-black/5 px-5 py-3";
const HEAD = "border-b border-black/5 px-5 py-2.5 text-xs font-semibold text-cb-ink/50";

function usd(amount: number | null): string {
    return amount
        ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
        : "—";
}

/** OpenPositionsPanel: the previous debt stack on this file. */
export function OpenPositionsPanel({ positions }: { positions: OpenPosition[] }) {
    if (positions.length === 0) {
        return (
            <div className="px-5">
                <EmptyLine>No open positions reported</EmptyLine>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
                <thead>
                    <tr className="bg-cb-cream/40">
                        <th className={HEAD}>Lender</th>
                        <th className={HEAD}>Type</th>
                        <th className={HEAD}>Balance</th>
                        <th className={HEAD}>Payment</th>
                        <th className={HEAD}>Term</th>
                    </tr>
                </thead>
                <tbody>
                    {positions.map((pos) => (
                        <tr key={pos.id} className="transition-colors hover:bg-black/[0.02]">
                            <td className={CELL}>
                                <p className="text-sm font-semibold text-cb-ink">{pos.lender_name}</p>
                            </td>
                            <td className={CELL}>
                                <span className="inline-flex whitespace-nowrap rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-cb-ink/70">
                                    {pos.loan_type}
                                </span>
                            </td>
                            <td className={`${CELL} text-sm font-medium tabular-nums text-cb-ink`}>
                                {usd(pos.current_balance)}
                            </td>
                            <td className={`${CELL} text-sm font-medium tabular-nums text-emerald-700`}>
                                {usd(pos.payment_amount)}
                            </td>
                            <td className={`${CELL} text-sm text-cb-ink/60`}>
                                {pos.payment_term || "—"}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
