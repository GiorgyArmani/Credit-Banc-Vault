"use client";

// UW manual lender add — lets underwriting attach a lender to a deal straight
// from the lender database, mirroring the admin picker but posting to the
// staff-open /api/lender-assignments/manual route. Already-assigned lenders are
// filtered out so the same one can't be added twice.

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

interface LenderOption {
  id: string;
  lender_name: string;
  specialty: string | null;
  payment_type: string | null;
}

interface Props {
  clientId: string;
  businessProfileId: string | null;
  /** Lender names already on the deal — excluded from the picker. */
  assignedLenderNames: string[];
  /** Called after a successful add so the host can refetch assignments. */
  onAdded: () => void;
  className?: string;
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
  const [options, set_options] = useState<LenderOption[]>([]);
  const [loading, set_loading] = useState(false);
  const [adding, set_adding] = useState(false);

  useEffect(() => {
    if (!open || options.length > 0) return;
    let cancelled = false;
    (async () => {
      set_loading(true);
      const { data } = await supabase
        .from("lender_guidelines")
        .select("id, lender_name, specialty, payment_type")
        .order("lender_name", { ascending: true });
      if (!cancelled && data) set_options(data as LenderOption[]);
      if (!cancelled) set_loading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, options.length, supabase]);

  const assigned = useMemo(
    () => new Set(assignedLenderNames.map((n) => n.toLowerCase())),
    [assignedLenderNames]
  );
  const available = useMemo(
    () => options.filter((o) => !assigned.has(o.lender_name.toLowerCase())),
    [options, assigned]
  );

  async function add(lender: LenderOption) {
    set_adding(true);
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
      toast.success(`Added ${lender.lender_name}`);
      set_open(false);
      onAdded();
    } catch (err) {
      console.error("uw add lender error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      set_adding(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={set_open}>
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
      <PopoverContent align="end" className="w-80 p-0 rounded-2xl">
        <Command>
          <CommandInput placeholder="Search lenders..." className="h-10 text-sm" />
          <CommandList className="max-h-72">
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
                <CommandGroup heading="Lender Database">
                  {available.map((lender) => (
                    <CommandItem
                      key={lender.id}
                      value={lender.lender_name}
                      onSelect={() => add(lender)}
                      disabled={adding}
                      className="cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {lender.lender_name}
                        </p>
                        {(lender.specialty || lender.payment_type) && (
                          <p className="text-[11px] text-slate-400 truncate">
                            {[lender.specialty, lender.payment_type].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
