"use client";

// UW manual lender add — lets underwriting attach a lender to a deal straight
// from the lender database, mirroring the admin picker but posting to the
// staff-open /api/lender-assignments/manual route. Already-assigned lenders are
// filtered out so the same one can't be added twice.
//
// Most submissions are added here rather than through Lender Match, so the
// picker runs the SAME guideline check (lib/lender-matching) against this
// business's deal and shows each lender's record with us. A lender whose
// guidelines rule the deal out asks for a second click, with the reasons shown.
// UW still decides — this informs, it never blocks.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { Plus, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import {
  MATCH_CLIENT_SELECT,
  loadBusinessDeal,
  matchLender,
  type ClientOption,
  type Lender,
} from "@/lib/lender-matching";
import type { DealSummary } from "@/components/bank-analysis";

interface Props {
  clientId: string;
  businessProfileId: string | null;
  /** Lender names already on the deal — excluded from the picker. */
  assignedLenderNames: string[];
  /** Called after a successful add so the host can refetch assignments. */
  onAdded: () => void;
  className?: string;
}

/** How a lender has done with us, across every file. */
interface TrackRecord {
  sent: number;
  approved: number;
}

type Fit = { kind: "fits" } | { kind: "issues"; flags: string[] } | { kind: "unknown" };

/** A guideline row with no threshold at all can't say anything about fit. */
function hasAnyGuideline(l: Lender): boolean {
  return (
    (l.min_fico ?? 0) > 0 ||
    (l.avg_monthly_revenue ?? 0) > 0 ||
    (l.time_in_business_months ?? 0) > 0 ||
    (Number(l.max_funding) || 0) > 0 ||
    (Number(l.min_funding) || 0) > 0 ||
    !!l.restricted_states ||
    !!l.restricted_industries
  );
}

