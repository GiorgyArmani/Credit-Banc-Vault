"use client";

/**
 * Per-lead "which of my groups is this in?" popover.
 *
 * Ticking a box writes a PIN, not a membership: the lead may already be in the
 * group by criteria, in which case the box is ticked and disabled-looking with
 * a note saying so. Unticking a criteria match writes an EXCLUDE rather than
 * deleting nothing, because "take this one out" is the thing the underwriter
 * actually meant.
 *
 * Only groups you own are offered. A shared group is readable by the team but
 * writable by its owner alone, so listing someone else's here would put a
 * control in front of people that always fails.
 */

import { useState } from "react";
import { toast } from "sonner";
import { FolderPlus, Check, Loader2 } from "lucide-react";
import clsx from "clsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { setMembership } from "../group-actions";
import { matchesCriteria, type GroupableLead, type MembershipMode } from "@/lib/lead-groups";
import type { GroupWithMembers } from "./group-chip-rail";

export function GroupPicker({
  lead,
  groups,
  currentUserId,
  onChanged,
  className,
}: {
  lead: GroupableLead;
  groups: GroupWithMembers[];
  currentUserId: string | null;
  onChanged: (groupId: string, clientVaultId: string, mode: MembershipMode | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const mine = groups.filter(g => g.owner_id === currentUserId);
  const memberOfCount = groups.filter(g => membershipState(g, lead).inGroup).length;

  async function toggle(group: GroupWithMembers) {
    const state = membershipState(group, lead);
    // Ticked → untick. A criteria match needs an explicit exclude; a pin just
    // gets cleared back to whatever the criteria say.
    const next: MembershipMode | null = state.inGroup
      ? state.byCriteria
        ? "exclude"
        : null
      : "pin";

    setBusyId(group.id);
    // Optimistic: the rail count moves under the cursor. Rolled back below if
    // the write is refused.
    onChanged(group.id, lead.id, next);

    const res = await setMembership(group.id, lead.id, next);
    setBusyId(null);

    if (!res.success) {
      onChanged(group.id, lead.id, state.override);
      toast.error(res.error);
    }
  }

  if (mine.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={e => e.stopPropagation()}
          aria-label="Add to a group"
          className={clsx(
            "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
            memberOfCount > 0
              ? "bg-primary-container/40 text-on-primary-container"
              : "text-outline hover:bg-surface-dim/40 hover:text-on-surface",
            className
          )}
        >
          <FolderPlus className="h-4 w-4" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-64 rounded-xl border-outline-variant/30 p-1.5"
        onClick={e => e.stopPropagation()}
      >
        <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-outline">
          My groups
        </p>
        <ul className="max-h-64 overflow-y-auto">
          {mine.map(group => {
            const state = membershipState(group, lead);
            return (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => toggle(group)}
                  disabled={busyId === group.id}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-dim/30 disabled:opacity-60"
                >
                  <span
                    className={clsx(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      state.inGroup
                        ? "border-primary bg-primary text-on-secondary-fixed"
                        : "border-outline-variant"
                    )}
                  >
                    {busyId === group.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : state.inGroup ? (
                      <Check className="h-3 w-3" aria-hidden />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-on-surface">
                      {group.name}
                    </span>
                    {state.byCriteria && (
                      <span className="block text-[10px] font-medium text-outline">
                        {state.override === "exclude" ? "Removed by hand" : "Matched by filter"}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Why a lead is (or is not) in a group. `inGroup` is the resolved answer the
 * checkbox renders; `byCriteria` is what makes unticking mean "exclude" rather
 * than "unpin".
 */
function membershipState(group: GroupWithMembers, lead: GroupableLead) {
  const override = group.members.find(m => m.client_vault_id === lead.id)?.mode ?? null;
  const byCriteria = matchesCriteria(lead, group.criteria);
  const inGroup = override === "exclude" ? false : override === "pin" ? true : byCriteria;
  return { override, byCriteria, inGroup };
}
