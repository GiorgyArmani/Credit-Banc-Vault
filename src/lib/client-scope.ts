import type { SupabaseClient } from "@supabase/supabase-js";

export type ScopedAccess = {
  isAdmin: boolean;
  advisorId: string | null;
  /** null means "no filter" (admin); otherwise list of client_data_vault.id the user can see */
  vaultIds: string[] | null;
};

/**
 * Returns which client_data_vault rows the given user is allowed to see.
 * - Admin: vaultIds = null (apply no filter)
 * - Advisor: union of owned clients (advisor_id = mine) + followed clients (via client_followers)
 * - Other roles or no advisor record: vaultIds = [] (no access)
 */
export async function getScopedClientVaultIds(
  supabase: SupabaseClient,
  userId: string
): Promise<ScopedAccess> {
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const isAdmin = userRow?.role === "admin";
  if (isAdmin) {
    return { isAdmin: true, advisorId: null, vaultIds: null };
  }

  const { data: advisor } = await supabase
    .from("advisors")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!advisor) return { isAdmin: false, advisorId: null, vaultIds: [] };

  const advisorId = advisor.id as string;

  const [{ data: owned }, { data: followed }] = await Promise.all([
    supabase.from("client_data_vault").select("id").eq("advisor_id", advisorId),
    supabase.from("client_followers").select("client_vault_id").eq("advisor_id", advisorId),
  ]);

  const ids = new Set<string>();
  owned?.forEach((r: any) => ids.add(r.id));
  followed?.forEach((r: any) => ids.add(r.client_vault_id));

  return { isAdmin: false, advisorId, vaultIds: Array.from(ids) };
}
