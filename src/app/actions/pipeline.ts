"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAffiliatePayoutForFundedVault } from "@/lib/affiliates";
import { revalidatePath } from "next/cache";

export type LoanStatus =
  | "created"
  | "onboarding"
  | "documents_requested"
  | "documents_received"
  | "under_review"
  | "lender_matched"
  | "funded"
  | "consulting_program"
  | "declined";

export interface PipelineStatusEntry {
  id: string;
  status: LoanStatus;
  changed_by: string | null;
  changed_by_role: string | null;
  note: string | null;
  created_at: string;
}

/**
 * Get the full pipeline history for a client
 */
export async function getClientPipelineHistory(
  clientVaultId: string
): Promise<PipelineStatusEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loan_status_history")
    .select("*")
    .eq("client_vault_id", clientVaultId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[pipeline] getClientPipelineHistory error:", error);
    return [];
  }
  return (data || []) as PipelineStatusEntry[];
}

/**
 * Get the latest status for a list of client vault IDs
 * Returns a Map<clientVaultId, LoanStatus>
 */
export async function getBulkLatestStatus(
  clientVaultIds: string[]
): Promise<Map<string, LoanStatus>> {
  if (clientVaultIds.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loan_status_history")
    .select("client_vault_id, status, created_at")
    .in("client_vault_id", clientVaultIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[pipeline] getBulkLatestStatus error:", error);
    return new Map();
  }

  // Keep only the most recent entry per client
  const result = new Map<string, LoanStatus>();
  for (const row of data || []) {
    if (!result.has(row.client_vault_id)) {
      result.set(row.client_vault_id, row.status as LoanStatus);
    }
  }
  return result;
}

/**
 * Advance or update the pipeline status for a client
 */
export async function updateLoanStatus(
  clientVaultId: string,
  newStatus: LoanStatus,
  note?: string,
  options?: { useServiceRole?: boolean }
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Unauthenticated" };
  }

  // Client-triggered transitions (e.g. completing onboarding) can't write to
  // loan_status_history under RLS. When the caller opts in, use the
  // service-role client for the DB ops while still recording the authenticated
  // user as the actor.
  const db = options?.useServiceRole ? createAdminClient() : supabase;

  // Get the latest status to avoid redundant consecutive entries
  const { data: latestEntry } = await db
    .from("loan_status_history")
    .select("status")
    .eq("client_vault_id", clientVaultId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (latestEntry?.status === newStatus) {
    // Same-status calls are no-ops regardless of note. Kanban drops always
    // pass a "Moved in Pipeline" note, so without this skip, re-dropping a
    // card on its current column would insert a duplicate history row —
    // breaking funded-event dedupe on the admin dashboard.
    return { success: true };
  }

  // Get the actor's role
  const { data: userData } = await db
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const { error } = await db.from("loan_status_history").insert({
    client_vault_id: clientVaultId,
    status: newStatus,
    changed_by: user.id,
    changed_by_role: userData?.role || "unknown",
    note: note || null,
  });

  if (error) {
    console.error("[pipeline] updateLoanStatus error:", error);
    return { success: false, error: error.message };
  }

  // Create in-app notification for the advisor
  if (newStatus === "funded" || newStatus === "lender_matched" || newStatus === "declined") {
    const statusLabels: Record<string, string> = {
      funded: "Loan Funded 🎉",
      lender_matched: "Lender Matched",
      declined: "Application Declined",
    };

    // Get advisor user_id for this client
    const { data: vaultData } = await db
      .from("client_data_vault")
      .select("advisor_id, client_name, advisors(user_id)")
      .eq("id", clientVaultId)
      .single();

    const advisorUserId = (vaultData?.advisors as any)?.user_id;
    if (advisorUserId) {
      await db.from("in_app_notifications").insert({
        user_id: advisorUserId,
        client_id: clientVaultId,
        title: statusLabels[newStatus],
        message: `${vaultData?.client_name} status updated to "${statusLabels[newStatus]}"`,
      });
    }
  }

  // Affiliate reward: if a referred deal just funded, pay the affiliate their
  // fixed reward via Giftronaut. Always uses the service role (the affiliate
  // tables are RLS-locked); idempotent + non-throwing, so it never blocks the
  // status transition. Only fires on the same-status-deduped funded insert above.
  if (newStatus === "funded") {
    await createAffiliatePayoutForFundedVault(createAdminClient(), clientVaultId);
  }

  revalidatePath("/underwriting/dashboard");
  revalidatePath("/advisor/dashboard");

  return { success: true };
}
