"use client";

// src/components/funding/funding-rounds-card.tsx
//
// The repeat-financing surface. Lists every funding round this business has
// had — each with the lender, amount, term and date it closed on — and opens
// the next one.
//
// This card is the answer to "do we lose the past funding story?". Before
// rounds existed, a second financing UPDATEd the single funding_deals row and
// the first deal's outcome was gone; the only trace was a free-text internal
// note. Each round is now its own row, and this is where they're read back.

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, Loader2, PlusCircle, RefreshCw, Trophy } from "lucide-react";
import { toast } from "@/lib/toast";
import { FUNDING_OPTIONS } from "@/data/loan-types";
import clsx from "clsx";
import {
  LENDER_STATUS_LABEL,
  groupByRound,
  noteSnippet,
  type LenderAssignmentRow,
  type LenderStatus,
} from "@/lib/lender-history";

interface Deal {
  id: string;
  display_order: number | null;
  created_at: string;
  capital_requested: number | null;
  proposed_loan_type: string | null;
  lender_funded: string | null;
  funded_amount: number | null;
  funded_term: string | null;
  funded_at: string | null;
}

interface Props {
  clientId: string;
  businessProfileId: string | null;
  /** Staff only. Clients never see the rounds card. */
  canStartRound?: boolean;
  /** Called after a round is opened so the host page can refetch documents. */
  onRoundStarted?: () => void;
}

