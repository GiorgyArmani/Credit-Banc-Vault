import type { SupabaseClient } from "@supabase/supabase-js";

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
