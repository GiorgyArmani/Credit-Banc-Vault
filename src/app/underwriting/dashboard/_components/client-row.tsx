"use client";

/**
 * The queue row, and its sortable header.
 *
 * Vaults / Funded / Declined are lookup surfaces, not work surfaces — Declined
 * alone holds 129 files. As 450px cards that is roughly forty screens showing
 * three records each; as rows it is a list you can actually scan.
 *
 * A real <table> rather than a grid of divs: the header cells are the sort
 * controls, and screen readers announce the column a value belongs to for free.
 * Under `md` the whole thing switches to stacked blocks, because seven columns
 * on a phone is a horizontal scrollbar nobody uses.
 */

import clsx from "clsx";
import { ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { LoanPipelineBadge } from "@/components/loan-pipeline-status";
import { DocCount, AgeCell, formatCurrency, type SortKey, type SortDir } from "./lead-display";
import { GroupPicker } from "./group-picker";
import type { GroupableLead, MembershipMode } from "@/lib/lead-groups";
import type { GroupWithMembers } from "./group-chip-rail";

const COLUMNS: { key: SortKey | null; label: string; className: string }[] = [
  { key: "company", label: "Business", className: "text-left" },
  { key: null, label: "Advisor", className: "text-left hidden lg:table-cell" },
  { key: "ask", label: "Ask", className: "text-right" },
  { key: "docs", label: "Documents", className: "text-left hidden md:table-cell" },
  { key: null, label: "Stage", className: "text-left hidden xl:table-cell" },
  { key: "age", label: "Age", className: "text-right" },
];

export function LeadTable({
  leads,
  hrefFor,
  onOpen,
  sortKey,
  sortDir,
  onSort,
  groups,
  currentUserId,
  onMembershipChange,
}: {
  leads: GroupableLead[];
  hrefFor: (lead: GroupableLead) => string;
  onOpen: (href: string) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  groups: GroupWithMembers[];
  currentUserId: string | null;
  onMembershipChange: (groupId: string, clientVaultId: string, mode: MembershipMode | null) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-outline-variant/30 bg-white shadow-[0_1px_2px_rgba(0,3,33,0.04)]">
      {/* Wide content scrolls inside its own container so the page body never
          scrolls sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-full border-collapse">
          <thead className="hidden md:table-header-group">
            <tr className="border-b border-outline-variant/30 bg-surface-bright">
              {COLUMNS.map(col => (
                <th
                  key={col.label}
                  scope="col"
                  className={clsx(
                    "px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-outline",
                    col.className
                  )}
                  aria-sort={
                    col.key && sortKey === col.key
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {col.key ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key as SortKey)}
                      className={clsx(
                        "inline-flex items-center gap-1 transition-colors hover:text-on-surface",
                        sortKey === col.key && "text-on-secondary-fixed"
                      )}
                    >
                      {col.label}
                      {sortKey === col.key &&
                        (sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        ))}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
              <th scope="col" className="w-20 px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-outline-variant/20">
            {leads.map(lead => (
              <LeadRow
                key={lead.id}
                lead={lead}
                href={hrefFor(lead)}
                onOpen={onOpen}
                groups={groups}
                currentUserId={currentUserId}
                onMembershipChange={onMembershipChange}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadRow({
  lead,
  href,
  onOpen,
  groups,
  currentUserId,
  onMembershipChange,
}: {
  lead: GroupableLead;
  href: string;
  onOpen: (href: string) => void;
  groups: GroupWithMembers[];
  currentUserId: string | null;
  onMembershipChange: (groupId: string, clientVaultId: string, mode: MembershipMode | null) => void;
}) {
  return (
    <tr
      tabIndex={0}
      onClick={() => onOpen(href)}
      onKeyDown={e => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(href);
        }
      }}
      className="group block cursor-pointer transition-colors hover:bg-surface-bright focus:outline-none focus-visible:bg-surface-bright focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:table-row"
    >
      {/* Business — carries the owner underneath, and on mobile everything
          else too. */}
      <td className="block px-4 pb-1 pt-4 md:table-cell md:py-3">
        <span className="block truncate font-semibold text-on-secondary-fixed transition-colors group-hover:text-on-primary-container">
          {lead.company_name}
        </span>
        <span className="block truncate text-xs text-outline">{lead.client_name}</span>
        <span className="mt-0.5 block truncate text-xs text-outline lg:hidden">
          {lead.advisor_name}
        </span>
      </td>

      <td className="hidden px-4 py-3 lg:table-cell">
        <span className="block truncate text-sm text-on-surface-variant">{lead.advisor_name}</span>
      </td>

      <td className="block px-4 py-1 text-left md:table-cell md:py-3 md:text-right">
        <span className="font-semibold tabular-nums text-on-secondary-fixed">
          {formatCurrency(lead.capital_requested)}
        </span>
      </td>

      <td className="block px-4 py-1 md:table-cell md:py-3">
        <DocCount
          approved={lead.docs_approved}
          total={lead.docs_total}
          awaiting={lead.docs_awaiting_review}
        />
      </td>

      <td className="hidden px-4 py-3 xl:table-cell">
        {lead.pipeline_status && <LoanPipelineBadge currentStatus={lead.pipeline_status} />}
      </td>

      <td className="block px-4 py-1 md:table-cell md:py-3 md:text-right">
        <AgeCell days={lead.age_days} />
      </td>

      <td className="block px-4 pb-4 pt-1 md:table-cell md:py-3">
        <div className="flex items-center justify-end gap-1">
          <GroupPicker
            lead={lead}
            groups={groups}
            currentUserId={currentUserId}
            onChanged={onMembershipChange}
          />
          <ChevronRight
            className="h-4 w-4 shrink-0 text-outline transition-transform group-hover:translate-x-0.5 group-hover:text-on-secondary-fixed"
            aria-hidden
          />
        </div>
      </td>
    </tr>
  );
}
