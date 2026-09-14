"use server";

// Admin levers for Partner+. Deliberately thin — card details, invoices and
// refunds belong to the Stripe Dashboard, not a second copy of money state here.
//
//   active          the manual kill switch, independent of Stripe
//   billing_exempt  the comp lever — access without a fabricated subscription
//
// Service role throughout (external_advisors is RLS-locked, zero policies).
// Every change is logged with the acting admin, the only audit trail this
// codebase keeps for admin toggles.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDeskMagicLink } from "@/lib/magic-link";
import { send_partner_plus_welcome_email } from "@/lib/partner-plus-email";
import {
  backfillExternalAdvisorW9Pdf,
  signedExternalAdvisorDocUrl,
} from "@/lib/external-advisor-onboarding";

type ActionResult = { success: boolean; error?: string };

async function requireAdminUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: row } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  return row?.role === "admin" ? user : null;
}

async function setFlag(id: string, column: "active" | "billing_exempt", value: boolean): Promise<ActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };
  if (typeof id !== "string" || typeof value !== "boolean") return { success: false, error: "Invalid request" };

  const db = createAdminClient();
  const { data, error } = await db
    .from("external_advisors")
    .update({ [column]: value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("email")
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Partner+ account not found." };

  console.log(`[admin/partner-plus] ${admin.email ?? admin.id} set ${column}=${value} on ${data.email} (${id})`);
  revalidatePath("/admin/partner-plus");
  return { success: true };
}

/** Kill switch. Off locks the desk regardless of payment status. */
export async function setPartnerPlusActive(id: string, active: boolean): Promise<ActionResult> {
  return setFlag(id, "active", active);
}

/** Comp. On opens the desk with no subscription. */
export async function setPartnerPlusBillingExempt(id: string, exempt: boolean): Promise<ActionResult> {
  return setFlag(id, "billing_exempt", exempt);
}

/** Re-send the welcome email with a fresh sign-in link (a lost email, a spam folder). */
export async function resendPartnerPlusWelcome(id: string): Promise<ActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: row } = await db
    .from("external_advisors")
    .select("first_name, email, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!row?.user_id) return { success: false, error: "This account was never provisioned." };

  const link = await generateDeskMagicLink(row.email);
  if (!link) return { success: false, error: "Could not generate a sign-in link." };
  try {
    await send_partner_plus_welcome_email({ first_name: row.first_name, email: row.email, magic_link: link });
  } catch (err) {
    console.error("[admin/partner-plus] resend failed:", err);
    return { success: false, error: "The email could not be sent." };
  }
  return { success: true };
}

/** Short-lived URL to view a rep's W-9 or voided check. */
export async function getPartnerPlusDocUrl(
  id: string,
  kind: "w9" | "voided_check"
): Promise<{ success: boolean; url?: string; error?: string }> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: row } = await db
    .from("external_advisors")
    .select("w9_file_path, voided_check_path, w9_signed_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { success: false, error: "Partner+ account not found." };

  let path = kind === "w9" ? row.w9_file_path : row.voided_check_path;
  // SignWell's PDF lags "Completed" by seconds — fetch our copy on demand.
  if (!path && kind === "w9" && row.w9_signed_at) path = await backfillExternalAdvisorW9Pdf(id);
  if (!path) return { success: false, error: kind === "w9" ? "No W-9 on file yet." : "No voided check on file yet." };

  const url = await signedExternalAdvisorDocUrl(path);
  return url ? { success: true, url } : { success: false, error: "Could not open the document." };
}