export function UwAddLenderButton({
  clientId,
  businessProfileId,
  assignedLenderNames,
  onAdded,
  className,
}: Props) {
  const supabase = createClient();
  const [open, set_open] = useState(false);
  const [options, set_options] = useState<Lender[]>([]);
  const [deal, set_deal] = useState<DealSummary | null>(null);
  const [records, set_records] = useState<Map<string, TrackRecord>>(new Map());
  const [loading, set_loading] = useState(false);
  const [adding, set_adding] = useState(false);
  const [confirming, set_confirming] = useState<{ lender: Lender; flags: string[] } | null>(null);

  // Loaded once per client + business: fit is per business, so switching the
  // business tab reloads.
  const load_key = `${clientId}:${businessProfileId ?? ""}`;
  const [loaded_key, set_loaded_key] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded_key === load_key) return;
    let cancelled = false;
    set_deal(null);
    (async () => {
      set_loading(true);
      const [{ data: lenders }, { data: client }, { data: history }] = await Promise.all([
        supabase.from("lender_guidelines").select("*").order("lender_name", { ascending: true }),
        supabase.from("client_data_vault").select(MATCH_CLIENT_SELECT).eq("id", clientId).maybeSingle(),
        supabase.from("client_lender_assignments").select("lender_name, status"),
      ]);
      if (cancelled) return;
      if (lenders) set_options(lenders as Lender[]);

      const rec = new Map<string, TrackRecord>();
      for (const r of (history ?? []) as { lender_name: string; status: string }[]) {
        if (r.status === "pending") continue; // never sent
        const key = r.lender_name.toLowerCase();
        const t = rec.get(key) ?? { sent: 0, approved: 0 };
        t.sent += 1;
        if (r.status === "approved_by_lender" || r.status === "funded") t.approved += 1;
        rec.set(key, t);
      }
      set_records(rec);

      // Fit is best-effort: without a deal every lender reads "no check".
      if (client) {
        try {
          const loaded = await loadBusinessDeal(supabase, client as unknown as ClientOption, businessProfileId);
          if (!cancelled) set_deal(loaded.deal);
        } catch (err) {
          console.warn("uw add lender: deal load failed (non-fatal):", err);
        }
      }
      if (!cancelled) {
        set_loaded_key(load_key);
        set_loading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // supabase is a browser singleton; load_key carries clientId + business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, load_key, loaded_key]);

  const assigned = useMemo(
    () => new Set(assignedLenderNames.map((n) => n.toLowerCase())),
    [assignedLenderNames]
  );

  // Lenders the deal fits come first; the rest keep alphabetical order.
  const available = useMemo(() => {
    const rows = options
      .filter((o) => !assigned.has(o.lender_name.toLowerCase()))
      .map((lender) => {
        let fit: Fit = { kind: "unknown" };
        if (deal && hasAnyGuideline(lender)) {
          const r = matchLender(lender, deal);
          fit = r.passed ? { kind: "fits" } : { kind: "issues", flags: r.flags };
        }
        return { lender, fit, record: records.get(lender.lender_name.toLowerCase()) };
      });
    const rank = (f: Fit) => (f.kind === "fits" ? 0 : f.kind === "unknown" ? 1 : 2);
    return rows.sort((a, b) => rank(a.fit) - rank(b.fit));
  }, [options, assigned, deal, records]);

  async function add(lender: Lender) {
    set_adding(true);
    set_confirming(null);
    try {
      const res = await fetch("/api/lender-assignments/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          lender_guideline_id: lender.id,
          business_profile_id: businessProfileId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data?.error || "Failed to add lender");
        return;
      }
      toast.success(`Added ${lender.lender_name} — ready to submit`);
      // Picker stays OPEN. A file usually goes to several lenders, and closing
      // after each pick made adding three of them three trips through the
      // popover. onAdded refetches, which drops the one just added from the
      // list via assignedLenderNames.
      onAdded();
    } catch (err) {
      console.error("uw add lender error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      set_adding(false);
    }
  }

  function pick(lender: Lender, fit: Fit) {
    if (fit.kind === "issues") {
      set_confirming({ lender, flags: fit.flags });
      return;
    }
    add(lender);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        set_open(o);
        if (!o) set_confirming(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={adding}
          className={
            className ??
            "h-8 rounded-xl text-[9px] font-black uppercase tracking-widest border-slate-200 hover:bg-slate-50"
          }
        >
          {adding ? (
            <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
          ) : (
            <Plus className="h-3 w-3 mr-1.5" />
          )}
          Add Lender
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0 rounded-2xl">
        {confirming && (
          <div className="border-b border-rose-200 bg-rose-50 p-3">
            <p className="text-xs font-semibold text-rose-800">
              This deal is outside {confirming.lender.lender_name}&apos;s guidelines:
            </p>
            <ul className="mt-1 list-disc pl-4 text-[11px] text-rose-700">
              {confirming.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] border-rose-300 text-rose-800 hover:bg-rose-100"
                disabled={adding}
                onClick={() => add(confirming.lender)}
              >
                Add anyway
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => set_confirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <Command>
          <CommandInput placeholder="Search lenders..." className="h-10 text-sm" />
          <CommandList className="max-h-80">
            {loading ? (
              <div className="py-6 text-center">
                <Loader2 className="h-4 w-4 text-emerald-500 animate-spin mx-auto" />
              </div>
            ) : (
              <>
                <CommandEmpty>
                  <p className="text-xs text-slate-500 py-4">
                    {options.length === 0
                      ? "No lenders in database."
                      : "No matching lender available."}
                  </p>
                </CommandEmpty>
                <CommandGroup heading={deal ? "Lender Database · checked against this deal" : "Lender Database"}>
                  {available.map(({ lender, fit, record }) => {
                    // A lender that has never approved anything after several
                    // sends is worth a second look before sending another file.
                    const coldRecord = !!record && record.sent >= 4 && record.approved === 0;
                    return (
                      <CommandItem
                        key={lender.id}
                        value={`${lender.lender_name} ${lender.specialty ?? ""} ${lender.tier_label ?? ""} ${lender.id}`}
                        onSelect={() => pick(lender, fit)}
                        disabled={adding}
                        className="cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-800 truncate">{lender.lender_name}</p>
                            {fit.kind === "fits" && (
                              <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                Fits
                              </span>
                            )}
                            {fit.kind === "issues" && (
                              <span className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                                {fit.flags.length} {fit.flags.length === 1 ? "issue" : "issues"}
                              </span>
                            )}
                          </div>
                          {(lender.specialty || lender.payment_type || lender.tier_label) && (
                            <p className="text-[11px] text-slate-400 truncate">
                              {[lender.specialty, lender.tier_label, lender.payment_type].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          {fit.kind === "issues" && (
                            <p className="text-[11px] text-rose-600 truncate">{fit.flags[0]}</p>
                          )}
                          {record && record.sent > 0 && (
                            <p className={`text-[11px] ${coldRecord ? "text-amber-700" : "text-slate-500"}`}>
                              {record.approved} of {record.sent} approved with us
                            </p>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
