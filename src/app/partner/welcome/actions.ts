"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/**
 * Finish referral-partner onboarding: the partner chooses their own password.
 *
 * They arrive here from the invite magic link, so they already hold a session —
 * that session is the authorization. The auth user was created with a random
 * password nobody ever saw, so this is the first real credential on the account
 * and `password_set_at` is the only record that it happened (Supabase always
 * reports "has a password", which is why we can't ask it).
 *
 * The password update goes through the SESSION-scoped client so Supabase applies
 * it to the caller's own account and nobody else's; the timestamp goes through
 * the service role because referral_partners is RLS-locked with zero policies.
 */
export async function completePartnerOnboarding(
  password: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Your session expired. Open your invite link again." };

  if (typeof password !== "string" || password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters." };
  }
  if (password.length > 200) {
    return { success: false, error: "That password is too long." };
  }

  const db = createAdminClient();

  // Only a real partner may complete this step — a client or staff account that
  // wandered here must not be able to stamp a partner row.
  const { data: partner } = await db
    .from("referral_partners")
    .select("id, portal_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!partner) {
    return { success: false, error: "This account isn't linked to a referral partner." };
  }
  if (partner.portal_enabled === false) {
    return { success: false, error: "Portal access is paused for this account." };
  }

  const { error: pwdError } = await supabase.auth.updateUser({ password });
  if (pwdError) {
    return { success: false, error: pwdError.message };
  }

  const { error: stampError } = await db
    .from("referral_partners")
    .update({
      password_set_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", partner.id);

  if (stampError) {
    // The password IS set at this point. Failing the whole action would tell
    // them it didn't work and send them back to a form that now can't help —
    // let them through and log it; the worst case is one extra welcome screen.
    console.error("[partner-welcome] password set but stamp failed:", stampError);
  }

  revalidatePath("/partner/dashboard");
  return { success: true };
}
