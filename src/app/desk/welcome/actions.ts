"use server";

// Partner+ onboarding actions — password, contact phone, profile photo, W-9,
// voided check.
//
// Every action re-resolves the rep from the SESSION. An id is never accepted
// from the client: it is the only thing standing between a logged-in rep and
// stamping somebody else's compliance row.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateStaffProfilePhoto } from "@/app/actions/staff-profile";
import {
  completeExternalAdvisorOnboardingIfReady,
  ensureExternalAdvisorW9Document,
  getExternalAdvisorState,
  saveExternalAdvisorPhone,
  stampExternalAdvisorPasswordSet,
  storeExternalAdvisorVoidedCheck,
  syncExternalAdvisorW9,
  type ExternalAdvisorOnboardingState,
} from "@/lib/external-advisor-onboarding";

async function requireDeskRep(): Promise<{ rep: ExternalAdvisorOnboardingState } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  const rep = await getExternalAdvisorState(user.id);
  if (!rep) return { error: "This account isn't linked to a Partner+ subscription." };
  if (!rep.active) return { error: "Access is paused for this account." };
  return { rep };
}

/**
 * Step 1 — the rep's first real password. They arrived on a magic link; the
 * account was created with a random password nobody saw. The update goes
 * through the SESSION client so it applies to the caller's own account only.
 */
export async function setDeskPassword(password: string): Promise<{ success: boolean; error?: string }> {
  const resolved = await requireDeskRep();
  if ("error" in resolved) return { success: false, error: resolved.error };

  if (typeof password !== "string" || password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters." };
  }
  if (password.length > 200) return { success: false, error: "That password is too long." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { success: false, error: error.message };

  // Password IS set at this point; a failed stamp only costs one extra screen.
  await stampExternalAdvisorPasswordSet(resolved.rep.id);
  revalidatePath("/desk", "layout");
  return { success: true };
}

/** Step 2 — the number their clients see on the advisor contact card. */
export async function saveDeskContactPhone(
  phone: string
): Promise<{ success: boolean; phone?: string; error?: string }> {
  const resolved = await requireDeskRep();
  if ("error" in resolved) return { success: false, error: resolved.error };
  if (typeof phone !== "string") return { success: false, error: "Enter a valid 10-digit US phone number." };

  const result = await saveExternalAdvisorPhone(resolved.rep, phone);
  if (result.success) revalidatePath("/desk", "layout");
  return result;
}

/**
 * Step 3 — the face their borrowers see on the "Your Advisor" card.
 *
 * Delegates to updateStaffProfilePhoto rather than re-implementing the upload:
 * that action already owns the size/type validation, the timestamped object
 * name (the bucket is public and cached hard, so overwriting in place leaves
 * people looking at the old face), the write to the advisors mirror and the
 * cleanup of the photo being replaced. It already admits partner_plus.
 *
 * requireDeskRep still runs first, for the one thing it adds: a paused account
 * (active = false) cannot write anything, photo included.
 */
export async function saveDeskProfilePhoto(
  formData: FormData
): Promise<{ success: boolean; url?: string; error?: string }> {
  const resolved = await requireDeskRep();
  if ("error" in resolved) return { success: false, error: resolved.error };

  const result = await updateStaffProfilePhoto(formData);
  if (result.success) revalidatePath("/desk", "layout");
  return result;
}

/** Step 4 — open (or resume) the W-9 in SignWell. */
export async function startDeskW9(): Promise<{ success: boolean; url?: string; error?: string }> {
  const resolved = await requireDeskRep();
  if ("error" in resolved) return { success: false, error: resolved.error };

  const result = await ensureExternalAdvisorW9Document(resolved.rep);
  if ("error" in result) return { success: false, error: result.error };
  return { success: true, url: result.url };
}

/** Step 4 — ask SignWell whether it's signed yet (backstop for the webhook). */
export async function checkDeskW9(): Promise<{ success: boolean; signed: boolean; error?: string }> {
  const resolved = await requireDeskRep();
  if ("error" in resolved) return { success: false, signed: false, error: resolved.error };

  const { signed, error } = await syncExternalAdvisorW9(resolved.rep);
  if (signed) revalidatePath("/desk", "layout");
  return { success: !error, signed, error };
}

/** Step 5 — the voided check, into the PRIVATE vault bucket. */
export async function uploadDeskVoidedCheck(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const resolved = await requireDeskRep();
  if ("error" in resolved) return { success: false, error: resolved.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "Choose a file to upload." };

  const result = await storeExternalAdvisorVoidedCheck(resolved.rep, file);
  if (result.success) revalidatePath("/desk", "layout");
  return result;
}

/** Finish — open the desk, once every step is genuinely done (re-checked server-side). */
export async function finishDeskOnboarding(): Promise<{ success: boolean; error?: string }> {
  const resolved = await requireDeskRep();
  if ("error" in resolved) return { success: false, error: resolved.error };

  const { completed, error } = await completeExternalAdvisorOnboardingIfReady(resolved.rep.id);
  if (!completed) return { success: false, error: error || "Finish every step first." };

  revalidatePath("/desk", "layout");
  return { success: true };
}
