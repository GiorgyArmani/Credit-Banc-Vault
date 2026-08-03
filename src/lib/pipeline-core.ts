// src/lib/pipeline-core.ts
//
// The mechanics of recording a pipeline transition, deliberately kept OUT of the
// "use server" action module. Everything exported from app/actions/pipeline.ts is
// a server action — reachable by any authenticated user with a crafted request —
// so the funding pipeline must not be driven from there by clients.
//
// Authorization is the CALLER's job, and there are exactly two kinds of caller:
//   - app/actions/pipeline.ts  → staff only, any status (role-gated there),
//   - client-triggered API routes → status hardcoded by the route, after it has
//     already proven the caller owns the vault (`.eq("user_id", user.id)`).
//
// A client never chooses a vault id or a status. See [[role_model]],
// [[rls_client_writes_need_service_role]].

import { createAdminClient } from "@/lib/supabase/admin";
import { createAffiliatePayoutForFundedVault } from "@/lib/affiliates";
import type { LoanStatus } from "@/app/actions/pipeline";

/**
 * Record a pipeline transition and fire its downstream effects. Uses the service
 * role: loan_status_history and in_app_notifications are staff-only under RLS,
 * and RLS denials fail silently, so the write has to be made deliberately.
 */
export async function recordPipelineTransition(args: {
  clientVaultId: string;
  newStatus: LoanStatus;
  note?: string | null;
  actorUserId: string;
  actorRole: string;
}): Promise<{ success: boolean; error?: string }> {
  const { clientVaultId, newStatus, note, actorUserId, actorRole } = args;
  const db = createAdminClient();

  // Invariant, independent of who is asking: a deal is funded when UNDERWRITING
  // records it funded. fundLoanAction writes the funded figures onto
  // funding_deals before transitioning, so requiring the row makes the Loan
  // Funded dialog the single route without relying on a spoofable flag.
  if (newStatus === "funded") {
    const { data: fundedDeal } = await db
      .from("funding_deals")
      .select("id, business_profiles!inner(client_vault_id)")
      .eq("business_profiles.client_vault_id", clientVaultId)
      .not("funded_at", "is", null)
      .limit(1)
      .maybeSingle();

    if (!fundedDeal?.id) {
      console.warn(
        `[pipeline] BLOCKED funded on ${clientVaultId} by ${actorRole} ${actorUserId}: no funded funding_deals row`
      );
      return {
        success: false,
        error:
          'Mark this deal funded from Underwriting\'s "Loan Funded" dialog — it records the lender, amount and term. The pipeline status follows from that.',
      };
    }
  }

  // Skip redundant consecutive entries. Kanban drops always pass a "Moved in
  // Pipeline" note, so without this a re-drop on the current column would insert
  // a duplicate row — breaking funded-event dedupe on the admin dashboard.
  const { data: latestEntry } = await db
    .from("loan_status_history")
    .select("status")
    .eq("client_vault_id", clientVaultId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestEntry?.status === newStatus) {
    return { success: true };
  }

  const { error } = await db.from("loan_status_history").insert({
    client_vault_id: clientVaultId,
    status: newStatus,
    changed_by: actorUserId,
    changed_by_role: actorRole,
    note: note || null,
  });

  if (error) {
    console.error("[pipeline] recordPipelineTransition insert error:", error);
    return { success: false, error: error.message };
  }

  // Notify the assigned advisor on the milestones they care about.
  if (newStatus === "funded" || newStatus === "lender_matched" || newStatus === "declined") {
    const statusLabels: Record<string, string> = {
      funded: "Loan Funded 🎉",
      lender_matched: "Lender Matched",
      declined: "Application Declined",
    };

    try {
      const { data: vaultData } = await db
        .from("client_data_vault")
        .select("advisor_id, client_name, advisors(user_id)")
        .eq("id", clientVaultId)
        .maybeSingle();

      // Nested select — the client is untyped, so name the shape we rely on.
      const advisor = vaultData?.advisors as { user_id?: string | null } | null;
      const advisorUserId = advisor?.user_id;
      if (advisorUserId) {
        await db.from("in_app_notifications").insert({
          user_id: advisorUserId,
          client_id: clientVaultId,
          title: statusLabels[newStatus],
          message: `${vaultData?.client_name} status updated to "${statusLabels[newStatus]}"`,
        });
      }
    } catch (notifErr) {
      console.error("[pipeline] advisor notification failed (non-fatal):", notifErr);
    }
  }

  // Affiliate reward: a referred deal that just funded pays its affiliate.
  // Idempotent and non-throwing, so it never blocks the transition.
  if (newStatus === "funded") {
    await createAffiliatePayoutForFundedVault(db, clientVaultId);
  }

  return { success: true };
}
