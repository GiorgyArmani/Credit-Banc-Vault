// src/components/client-file/fact-list.tsx
import type React from "react";

export type Fact = { label: string; value: React.ReactNode };

/** Label/value rows: the CRM replacement for a padded card per fact. */
export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="divide-y divide-black/5">
      {facts.map((fact) => {
        const empty = fact.value === null || fact.value === undefined || fact.value === "";
        return (
          <div key={fact.label} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="shrink-0 text-xs text-cb-ink/50">{fact.label}</dt>
            <dd
              className="min-w-0 truncate text-right text-sm font-medium text-cb-ink"
              title={typeof fact.value === "string" ? fact.value : undefined}
            >
              {empty ? <span className="text-cb-ink/30">—</span> : fact.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
