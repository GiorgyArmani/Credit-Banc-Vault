"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Trash2, Users2 } from "lucide-react";
import clsx from "clsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

/**
 * Searchable, optional referral-partner picker used by the client-creation forms
 * (standard + speed). Reads the active list from GET /api/referral-partners (the
 * INTERNAL referral-partner registry, migration 20260718). Select-only — new names
 * are added by admins via /admin/referral-partners or the client-card picker.
 */
export function ReferralPartnerSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (partner: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/referral-partners")
      .then((r) => (r.ok ? r.json() : { partners: [] }))
      .then((data) => {
        if (!cancelled) setOptions(Array.isArray(data.partners) ? data.partners : []);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = (name: string) => {
    setOpen(false);
    onChange(name === value ? null : name);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
          <Users2 className="h-4 w-4 text-emerald-700" />
        </div>
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Referral Partner
          </p>
          <p className="text-xs text-slate-400">Who referred this deal? (optional)</p>
        </div>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-between gap-2 w-full px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-sm font-semibold text-slate-800 rounded-xl transition-colors"
          >
            <span className={clsx("truncate", !value && "text-slate-400 font-medium")}>
              {value || "Select a referral partner…"}
            </span>
            <ChevronsUpDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search partners…" />
            <CommandList>
              <CommandEmpty>No partners found.</CommandEmpty>
              <CommandGroup>
                {value && (
                  <CommandItem
                    value="__clear__"
                    onSelect={() => {
                      setOpen(false);
                      onChange(null);
                    }}
                    className="text-red-600"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear referral partner
                  </CommandItem>
                )}
                {options.map((name) => (
                  <CommandItem key={name} value={name} onSelect={() => handleSelect(name)}>
                    <Check
                      className={clsx(
                        "mr-2 h-4 w-4",
                        value === name ? "opacity-100 text-emerald-600" : "opacity-0"
                      )}
                    />
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
