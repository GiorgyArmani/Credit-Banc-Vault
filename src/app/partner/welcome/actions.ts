"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import {
  PARTNER_DOC_BUCKET,
  PARTNER_DOC_PREFIX,
  VOIDED_CHECK_MAX_BYTES,
  VOIDED_CHECK_MIME_TYPES,
  completePartnerOnboardingIfReady,
  ensurePartnerW9Document,
  getPartnerOnboardingState,
  savePartnerPhone,
  syncPartnerW9,
} from "@/lib/partner-onboarding";
import type { PartnerOnboardingState } from "@/lib/partner-onboarding";

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

// ============================================================================
// partner_advisor compliance onboarding — sign a W-9, upload a voided check
// ============================================================================
//
// Only partners with the deal desk on ever see these. A plain referral_partner
// shares a link and has no paperwork; a partner_advisor submits deals and gets
// paid on funded files, which makes them a payee we report on.
//
// Every action re-resolves the partner from the SESSION. The partner id is
// never accepted from the client — it is the only thing standing between a
// logged-in partner and stamping somebody else's compliance row.

/**
 * Resolve the caller's own partner row, or an error explaining why not.
 *
 * `deal_desk_enabled` is the authorization here, not the role: the role can be
 * flipped by an admin a moment before this runs, and the flag is what the
 * onboarding gate itself reads.
 */
async function requireDealDeskPartner(): Promise<
  { partner: PartnerOnboardingState } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Your session expired. Sign in again." };

  const partner = await getPartnerOnboardingState(user.id);
  if (!partner) return { error: "This account isn't linked to a referral partner." };
  if (partner.portal_enabled === false) return { error: "Portal access is paused for this account." };
  if (!partner.deal_desk_enabled) {
    return { error: "This step is only for partners with the deal desk enabled." };
  }

  return { partner };
}

/**
 * Step 2 — the contact number clients will see.
 *
 * Not compliance: a partner_advisor is the advisor of record on their clients'
 * files, and the client portal shows the client who their advisor is and how to
 * reach them. Collected here because this is the last moment we have their
 * attention before the desk opens.
 */
export async function savePartnerContactPhone(
  phone: string
): Promise<{ success: boolean; phone?: string; error?: string }> {
  const resolved = await requireDealDeskPartner();
  if ("error" in resolved) return { success: false, error: resolved.error };

  if (typeof phone !== "string") {
    return { success: false, error: "Enter a valid 10-digit US phone number." };
  }

  const result = await savePartnerPhone(resolved.partner, phone);
  if (result.success) revalidatePath("/partner/welcome");
  return result;
}

/**
 * Step 3 — open the W-9 for signing.
 *
 * Returns the embedded signing URL. Idempotent: a partner who reloads resumes
 * the same SignWell document rather than minting a second envelope.
 */
export async function startPartnerW9(): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  const resolved = await requireDealDeskPartner();
  if ("error" in resolved) return { success: false, error: resolved.error };

  const result = await ensurePartnerW9Document(resolved.partner);
  if ("error" in result) return { success: false, error: result.error };

  revalidatePath("/partner/welcome");
  return { success: true, url: result.url };
}

/**
 * Step 3 — ask SignWell whether it's signed yet, and record it if so.
 *
 * Called when the embed reports completion AND on every load of the onboarding
 * screen, which is what covers the partner who signed and then closed the tab.
 * There is no webhook for this document; this poll is the whole backstop.
 */
export async function checkPartnerW9(): Promise<{
  success: boolean;
  signed: boolean;
  error?: string;
}> {
  const resolved = await requireDealDeskPartner();
  if ("error" in resolved) return { success: false, signed: false, error: resolved.error };

  const { signed, error } = await syncPartnerW9(resolved.partner);
  if (signed) revalidatePath("/partner/welcome");
  return { success: !error, signed, error };
}

/**
 * Step 4 — upload the voided business check.
 *
 * Goes to the PRIVATE `vault` bucket. `user-documents` is public, and a voided
 * check carries a routing and account number.
 *
 * Re-uploading replaces the record but keeps the old object: storage is cheap,
 * and a partner correcting a blurry photo should not be able to destroy the
 * copy we already accepted.
 */
export async function uploadPartnerVoidedCheck(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  const resolved = await requireDealDeskPartner();
  if ("error" in resolved) return { success: false, error: resolved.error };
  const { partner } = resolved;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Choose a file to upload." };
  }
  if (file.size > VOIDED_CHECK_MAX_BYTES) {
    return { success: false, error: "That file is larger than 15MB." };
  }
  if (!VOIDED_CHECK_MIME_TYPES.includes(file.type)) {
    return { success: false, error: "Upload a PDF or a photo (JPG, PNG, HEIC, WEBP)." };
  }

  const safeName = (file.name || "voided-check")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-80);
  const path = `${PARTNER_DOC_PREFIX}/${partner.id}/voided-check_${Date.now()}_${safeName}`;

  const db = createAdminClient();
  const { error: uploadErr } = await db.storage
    .from(PARTNER_DOC_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false,
    });

  if (uploadErr) {
    console.error("[partner-welcome] voided check upload failed:", uploadErr);
    return { success: false, error: "Upload failed. Try again." };
  }

  const { error: stampErr } = await db
    .from("referral_partners")
    .update({
      voided_check_path: path,
      voided_check_filename: file.name || null,
      voided_check_uploaded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", partner.id);

  if (stampErr) {
    console.error("[partner-welcome] voided check stamp failed:", stampErr);
    return { success: false, error: "Uploaded, but we couldn't record it. Try again." };
  }

  revalidatePath("/partner/welcome");
  return { success: true };
}

/**
 * Finish — open the deal desk, once both steps are genuinely done.
 *
 * Re-reads both flags server-side rather than trusting the screen that called
 * it; this is the write the whole gate hangs on.
 */
export async function finishPartnerAdvisorOnboarding(): Promise<{
  success: boolean;
  error?: string;
}> {
  const resolved = await requireDealDeskPartner();
  if ("error" in resolved) return { success: false, error: resolved.error };

  const { completed, error } = await completePartnerOnboardingIfReady(resolved.partner.id);
  if (!completed) return { success: false, error: error || "Finish both steps first." };

  revalidatePath("/partner/welcome");
  revalidatePath("/partner/deals");
  return { success: true };
}
