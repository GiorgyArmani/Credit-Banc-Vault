// src/components/client-file/file-tabs.tsx
"use client";

import type React from "react";
import { cn } from "@/lib/utils";
import type { ClientFileTab } from "./capabilities";

export type FileTabItem = {
  id: ClientFileTab;
  label: string;
  badge?: string | number | null;
  content: React.ReactNode;
};

export function FileTabs({
  items,
  active,
  on_change,
}: {
  items: FileTabItem[];
  active: ClientFileTab;
  on_change: (tab: ClientFileTab) => void;
}) {
  const current = items.find((item) => item.id === active) ?? items[0];
  if (!current) return null;

  function focus_tab(id: ClientFileTab) {
    document.getElementById(`file-tab-${id}`)?.focus();
  }

  function handle_tablist_keydown(event: React.KeyboardEvent<HTMLDivElement>) {
    const current_index = items.findIndex((item) => item.id === current.id);
    if (current_index === -1) return;
    let next_index: number | null = null;
    switch (event.key) {
      case "ArrowRight":
        next_index = (current_index + 1) % items.length;
        break;
      case "ArrowLeft":
        next_index = (current_index - 1 + items.length) % items.length;
        break;
      case "Home":
        next_index = 0;
        break;
      case "End":
        next_index = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next_item = items[next_index];
    on_change(next_item.id);
    focus_tab(next_item.id);
  }

  // The strip's bottom rule is an inset shadow, not a border: overflow clips
  // at the padding box, so a border-b rule plus -mb-px tabs either scrolls
  // vertically (overflow-y auto) or clips the underline off the rule (hidden).
  // Drawn inside the padding box, the rule sits under the tabs' own 2px
  // border-b, which covers it exactly with no gap and nothing overflowing.
  return (
    <div className="min-w-0">
      <div
        role="tablist"
        aria-label="Client file sections"
        onKeyDown={handle_tablist_keydown}
        className="-mx-1 flex gap-1 overflow-x-auto overflow-y-hidden px-1 shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const selected = item.id === current.id;
          const show_badge = item.badge !== null && item.badge !== undefined && item.badge !== "";
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`file-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`file-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => on_change(item.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                selected ? "border-cb-ink text-cb-ink" : "border-transparent text-cb-ink/50 hover:text-cb-ink",
              )}
            >
              {item.label}
              {show_badge && (
                <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-cb-ink/60">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`file-panel-${current.id}`}
        aria-labelledby={`file-tab-${current.id}`}
        className="space-y-4 pt-5"
      >
        {current.content}
      </div>
    </div>
  );
}
