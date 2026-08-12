"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPipelineTransition } from "@/lib/pipeline-core";
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
 * Roles allowed to move a deal through the pipeline. Everyone else — clients
 * (role='free') and affiliates — has NO write access to the funding process at
 * all; they only ever read the step their own file is on.
 *
 * partner_advisor is included: they do the advisor job on their own files. The
 * per-file boundary is RLS (`is_assigned_advisor_for`), not this list — the same
 * as for a staff advisor, who is likewise not restricted here to their own book.
 */
const STAFF_ROLES = new Set([
  "admin",
  "underwriting",
  "advisor",
  "setter",
  "partner_advisor",
]);

/**
 * Roles allowed to record `funded`. Narrower than STAFF_ROLES because this
 * transition pays an affiliate a real gift card downstream — setters never touch
 * the pipeline, so they are excluded. See [[affiliate_program]].
 *
 * partner_advisor IS allowed, for parity with an advisor. Know what that means:
 * `funded` also writes the partner's own commission row via
 * createPartnerCommissionForFundedVault, so a partner marking their own deal
 * funded self-initiates their payout. The row lands `status: 'pending'` and
 * releasing it stays an admin action, so the approval gate is downstream rather
 * than here. Drop "partner_advisor" from this set to make `funded` staff-only.
 */
const FUNDED_ROLES = new Set(["admin", "underwriting", "advisor", "partner_advisor"]);

/** Resolve the caller's role with the service role, so RLS can't mask it. */
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

/**
 * Advance or update the pipeline status for a client. STAFF ONLY.
 *
 * This is a server action, so any authenticated user can invoke it with crafted
 * arguments — the role check has to live here, not in the UI that calls it. A
 * client or affiliate calling this gets Forbidden regardless of the status or
 * vault they name; the client-triggered transitions run server-side instead (see
 * startClientOnboarding and the vault/onboarding API routes).
 */
export async function updateLoanStatus(
  clientVaultId: string,
  newStatus: LoanStatus,
  note?: string,
  /** The funding round this transition belongs to. Stamped on the history row so
   *  a repeat client's rounds stay tellable apart. Optional — legacy callers and
   *  client-level drags leave it null, which reads as "the client's round". */
  fundingDealId?: string | null
): Promise<{ success: boolean; error?: string }> {
  const actor = await resolveActor();
  if (!actor) return { success: false, error: "Unauthenticated" };

  if (!STAFF_ROLES.has(actor.role)) {
    console.warn(
      `[pipeline] BLOCKED "${newStatus}" on ${clientVaultId} by non-staff ${actor.role} ${actor.userId}`
    );
    return { success: false, error: "Forbidden" };
  }

  if (newStatus === "funded" && !FUNDED_ROLES.has(actor.role)) {
    console.warn(
      `[pipeline] BLOCKED funded transition on ${clientVaultId} by ${actor.role} ${actor.userId}`
    );
    return { success: false, error: "Forbidden" };
  }

  const result = await recordPipelineTransition({
    clientVaultId,
    newStatus,
    note,
    actorUserId: actor.userId,
    actorRole: actor.role,
    fundingDealId: fundingDealId ?? null,
  });

  if (result.success) {
    revalidatePath("/underwriting/dashboard");
    revalidatePath("/advisor/dashboard");
  }
  return result;
}

/**
 * The ONE pipeline write a client may trigger: stamping `onboarding` the first
 * time they open their vault.
 *
 * Deliberately takes no arguments. The vault is resolved from the caller's own
 * session, so a client cannot name someone else's file, and the status is fixed
 * here rather than passed in. It only fires while the file is still at `created`
 * — after that it is a no-op, so it can't be replayed to disturb a live file.
 */
export async function startClientOnboarding(): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Unauthenticated" };

  const db = createAdminClient();

  const { data: vault } = await db
    .from("client_data_vault")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!vault?.id) return { success: false, error: "No vault for this user" };

  // Only from a file that has never moved past `created`.
  const { data: history } = await db
    .from("loan_status_history")
    .select("status")
    .eq("client_vault_id", vault.id);

  const rows = history ?? [];
  if (rows.length !== 1 || rows[0].status !== "created") {
    return { success: true };
  }

  return recordPipelineTransition({
    clientVaultId: vault.id,
    newStatus: "onboarding",
    note: "Client accessed the vault for the first time",
    actorUserId: user.id,
    actorRole: "client",
  });
}
