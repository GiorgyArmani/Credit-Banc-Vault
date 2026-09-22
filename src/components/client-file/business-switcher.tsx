// src/components/client-file/business-switcher.tsx
"use client";

// The company name IS the business picker. Replaces BusinessTabStrip on staff
// client files (the client portal keeps the strip). modal={false}: a Radix
// dropdown that opens a Dialog from a menu item otherwise leaves
// pointer-events:none stuck on <body>.

import { Check, ChevronDown, Plus, Star, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { BusinessTab } from "@/app/advisor/dashboard/clients/[id]/_components/business-tab-strip";

const TITLE = "font-manrope text-2xl font-extrabold tracking-tight text-cb-ink md:text-[1.75rem]";

export function BusinessSwitcher({
  businesses,
  active_business_id,
  fallback_name,
  on_select,
  on_add,
  on_delete,
}: {
  businesses: BusinessTab[];
  active_business_id: string | null;
  fallback_name: string;
  on_select: (id: string) => void;
  on_add?: () => void;
  on_delete?: (b: BusinessTab) => void;
}) {
  const active = businesses.find((b) => b.id === active_business_id);
  const name = active?.company_name || fallback_name || "Untitled business";

  if (businesses.length <= 1 && !on_add) {
    return <h1 className={cn(TITLE, "truncate")}>{name}</h1>;
  }

  return (
    <>
      <h1 className="sr-only">{name}</h1>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group -ml-1.5 inline-flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-xl px-1.5 py-0.5 text-left hover:bg-black/[0.03]"
          >
            <span className={cn(TITLE, "min-w-0 truncate")}>{name}</span>
            <ChevronDown className="h-5 w-5 shrink-0 text-cb-ink/40 transition group-hover:text-cb-ink" />
            {businesses.length > 1 && (
              <span className="hidden shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-cb-ink/60 sm:inline-flex">
                {businesses.length} businesses
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-xs font-medium text-cb-ink/50">Businesses on this file</DropdownMenuLabel>
          {businesses.map((b) => (
            <DropdownMenuItem key={b.id} onSelect={() => on_select(b.id)} className="group/item gap-2">
              <Check className={cn("h-4 w-4 shrink-0", b.id === active_business_id ? "text-emerald-600" : "opacity-0")} />
              <span className="min-w-0 flex-1 truncate">{b.company_name || "Untitled business"}</span>
              {b.is_primary && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Primary" />}
            </DropdownMenuItem>
          ))}
          {on_delete && businesses.some((b) => !b.is_primary) && (
            <>
              <DropdownMenuSeparator />
              {businesses
                .filter((b) => !b.is_primary)
                .map((b) => (
                  <DropdownMenuItem
                    key={`delete-${b.id}`}
                    onSelect={() => on_delete(b)}
                    className="gap-2 text-rose-600 focus:text-rose-700"
                  >
                    <Trash2 className="h-4 w-4" /> Remove {b.company_name || "Untitled business"}
                  </DropdownMenuItem>
                ))}
            </>
          )}
          {on_add && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={on_add} className="gap-2 font-semibold text-emerald-700">
                <Plus className="h-4 w-4" /> Add business
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
