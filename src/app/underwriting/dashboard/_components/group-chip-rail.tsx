"use client";

/**
 * The saved-group chip rail, under the tab bar.
 *
 * SELECTING A GROUP AND SELECTING A TAB ARE MUTUALLY EXCLUSIVE. A group spans
 * all four buckets, so clicking a chip clears the tab and clicking a tab clears
 * the chip. The alternative — a group filtered *within* the current tab —
 * produces compound hidden state where the same chip shows four different
 * counts depending on a tab you may not be looking at.
 *
 * FAIL-SOFT BY DESIGN. This code ships before its migration is applied, so if
 * the groups tables are not there yet the rail renders NOTHING and the rest of
 * the dashboard behaves exactly as it did before. Nothing else on the page
 * reads these tables. Never let a missing table take the queue down with it.
 *
 * Reads go through the anon client so RLS decides what an underwriter can see.
 * Writes go through server actions, because an RLS denial does not throw — it
 * returns success with zero rows, and a group that silently fails to save is
 * worse than one that fails loudly.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import clsx from "clsx";
import { Plus, Users, Pencil, Loader2 } from "lucide-react";
import {
  countGroupMembers,
  type GroupCriteria,
  type GroupMembership,
  type GroupableLead,
  type MembershipMode,
} from "@/lib/lead-groups";
import { GroupEditorDialog } from "./group-editor-dialog";

export interface GroupWithMembers {
  id: string;
  owner_id: string;
  name: string;
  criteria: GroupCriteria;
  is_shared: boolean;
  updated_at?: string;
  members: GroupMembership[];
}

export function GroupChipRail({
  leads,
  activeGroupId,
  onSelect,
  groups,
  setGroups,
  currentUserId,
  unavailable,
  loading,
  reload,
  seedCriteria,
  advisorOptions,
}: {
  leads: GroupableLead[];
  activeGroupId: string | null;
  onSelect: (groupId: string | null) => void;
  groups: GroupWithMembers[];
  setGroups: React.Dispatch<React.SetStateAction<GroupWithMembers[]>>;
  currentUserId: string | null;
  unavailable: boolean;
  loading: boolean;
  reload: () => void;
  seedCriteria: () => GroupCriteria;
  advisorOptions: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<GroupWithMembers | null>(null);
  const [creatingFrom, setCreatingFrom] = useState<GroupCriteria | null>(null);

  // Counts are resolved against every loaded lead, not the active tab's slice —
  // a group spans buckets, so a count scoped to one tab would be a lie.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of groups) map.set(g.id, countGroupMembers(leads, g.criteria, g.members));
    return map;
  }, [groups, leads]);

  // The migration is not applied yet: say nothing, break nothing.
  if (unavailable) return null;

  if (loading && groups.length === 0) {
    return (
      <div className="flex items-center gap-2 px-1 py-1 text-xs text-outline">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Loading groups
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {groups.map(group => {
          const active = group.id === activeGroupId;
          const isMine = group.owner_id === currentUserId;
          return (
            <span key={group.id} className="inline-flex items-center">
              <button
                type="button"
                onClick={() => onSelect(active ? null : group.id)}
                aria-pressed={active}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                  active
                    ? "border-on-secondary-fixed bg-on-secondary-fixed text-primary-fixed"
                    : "border-outline-variant/40 bg-white text-on-surface-variant hover:border-primary/50 hover:text-on-secondary-fixed"
                )}
              >
                {!isMine && (
                  <Users
                    className="h-3 w-3 opacity-70"
                    aria-label="Shared with the team"
                  />
                )}
                <span className="max-w-[14rem] truncate">{group.name}</span>
                <span
                  className={clsx(
                    "tabular-nums",
                    active ? "text-primary-fixed/70" : "text-outline"
                  )}
                >
                  {counts.get(group.id) ?? 0}
                </span>
              </button>

              {isMine && (
                <button
                  type="button"
                  onClick={() => setEditing(group)}
                  aria-label={`Edit ${group.name}`}
                  className="-ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-outline transition-colors hover:text-on-secondary-fixed"
                >
                  <Pencil className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          );
        })}

        <button
          type="button"
          onClick={() => setCreatingFrom(seedCriteria())}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-outline-variant/60 px-3 py-1.5 text-xs font-semibold text-outline transition-colors hover:border-primary hover:text-on-primary-container"
        >
          <Plus className="h-3 w-3" aria-hidden />
          New group
        </button>
      </div>

      {(editing || creatingFrom) && (
        <GroupEditorDialog
          open
          group={editing}
          initialCriteria={creatingFrom ?? undefined}
          advisorOptions={advisorOptions}
          onClose={() => {
            setEditing(null);
            setCreatingFrom(null);
          }}
          onSaved={reload}
          onDeleted={groupId => {
            setGroups(prev => prev.filter(g => g.id !== groupId));
            if (activeGroupId === groupId) onSelect(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Loads groups and their overrides, and owns the optimistic membership patch
 * the per-lead picker calls into.
 *
 * A missing table (the migration has not run) resolves to `unavailable`, never
 * to an error toast — the underwriter did not do anything wrong and there is
 * nothing for them to act on.
 */
export function useLeadGroups(enabled: boolean) {
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const supabase = createClient();
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    setCurrentUserId(user?.id ?? null);

    const { data: groupRows, error: groupErr } = await supabase
      .from("uw_lead_groups")
      .select("id, owner_id, name, criteria, is_shared, updated_at")
      .order("updated_at", { ascending: false });

    if (groupErr) {
      // Undefined table / unknown relation — the migration is pending. Anything
      // else is still not worth taking the queue down for, so it degrades the
      // same way and leaves a breadcrumb in the console.
      console.warn("lead groups unavailable:", groupErr.message);
      setUnavailable(true);
      setLoading(false);
      return;
    }

    const { data: memberRows } = await supabase
      .from("uw_lead_group_members")
      .select("group_id, client_vault_id, mode");

    const byGroup = new Map<string, GroupMembership[]>();
    for (const m of memberRows ?? []) {
      const list = byGroup.get(m.group_id);
      const entry = { client_vault_id: m.client_vault_id, mode: m.mode as MembershipMode };
      if (list) list.push(entry);
      else byGroup.set(m.group_id, [entry]);
    }

    setGroups(
      (groupRows ?? []).map(g => ({
        id: g.id,
        owner_id: g.owner_id,
        name: g.name,
        // jsonb comes back as whatever was stored. The predicate treats an
        // unrecognised shape as empty criteria, which matches nothing — the
        // safe direction.
        criteria: (g.criteria ?? {}) as GroupCriteria,
        is_shared: g.is_shared,
        updated_at: g.updated_at ?? undefined,
        members: byGroup.get(g.id) ?? [],
      }))
    );
    setUnavailable(false);
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Optimistic override patch, also used to roll back a refused write. */
  const patchMembership = useCallback(
    (groupId: string, clientVaultId: string, mode: MembershipMode | null) => {
      setGroups(prev =>
        prev.map(g => {
          if (g.id !== groupId) return g;
          const members = g.members.filter(m => m.client_vault_id !== clientVaultId);
          if (mode) members.push({ client_vault_id: clientVaultId, mode });
          return { ...g, members };
        })
      );
    },
    []
  );

  return { groups, setGroups, loading, unavailable, currentUserId, reload: load, patchMembership };
}
