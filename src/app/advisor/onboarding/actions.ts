"use server";

// Internal-advisor compliance onboarding — sign a W-9, upload a voided check.
//
// The twin of src/app/partner/welcome/actions.ts for staff advisors invited via
// /admin/team. Every action re-resolves the advisor from the SESSION; an
// advisor id is never accepted from the client — it is the only thing standing
// between a logged-in advisor and stamping somebody else's compliance row.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  completeAdvisorOnboardingIfReady,
  ensureAdvisorW9Document,
  getAdvisorOnboardingState,
  storeAdvisorVoidedCheck,
  syncAdvisorW9,
  type AdvisorOnboardingState,
} from "@/lib/advisor-onboarding";

/**
 * Resolve the caller's own staff advisor row, or an error explaining why not.
 * Partner mirror rows are refused: their paperwork lives on referral_partners.
 */
async function requireStaffAdvisor(): Promise<
  { advisor: AdvisorOnboardingState } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  const advisor = await getAdvisorOnboardingState(user.id);
  if (!advisor) return { error: "This account isn't linked to an advisor profile." };
  if (advisor.referral_partner_id) {
    return { error: "Partner advisors complete their paperwork in the partner portal." };
  }
  return { advisor };
}

/** Step 1 — open the W-9 for signing. Idempotent (resumes the same document). */
export async function startAdvisorW9(): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  const resolved = await requireStaffAdvisor();
  if ("error" in resolved) return { success: false, error: resolved.error };

  const result = await ensureAdvisorW9Document(resolved.advisor);
  if ("error" in result) return { success: false, error: result.error };

  revalidatePath("/advisor/dashboard");
  return { success: true, url: result.url };
}

/** Step 1 — ask SignWell whether it's signed yet, and record it if so. */
export async function checkAdvisorW9(): Promise<{
  success: boolean;
  signed: boolean;
  error?: string;
}> {
  const resolved = await requireStaffAdvisor();
  if ("error" in resolved) return { success: false, signed: false, error: resolved.error };

  const { signed, error } = await syncAdvisorW9(resolved.advisor);
  if (signed) revalidatePath("/advisor/dashboard");
  return { success: !error, signed, error };
}

/** Step 2 — upload the voided check to the PRIVATE vault bucket. */
export async function uploadAdvisorVoidedCheck(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const resolved = await requireStaffAdvisor();
  if ("error" in resolved) return { success: false, error: resolved.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "Choose a file to upload." };

  const result = await storeAdvisorVoidedCheck(resolved.advisor, file);
  if (result.success) revalidatePath("/advisor/dashboard");
  return result;
}

/** Finish — open the workspace, once both documents are genuinely on file. */
export async function finishAdvisorOnboarding(): Promise<{
  success: boolean;
  error?: string;
}> {
  const resolved = await requireStaffAdvisor();
  if ("error" in resolved) return { success: false, error: resolved.error };

  const { completed, error } = await completeAdvisorOnboardingIfReady(resolved.advisor.id);
  if (!completed) return { success: false, error: error || "Finish both steps first." };

  revalidatePath("/advisor/dashboard");
  return { success: true };
}
