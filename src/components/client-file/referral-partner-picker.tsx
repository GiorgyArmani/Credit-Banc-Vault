// src/components/client-file/referral-partner-picker.tsx
"use client";

// Referral-partner combobox (DB-backed list, migration 20260718; admins can
// add a partner inline). Moved out of the retired ClientProfileHeader; it now
// lives in the client file's context rail, inside the Team card under a small
// "Referral partner" label.

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { addReferralPartner } from "@/app/admin/referral-partners/actions";

interface ReferralPartnerPickerProps {
    value: string | null;
    is_saving: boolean;
    on_change: (partner: string | null) => void;
}

export function ReferralPartnerPicker({ value, is_saving, on_change }: ReferralPartnerPickerProps) {
    const [open, set_open] = useState(false);
    const [options, set_options] = useState<string[]>([]);
    const [can_manage, set_can_manage] = useState(false);
    const [search, set_search] = useState("");
    const [adding, set_adding] = useState(false);

    // DB-backed list (migration 20260718). Loaded once; falls back to an empty
    // list on failure (the API itself falls back to the static seed).
    useEffect(() => {
        let cancelled = false;
        fetch("/api/referral-partners")
            .then((r) => (r.ok ? r.json() : { partners: [], can_manage: false }))
            .then((data) => {
                if (cancelled) return;
                set_options(Array.isArray(data.partners) ? data.partners : []);
                set_can_manage(!!data.can_manage);
            })
            .catch(() => {
                if (!cancelled) set_options([]);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const handle_select = (name: string) => {
        set_open(false);
        set_search("");
        // Toggle off if re-selecting the current value
        if (name === value) {
            on_change(null);
        } else {
            on_change(name);
        }
    };

    // Admin-only inline create: persist the new partner, add it to the local
    // options, and select it in one go.
    const trimmed_search = search.replace(/\s+/g, " ").trim();
    const exact_match = options.some(
        (o) => o.toLowerCase() === trimmed_search.toLowerCase()
    );
    const can_add = can_manage && trimmed_search.length > 0 && !exact_match;

    const handle_add = async () => {
        if (!trimmed_search) return;
        set_adding(true);
        try {
            const res = await addReferralPartner(trimmed_search);
            if (res.success) {
                const stored = res.name || trimmed_search;
                set_options((prev) =>
                    prev.some((o) => o.toLowerCase() === stored.toLowerCase())
                        ? prev
                        : [...prev, stored].sort((a, b) => a.localeCompare(b))
                );
                handle_select(stored);
            }
        } finally {
            set_adding(false);
        }
    };

    return (
        <div>
            <Popover open={open} onOpenChange={set_open}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        disabled={is_saving}
                        className="flex items-center justify-between gap-2 w-full px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-sm font-semibold text-slate-800 rounded-xl transition-colors disabled:opacity-60"
                    >
                        <span className={clsx("truncate", !value && "text-slate-400 font-medium")}>
                            {value || "Select a referral partner…"}
                        </span>
                        {is_saving ? (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400 flex-shrink-0" />
                        ) : (
                            <ChevronsUpDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
                        )}
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="end">
                    <Command>
                        <CommandInput
                            placeholder={can_manage ? "Search or add a partner…" : "Search partners…"}
                            value={search}
                            onValueChange={set_search}
                        />
                        <CommandList>
                            <CommandEmpty>
                                {can_manage ? "Type a name, then Add." : "No partners found."}
                            </CommandEmpty>
                            {can_add && (
                                <CommandGroup>
                                    <CommandItem
                                        value={`__add__${trimmed_search}`}
                                        onSelect={handle_add}
                                        className="text-emerald-700"
                                    >
                                        {adding ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <Plus className="mr-2 h-4 w-4" />
                                        )}
                                        Add &ldquo;{trimmed_search}&rdquo;
                                    </CommandItem>
                                </CommandGroup>
                            )}
                            <CommandGroup>
                                {value && (
                                    <CommandItem
                                        value="__clear__"
                                        onSelect={() => {
                                            set_open(false);
                                            on_change(null);
                                        }}
                                        className="text-red-600"
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Clear referral partner
                                    </CommandItem>
                                )}
                                {options.map((name) => (
                                    <CommandItem
                                        key={name}
                                        value={name}
                                        onSelect={() => handle_select(name)}
                                    >
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
