import type { SupabaseClient } from "@supabase/supabase-js";
import { isScopedAdvisorRole } from "@/lib/auth/roles";

export type ClientAccess = {
  isOwner: boolean;
  isFollower: boolean;
  isAdmin: boolean;
  advisorId: string | null;
};

/**
 * Returns whether the given user can access the given client vault.
 * Access = owner OR follower OR admin.
 */
export async function checkClientAccess(
  supabase: SupabaseClient,
  userId: string,
  clientVaultId: string
): Promise<ClientAccess> {
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const isAdmin = userRow?.role === "admin";

  const { data: advisor } = await supabase
    .from("advisors")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  const advisorId = (advisor?.id as string) ?? null;

  if (!advisorId) {
    return { isOwner: false, isFollower: false, isAdmin, advisorId: null };
  }

  const [{ data: client }, { data: follower }] = await Promise.all([
    supabase
      .from("client_data_vault")
      .select("advisor_id")
      .eq("id", clientVaultId)
      .maybeSingle(),
    supabase
      .from("client_followers")
      .select("id")
      .eq("client_vault_id", clientVaultId)
      .eq("advisor_id", advisorId)
      .maybeSingle(),
  ]);

  const isOwner = client?.advisor_id === advisorId;
  const isFollower = !!follower;

  return { isOwner, isFollower, isAdmin, advisorId };
}

/**
 * May this actor work this client file? Admin + underwriting work every file;
 * advisor-shaped roles (advisor / partner_advisor / partner_plus) only files
 * they own or follow; every other role (setter, client, affiliate…) none.
 * Pass the service-role client so the answer doesn't depend on RLS.
 */
export async function actorMayWorkClient(
  admin: SupabaseClient,
  actor: { userId: string; role: string },
  clientVaultId: string
): Promise<boolean> {
  if (actor.role === "admin" || actor.role === "underwriting") return true;
  if (!isScopedAdvisorRole(actor.role)) return false;
  const access = await checkClientAccess(admin, actor.userId, clientVaultId);
  return access.isOwner || access.isFollower;
}

/**
 * Server-action gate built on actorMayWorkClient: looks up the caller's role and
 * throws unless they may work this file. Optionally also checks that a
 * caller-supplied business belongs to the same vault.
 */
export async function assertActorMayWorkClient(
  admin: SupabaseClient,
  userId: string,
  clientVaultId: string,
  businessProfileId?: string | null
): Promise<void> {
  const { data: row } = await admin.from("users").select("role").eq("id", userId).maybeSingle();
  const role = (row?.role as string | undefined) ?? "";
  if (!(await actorMayWorkClient(admin, { userId, role }, clientVaultId))) {
    throw new Error("Access denied: You do not have access to this client");
  }
  if (businessProfileId && !(await businessBelongsToVault(admin, businessProfileId, clientVaultId))) {
    throw new Error("That business does not belong to this client");
  }
}

/** Does this business_profile belong to this client vault? */
export async function businessBelongsToVault(
  admin: SupabaseClient,
  businessProfileId: string,
  clientVaultId: string
): Promise<boolean> {
  const { data } = await admin
    .from("business_profiles")
    .select("client_vault_id")
    .eq("id", businessProfileId)
    .maybeSingle();
  return data?.client_vault_id === clientVaultId;
}

/** Does this funding_deal (via its business) belong to this client vault? */
export async function dealBelongsToVault(
  admin: SupabaseClient,
  fundingDealId: string,
  clientVaultId: string
): Promise<boolean> {
  const { data } = await admin
    .from("funding_deals")
    .select("business_profile_id")
    .eq("id", fundingDealId)
    .maybeSingle();
  if (!data?.business_profile_id) return false;
  return businessBelongsToVault(admin, data.business_profile_id as string, clientVaultId);
}

/** Owner OR admin OR follower. Throws if none. */
export async function assertCanAccessClient(
  supabase: SupabaseClient,
  userId: string,
  clientVaultId: string
): Promise<ClientAccess> {
  const access = await checkClientAccess(supabase, userId, clientVaultId);
  if (!access.isOwner && !access.isFollower && !access.isAdmin) {
    throw new Error("Access denied: You do not have access to this client");
  }
  return access;
}

/** Owner OR admin ONLY. Followers cannot manage followers. */
export async function assertCanManageFollowers(
  supabase: SupabaseClient,
  userId: string,
  clientVaultId: string
): Promise<ClientAccess> {
  const access = await checkClientAccess(supabase, userId, clientVaultId);
  if (!access.isOwner && !access.isAdmin) {
    throw new Error("Access denied: Only the owning advisor or an admin can manage followers");
  }
  return access;
}
