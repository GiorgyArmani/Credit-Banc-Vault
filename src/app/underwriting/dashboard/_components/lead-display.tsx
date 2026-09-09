"use client";

/**
 * Presentation atoms shared by the Ready cards and the queue rows.
 *
 * They live together so a card and a row can never disagree about what "3/8
 * approved" means — the doc counter in particular is the number an underwriter
 * decides what to pick up next from.
 */

import clsx from "clsx";
import { Clock } from "lucide-react";
import type { GroupableLead } from "@/lib/lead-groups";

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

/** Compact age. Past a year the exact day stopped mattering. */
export function formatAge(days: number): string {
  if (days <= 0) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/**
 * Approved-of-required, plus an amber count of what is uploaded and waiting.
 *
 * THE POINT. This used to read "8/8 Docs" the moment eight files landed, which
 * is how a file with eight unreviewed documents looked finished. The detail
 * page has always modelled three states (pending / uploaded / approved) and the
 * vault_completed tag has always keyed off approval — this is the surface that
 * disagreed. Both numbers show, so nothing that was visible before is lost.
 */
export function DocCount({
  approved,
  total,
  awaiting,
  className,
}: {
  approved: number;
  total: number;
  awaiting: number;
  className?: string;
}) {
  const complete = total > 0 && approved >= total;

  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span
        className={clsx(
          "text-xs font-bold tabular-nums",
          complete ? "text-on-primary-container" : "text-on-surface-variant"
        )}
      >
        {approved}/{total}
      </span>
      <span className="text-[10px] font-medium text-outline">approved</span>
      {awaiting > 0 && (
        <span
          className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
          title={`${awaiting} document${awaiting === 1 ? "" : "s"} uploaded and awaiting review`}
        >
          {awaiting} to review
        </span>
      )}
    </span>
  );
}

/** Age, amber past two weeks — the point where a file has gone quiet. */
export function AgeCell({ days, className }: { days: number; className?: string }) {
  const stale = days >= 14;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
        stale ? "text-amber-600" : "text-outline",
        className
      )}
      title={stale ? "No movement in two weeks or more" : undefined}
    >
      <Clock className="h-3 w-3" aria-hidden />
      {formatAge(days)}
    </span>
  );
}

/** Sort keys the row header offers. */
export type SortKey = "company" | "ask" | "docs" | "age";
export type SortDir = "asc" | "desc";

export function sortLeads(
  leads: GroupableLead[],
  key: SortKey,
  dir: SortDir
): GroupableLead[] {
  const sign = dir === "asc" ? 1 : -1;
  // Sorting a copy: the caller's array is the memoised bucket, and mutating it
  // would reorder every other tab as a side effect.
  return [...leads].sort((a, b) => {
    switch (key) {
      case "ask":
        return sign * ((a.capital_requested || 0) - (b.capital_requested || 0));
      case "age":
        return sign * (a.age_days - b.age_days);
      case "docs": {
        // Files with no requirements sort as -1 so they never masquerade as
        // 100% complete at the top of a descending sort.
        const pct = (l: GroupableLead) =>
          l.docs_total > 0 ? l.docs_approved / l.docs_total : -1;
        return sign * (pct(a) - pct(b));
      }
      case "company":
      default:
        return sign * a.company_name.localeCompare(b.company_name);
    }
  });
}
