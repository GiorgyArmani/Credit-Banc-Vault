"use server";

/**
 * Server actions for underwriter lead groups.
 *
 * WHY ACTIONS AND NOT DIRECT SUPABASE CALLS FROM THE PAGE. Under RLS a denied
 * write does not throw — it comes back as a success with zero rows affected. A
 * group that silently fails to save is worse than one that fails loudly, so
 * every mutation goes through here, authenticates, re-checks role with the
 * service role, and returns an explicit { success, error } the caller can toast.
 *
 * The role re-check mirrors resolveActorRole in ./actions.ts and exists for the
 * same reason: a server action is reachable by POSTing its action id to any
 * route, so `getUser()` proves somebody is logged in, not that they are allowed.
 *
 * Reads are NOT here. The rail reads groups through the anon client so RLS is
 * the thing deciding what an underwriter can see, rather than this file
 * re-deriving that in application code.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  groupCriteriaSchema,
  type GroupCriteria,
  type MembershipMode,
} from "@/lib/lead-groups";

type ActionResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? {} : { data: T }))
  | { success: false; error: string };

/** Roles allowed to own lead groups. Admins work the same queue. */
const GROUP_ROLES = new Set(["underwriting", "admin"]);

const NAME_MAX = 60;

async function resolveActor(): Promise<{ userId: string; role: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: actorRow } = await createAdminClient()
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return { userId: user.id, role: actorRow?.role ?? "unknown" };
}

async function requireGroupActor(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const actor = await resolveActor();
  if (!actor) return { ok: false, error: "Not signed in." };
  if (!GROUP_ROLES.has(actor.role)) {
    return { ok: false, error: "Underwriting access required." };
  }
  return { ok: true, userId: actor.userId };
}

/**
 * Ownership is checked with the service role rather than leaned on RLS, so a
 * caller editing someone else's group gets "not yours" instead of a write that
 * reports success and changes nothing.
 *
 * Shared groups are readable by the whole UW team but writable only by their
 * owner — nobody rewrites the list a colleague is working from.
 */
async function assertOwnership(
  groupId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await createAdminClient()
    .from("uw_lead_groups")
    .select("owner_id")
    .eq("id", groupId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Group not found." };
  if (data.owner_id !== userId) return { ok: false, error: "That group belongs to someone else." };
  return { ok: true };
}

function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return null;
  return name.slice(0, NAME_MAX);
}

/**
 * Criteria arrive from a client component, so they are untrusted input on their
 * way into a jsonb column with no CHECK constraint. This is the only guard.
 */
function parseCriteria(raw: unknown): { ok: true; criteria: GroupCriteria } | { ok: false; error: string } {
  const parsed = groupCriteriaSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid filter." };
  }
  return { ok: true, criteria: parsed.data };
}

/** Postgres unique_violation — the (owner, lower(name)) index. */
const UNIQUE_VIOLATION = "23505";

function revalidateQueue() {
  revalidatePath("/underwriting/dashboard");
}

export async function createGroup(input: {
  name: string;
  criteria?: unknown;
  isShared?: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const actor = await requireGroupActor();
  if (!actor.ok) return { success: false, error: actor.error };

  const name = cleanName(input.name ?? "");
  if (!name) return { success: false, error: "Give the group a name." };

  const criteria = parseCriteria(input.criteria);
  if (!criteria.ok) return { success: false, error: criteria.error };

  const { data, error } = await createAdminClient()
    .from("uw_lead_groups")
    .insert({
      owner_id: actor.userId,
      name,
      criteria: criteria.criteria,
      is_shared: Boolean(input.isShared),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { success: false, error: `You already have a group called "${name}".` };
    }
    return { success: false, error: error.message };
  }

  revalidateQueue();
  return { success: true, data: { id: data.id } };
}

export async function updateGroup(
  groupId: string,
  input: { name?: string; criteria?: unknown; isShared?: boolean }
): Promise<ActionResult> {
  const actor = await requireGroupActor();
  if (!actor.ok) return { success: false, error: actor.error };

  const owned = await assertOwnership(groupId, actor.userId);
  if (!owned.ok) return { success: false, error: owned.error };

  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name) return { success: false, error: "Give the group a name." };
    patch.name = name;
  }

  if (input.criteria !== undefined) {
    const criteria = parseCriteria(input.criteria);
    if (!criteria.ok) return { success: false, error: criteria.error };
    patch.criteria = criteria.criteria;
  }

  if (input.isShared !== undefined) patch.is_shared = Boolean(input.isShared);

  // An update with no fields would bump updated_at via the trigger and reorder
  // the rail for no reason.
  if (Object.keys(patch).length === 0) return { success: true };

  const { error } = await createAdminClient()
    .from("uw_lead_groups")
    .update(patch)
    .eq("id", groupId);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { success: false, error: "You already have a group with that name." };
    }
    return { success: false, error: error.message };
  }

  revalidateQueue();
  return { success: true };
}

export async function deleteGroup(groupId: string): Promise<ActionResult> {
  const actor = await requireGroupActor();
  if (!actor.ok) return { success: false, error: actor.error };

  const owned = await assertOwnership(groupId, actor.userId);
  if (!owned.ok) return { success: false, error: owned.error };

  // Memberships go with it through ON DELETE CASCADE.
  const { error } = await createAdminClient()
    .from("uw_lead_groups")
    .delete()
    .eq("id", groupId);

  if (error) return { success: false, error: error.message };

  revalidateQueue();
  return { success: true };
}

/**
 * Pin, exclude, or clear one lead's override in one group.
 *
 * `mode: null` clears the override and hands the lead back to the criteria —
 * which is not the same as excluding it. Unpinning a lead that also matches the
 * rules leaves it in the group; that is correct, and the UI says so by showing
 * the checkbox still ticked afterwards.
 */
export async function setMembership(
  groupId: string,
  clientVaultId: string,
  mode: MembershipMode | null
): Promise<ActionResult> {
  const actor = await requireGroupActor();
  if (!actor.ok) return { success: false, error: actor.error };

  const owned = await assertOwnership(groupId, actor.userId);
  if (!owned.ok) return { success: false, error: owned.error };

  const admin = createAdminClient();

  if (mode === null) {
    const { error } = await admin
      .from("uw_lead_group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("client_vault_id", clientVaultId);
    if (error) return { success: false, error: error.message };
    revalidateQueue();
    return { success: true };
  }

  // Upsert on the composite PK: flipping pin → exclude replaces the row rather
  // than colliding with it.
  const { error } = await admin.from("uw_lead_group_members").upsert(
    {
      group_id: groupId,
      client_vault_id: clientVaultId,
      mode,
      added_by: actor.userId,
    },
    { onConflict: "group_id, client_vault_id" }
  );

  if (error) return { success: false, error: error.message };

  revalidateQueue();
  return { success: true };
}

export async function shareGroup(groupId: string, isShared: boolean): Promise<ActionResult> {
  return updateGroup(groupId, { isShared });
}
