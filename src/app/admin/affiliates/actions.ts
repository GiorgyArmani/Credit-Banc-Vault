"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendGiftCard } from "@/lib/giftronaut";
import { revalidatePath } from "next/cache";

async function requireAdminUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return userRow?.role === "admin" ? user : null;
}

/**
 * Retry a failed Giftronaut send for an existing payout row (admin only). Reuses
 * the payout id as the idempotency key, so if the original actually went through
 * Giftronaut this won't double-charge.
 */
export async function retryAffiliatePayout(
  payoutId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();

  const { data: payout } = await db
    .from("affiliate_payouts")
    .select("id, commission_amount, status, affiliates(first_name, last_name, email, giftronaut_email)")
    .eq("id", payoutId)
    .maybeSingle();

  if (!payout) return { success: false, error: "Payout not found" };
  if (payout.status === "sent" || payout.status === "delivered") {
    return { success: false, error: "Payout already sent" };
  }

  const aff: any = payout.affiliates;
  const email = aff?.giftronaut_email || aff?.email;
  if (!email) return { success: false, error: "Affiliate has no email" };

  const nowIso = new Date().toISOString();
  try {
    const result = await sendGiftCard({
      email,
      firstName: aff?.first_name,
      lastName: aff?.last_name,
      amount: Number(payout.commission_amount || 0),
      idempotencyKey: payout.id,
    });
    await db
      .from("affiliate_payouts")
      .update({
        status: "sent",
        giftronaut_order_id: result.orderId,
        giftronaut_status: result.status,
        error: null,
        sent_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", payout.id);
  } catch (err: any) {
    await db
      .from("affiliate_payouts")
      .update({ status: "failed", error: String(err?.message ?? err), updated_at: nowIso })
      .eq("id", payout.id);
    return { success: false, error: String(err?.message ?? err) };
  }

  revalidatePath("/admin/affiliates");
  return { success: true };
}

/**
 * Manually mark a payout delivered/paid (admin only) — e.g. after confirming the
 * gift was handled outside the automated flow.
 */
export async function markPayoutDelivered(
  payoutId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { error } = await db
    .from("affiliate_payouts")
    .update({ status: "delivered", updated_at: new Date().toISOString() })
    .eq("id", payoutId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/affiliates");
  return { success: true };
}
