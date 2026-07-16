"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const ALLOWED_STATUSES = ["new", "contacted", "qualified", "disqualified"] as const;
type LeadStatus = (typeof ALLOWED_STATUSES)[number];

/**
 * Staff pre-qualification: move a referral lead through the pipeline before it
 * becomes a vault. Advisors and admins only. 'converted' is set automatically by
 * the vault-creation flow, so it's not a manual option here.
 */
export async function updateReferralLeadStatus(
  leadId: string,
  status: LeadStatus
): Promise<{ success: boolean; error?: string }> {
  if (!ALLOWED_STATUSES.includes(status)) {
    return { success: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Unauthenticated" };

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (userRow?.role !== "advisor" && userRow?.role !== "admin") {
    return { success: false, error: "Forbidden" };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("referral_leads")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .neq("status", "converted"); // don't override a converted lead

  if (error) return { success: false, error: error.message };

  revalidatePath("/advisor/dashboard/referrals");
  return { success: true };
}
