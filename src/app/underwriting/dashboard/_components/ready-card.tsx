"use client";

/**
 * The Ready bucket's card.
 *
 * Ready is the only bucket an underwriter acts on rather than looks up, so it
 * keeps a card while the archives became rows. It is roughly 200px tall against
 * the ~450px it used to be: the old card spent most of its height on an email
 * address and a decorative blur.
 *
 * Company name leads. UW identifies files by business, not by owner.
 */

import { ChevronRight } from "lucide-react";
import { LoanPipelineBadge } from "@/components/loan-pipeline-status";
import { DocCount, AgeCell, formatCurrency } from "./lead-display";
import { GroupPicker } from "./group-picker";
import type { GroupableLead, MembershipMode } from "@/lib/lead-groups";
import type { GroupWithMembers } from "./group-chip-rail";

export function ReadyCard({
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
    <div
      role="link"
      tabIndex={0}
      onClick={() => onOpen(href)}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(href);
        }
      }}
      className="group flex cursor-pointer flex-col gap-4 rounded-2xl border border-outline-variant/30 bg-white p-5 shadow-[0_1px_2px_rgba(0,3,33,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_14px_34px_-18px_rgba(32,37,54,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-headline truncate text-lg font-extrabold leading-tight tracking-tighter text-on-secondary-fixed transition-colors group-hover:text-on-primary-container">
            {lead.company_name}
          </h3>
          <p className="mt-0.5 truncate text-sm text-on-surface-variant">{lead.client_name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <GroupPicker
            lead={lead}
            groups={groups}
            currentUserId={currentUserId}
            onChanged={onMembershipChange}
          />
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-dim/30 text-outline transition-all group-hover:bg-on-secondary-fixed group-hover:text-primary-fixed">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {lead.pipeline_status && <LoanPipelineBadge currentStatus={lead.pipeline_status} />}
        <AgeCell days={lead.age_days} />
      </div>

      <div className="flex items-end justify-between gap-3 border-t border-outline-variant/25 pt-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-outline">
            Capital requested
          </p>
          <p className="font-headline text-2xl font-extrabold tracking-tighter text-on-secondary-fixed">
            {formatCurrency(lead.capital_requested)}
          </p>
          <p className="mt-0.5 truncate text-xs text-outline">{lead.advisor_name}</p>
        </div>
        <DocCount
          approved={lead.docs_approved}
          total={lead.docs_total}
          awaiting={lead.docs_awaiting_review}
          className="pb-1"
        />
      </div>
    </div>
  );
}
