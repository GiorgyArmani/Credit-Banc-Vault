import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns the email addresses of all advisor followers for a given client vault row.
 * Used to CC followers on every advisor-facing notification so they stay in the loop
 * the same way the primary advisor does.
 *
 * Always best-effort: a query failure returns [] so email sending is never blocked.
 */
export async function getFollowerEmailsForClient(
    supabase: SupabaseClient,
    clientVaultId: string | null | undefined,
): Promise<string[]> {
    if (!clientVaultId) return [];
    const { data, error } = await supabase
        .from("client_followers")
        .select("advisors:advisor_id ( email )")
        .eq("client_vault_id", clientVaultId);

    if (error) {
        console.error("getFollowerEmailsForClient error:", error);
        return [];
    }

    return (data ?? [])
        .map((r: any) => r.advisors?.email)
        .filter((e: any): e is string => typeof e === "string" && e.includes("@"));
}

/**
 * Variant that resolves the vault id from a client's auth user_id first.
 * Useful for callers that only have user_id (vault submit by the client themselves).
 */
export async function getFollowerEmailsForClientUser(
    supabase: SupabaseClient,
    clientUserId: string | null | undefined,
): Promise<string[]> {
    if (!clientUserId) return [];
    const { data: vault, error } = await supabase
        .from("client_data_vault")
        .select("id")
        .eq("user_id", clientUserId)
        .maybeSingle();
    if (error || !vault?.id) return [];
    return getFollowerEmailsForClient(supabase, vault.id);
}
