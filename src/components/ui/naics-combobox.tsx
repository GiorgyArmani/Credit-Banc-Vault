"use client";

import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  NAICS_INDUSTRIES,
  resolveNaics,
  type NaicsIndustry,
} from "@/data/naics";

interface NaicsComboboxProps {
  /** Stored value — canonical NAICS title (also accepts a 6-digit code or legacy free text). */
  value: string;
  /** Fires with the canonical title to store, plus the resolved entry. Empty string on clear. */
  onChange: (value: string, entry?: NaicsIndustry) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  id?: string;
  className?: string;
  /** Trigger classes, so the picker can blend into each host form. */
  triggerClassName?: string;
}

// Rendering all 1,012 rows at once is wasteful; cap what we paint per query.
const MAX_RESULTS = 60;

function scoreEntry(n: NaicsIndustry, tokens: string[]): number {
  const title = n.title.toLowerCase();
  const hay = `${title} ${n.sectorTitle.toLowerCase()} ${n.code}`;
  let score = 0;
  for (const t of tokens) {
    if (!hay.includes(t)) return -1; // every token must appear somewhere
    if (title.startsWith(t)) score += 3;
    else if (title.includes(t)) score += 2;
    else score += 1;
  }
  return score;
}

export function NaicsCombobox({
  value,
  onChange,
  placeholder = "Select industry…",
  disabled,
  allowClear = true,
  id,
  className,
  triggerClassName,
}: NaicsComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const resolved = resolveNaics(value);
  // Legacy free-text that doesn't map to a NAICS entry still shows its raw text.
  const label = resolved?.title ?? (value?.trim() || "");

  const results = React.useMemo(() => {
    const tokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return NAICS_INDUSTRIES.slice(0, MAX_RESULTS);
    const scored: { n: NaicsIndustry; s: number }[] = [];
    for (const n of NAICS_INDUSTRIES) {
      const s = scoreEntry(n, tokens);
      if (s >= 0) scored.push({ n, s });
    }
    scored.sort((a, b) => b.s - a.s || a.n.title.localeCompare(b.n.title));
    return scored.slice(0, MAX_RESULTS).map((x) => x.n);
  }, [query]);

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 transition-colors focus:outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-50",
              triggerClassName
            )}
          >
            <span className={cn("truncate", !label && "text-slate-400")}>
              {label || placeholder}
            </span>
            <span className="flex items-center gap-1 flex-shrink-0">
              {allowClear && label && !disabled && (
                <X
                  role="button"
                  aria-label="Clear industry"
                  className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onChange("");
                  }}
                />
              )}
              <ChevronsUpDown className="h-4 w-4 text-slate-400" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]"
          align="start"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search NAICS industry or code…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No matching industry.</CommandEmpty>
              {results.map((n) => (
                <CommandItem
                  key={n.code}
                  value={n.code}
                  onSelect={() => {
                    onChange(n.title, n);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex items-start gap-2"
                >
                  <Check
                    className={cn(
                      "mt-0.5 h-4 w-4 flex-shrink-0",
                      resolved?.code === n.code ? "opacity-100 text-emerald-600" : "opacity-0"
                    )}
                  />
                  <span className="flex flex-col min-w-0">
                    <span className="truncate">{n.title}</span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {n.code} · {n.sectorTitle}
                    </span>
                  </span>
                </CommandItem>
              ))}
              {results.length === MAX_RESULTS && (
                <div className="px-3 py-2 text-[10px] font-mono text-slate-400">
                  Showing first {MAX_RESULTS} — keep typing to narrow.
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