function money(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Verdict → pill colour. Declines are amber, not red: a decline is ordinary. */
const LENDER_PILL: Record<LenderStatus, string> = {
  pending: "bg-slate-100 text-slate-500",
  submitted: "bg-sky-100 text-sky-700",
  approved_by_lender: "bg-emerald-100 text-emerald-700",
  declined_by_lender: "bg-amber-100 text-amber-800",
  funded: "bg-emerald-600 text-white",
};

/** Whole days between two instants, or null when either end is missing. */
function days_between(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from) return null;
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function short_date(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function FundingRoundsCard({
  clientId,
  businessProfileId,
  canStartRound = false,
  onRoundStarted,
}: Props) {
  const [deals, set_deals] = useState<Deal[]>([]);
  // Every lender this business was shopped to, across all rounds. Grouped
  // client-side so the round number stays derived from one ordered list.
  const [lenders, set_lenders] = useState<LenderAssignmentRow[]>([]);
  const [expanded_round, set_expanded_round] = useState<string | null>(null);
  const [loading, set_loading] = useState(false);
  const [open, set_open] = useState(false);
  const [starting, set_starting] = useState(false);
  const [amount, set_amount] = useState("");
  // Same shape as the client / add-business pickers: multi-select from the
  // canonical product list, stored as a comma-joined string on the deal.
  const [loan_types, set_loan_types] = useState<string[]>([]);

  function toggle_loan_type(type: string) {
    set_loan_types((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  const load = useCallback(async () => {
    if (!businessProfileId) {
      set_deals([]);
      return;
    }
    set_loading(true);
    try {
      const res = await fetch(
        `/api/advisor/clients/${clientId}/businesses/${businessProfileId}/deals`
      );
      const data = await res.json();
      if (res.ok && data.success) {
        set_deals((data.deals ?? []) as Deal[]);
        set_lenders((data.lenders ?? []) as LenderAssignmentRow[]);
      }
    } catch (err) {
      console.error("load funding rounds error:", err);
    } finally {
      set_loading(false);
    }
  }, [clientId, businessProfileId]);

  useEffect(() => {
    load();
  }, [load]);

  // deals arrive newest-first, so the first entry is the round being worked.
  const current = deals[0] ?? null;
  const current_is_funded = !!current?.funded_at;
  const has_history = deals.length > 1 || current_is_funded;

  // The card used to hide on a first-time file with an open round, because a
  // single "Round 1 · in progress" line said nothing the page didn't already.
  // It now also carries the lender track, so it earns its place as soon as
  // there is a lender on the file — which is exactly when underwriting starts
  // reaching for the spreadsheet.
  const has_lenders = lenders.length > 0;
  // Round id → its lenders. groupByRound owns the legacy-NULL rule so the card
  // and the match tool cannot disagree about which round an old row belongs to.
  const lender_groups = new Map(
    groupByRound(lenders, deals).map((g) => [g.deal_id, g.rows])
  );
  if (!businessProfileId || (!has_history && !has_lenders && !loading)) return null;

  async function start_round() {
    if (!businessProfileId) return;
    set_starting(true);
    try {
      const res = await fetch(
        `/api/advisor/clients/${clientId}/businesses/${businessProfileId}/deals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            capital_requested: amount.trim() || null,
            proposed_loan_type: loan_types.length > 0 ? loan_types.join(", ") : null,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data?.error || "Failed to start the funding round");
        return;
      }
      toast.success(
        `New round opened · ${data.requested_documents} document${data.requested_documents === 1 ? "" : "s"} re-requested`
      );
      set_open(false);
      set_amount("");
      set_loan_types([]);
      await load();
      onRoundStarted?.();
    } catch (err) {
      console.error("start funding round error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      set_starting(false);
    }
  }

  return (
    <>
      <div className="border border-slate-100 rounded-[2rem] bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-emerald-500" />
            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-500">
              Funding Rounds
            </h3>
          </div>
          {canStartRound && current_is_funded && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                set_amount("");
                // Pre-tick the previous round's products — a renewal is usually
                // the same shape of money. The list is comma-joined on the deal;
                // only values still in the canonical list are re-selected.
                const previous = (current?.proposed_loan_type ?? "")
                  .split(",")
                  .map((t) => t.trim())
                  .filter((t) => FUNDING_OPTIONS.includes(t));
                set_loan_types(previous);
                set_open(true);
              }}
              className="h-8 rounded-lg text-[9px] font-black uppercase tracking-widest border-emerald-200 text-emerald-700 hover:bg-emerald-50"
            >
              <PlusCircle className="w-3.5 h-3.5 mr-1.5" />
              New Round
            </Button>
          )}
        </div>

        {loading && deals.length === 0 ? (
          <div className="py-8 text-center">
            <Loader2 className="h-4 w-4 text-emerald-500 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {deals.map((d, idx) => {
              // deals are newest-first; round 1 is the last element.
              const round_no = deals.length - idx;
              const funded = !!d.funded_at;
              const round_lenders = lender_groups.get(d.id) ?? [];
              const is_open = expanded_round === d.id;
              const declined_count = round_lenders.filter(
                (l) => l.status === "declined_by_lender"
              ).length;
              return (
                <div key={d.id}>
                <div className="px-5 py-3.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-800">Round {round_no}</span>
                      <span
                        className={clsx(
                          "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full",
                          funded
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        )}
                      >
                        {funded ? "Funded" : "In progress"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 truncate">
                      {funded ? (
                        <>
                          {d.lender_funded || "Lender not recorded"}
                          {d.funded_term ? ` · ${d.funded_term}` : ""} · {short_date(d.funded_at)}
                        </>
                      ) : (
                        <>
                          Asking {money(d.capital_requested)}
                          {d.proposed_loan_type ? ` · ${d.proposed_loan_type}` : ""} · opened{" "}
                          {short_date(d.created_at)}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={clsx(
                        "text-sm font-black",
                        funded ? "text-emerald-600" : "text-slate-300"
                      )}
                    >
                      {funded ? money(d.funded_amount) : money(d.capital_requested)}
                    </p>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-300">
                      {funded ? "Funded" : "Requested"}
                    </p>
                  </div>
                </div>

                {/* The lender track for this round. Collapsed by default: on a
                    file with four rounds the expanded lists would bury the
                    round summaries that make the card scannable. */}
                {round_lenders.length > 0 && (
                  <div className="px-5 pb-3.5 -mt-1">
                    <button
                      type="button"
                      onClick={() => set_expanded_round(is_open ? null : d.id)}
                      aria-expanded={is_open}
                      className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-emerald-700 transition-colors"
                    >
                      <ChevronDown
                        className={clsx(
                          "w-3 h-3 transition-transform",
                          is_open && "rotate-180"
                        )}
                      />
                      {round_lenders.length} lender{round_lenders.length === 1 ? "" : "s"}
                      {declined_count > 0 ? ` · ${declined_count} declined` : ""}
                    </button>

                    {is_open && (
                      <ul className="mt-2 space-y-1.5">
                        {round_lenders.map((l) => {
                          const status = l.status as LenderStatus;
                          // Awaiting: how long it has been out. Answered: how
                          // long it took. Both are what the spreadsheet's date
                          // columns were actually for.
                          const waiting =
                            status === "submitted" ? days_between(l.submitted_at, null) : null;
                          const turnaround =
                            l.responded_at ? days_between(l.submitted_at, l.responded_at) : null;
                          const note = noteSnippet(l.response_notes, 160);
                          return (
                            <li
                              key={l.id}
                              className={clsx(
                                "rounded-lg border px-3 py-2",
                                l.admin_review === "rejected"
                                  ? "border-slate-200 bg-slate-50 opacity-60"
                                  : "border-slate-100 bg-white"
                              )}
                            >
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="text-[12px] font-bold text-slate-800">
                                  {l.lender_name}
                                  {l.specialty ? (
                                    <span className="font-medium text-slate-400">
                                      {" · "}
                                      {l.specialty}
                                    </span>
                                  ) : null}
                                </span>
                                <span
                                  className={clsx(
                                    "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full",
                                    LENDER_PILL[status] ?? "bg-slate-100 text-slate-500"
                                  )}
                                >
                                  {l.admin_review === "rejected"
                                    ? "Removed"
                                    : LENDER_STATUS_LABEL[status] ?? status}
                                </span>
                              </div>
                              {note && (
                                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                                  {note}
                                </p>
                              )}
                              <p className="mt-1 text-[10px] text-slate-400">
                                {l.submitted_at
                                  ? `Sent ${short_date(l.submitted_at)}`
                                  : `Added ${short_date(l.assigned_at ?? null)}`}
                                {waiting !== null ? ` · ${waiting}d waiting` : ""}
                                {turnaround !== null
                                  ? ` · answered in ${turnaround}d`
                                  : l.responded_at
                                    ? ` · answered ${short_date(l.responded_at)}`
                                    : ""}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!starting) set_open(o); }}>
        {/* Wider than the default so the 18 product chips wrap to a few rows
            instead of a tall column; capped + scrollable on short screens. */}
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Start a new funding round</DialogTitle>
            <DialogDescription>
              Opens a fresh deal for this business. The previous round keeps its funded
              amount, lender and date — nothing is overwritten. Bank statements, P&amp;L and
              the other time-sensitive documents are re-requested from the client;
              identity and entity paperwork carries over.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="round-amount">Amount requested</Label>
              <Input
                id="round-amount"
                value={amount}
                onChange={(e) => set_amount(e.target.value)}
                placeholder="e.g. 250000"
                inputMode="numeric"
              />
            </div>
            <div className="grid gap-2">
              <Label>Product type</Label>
              <div className="flex flex-wrap gap-1.5">
                {FUNDING_OPTIONS.map((type) => {
                  const selected = loan_types.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggle_loan_type(type)}
                      className={clsx(
                        "px-3 py-1.5 rounded-full text-[11px] font-bold border transition-colors",
                        selected
                          ? "bg-emerald-500 text-white border-emerald-500"
                          : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-700"
                      )}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
              {loan_types.length > 0 && (
                <p className="text-[11px] font-bold text-emerald-600">
                  Selected: {loan_types.join(" · ")}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => set_open(false)} disabled={starting}>
              Cancel
            </Button>
            <Button
              onClick={start_round}
              disabled={starting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {starting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Opening…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Open round
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
