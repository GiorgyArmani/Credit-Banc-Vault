"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processAffiliatePayout } from "@/lib/affiliates";
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
 * Send a payout now (admin only) — used both to release a held row and to retry
 * a failed one. Delegates to processAffiliatePayout so the admin path and the
 * cron worker enforce exactly the same rules; `admin: true` overrides the 24h
 * gate, the hold and the attempt cap, but NOT the check that the deal is still
 * marked funded. The payout id stays the idempotency key, so releasing a row
 * whose original send actually reached Giftronaut won't double-charge.
 */
export async function retryAffiliatePayout(
  payoutId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const result = await processAffiliatePayout(db, payoutId, {
    admin: true,
    actorLabel: `admin ${admin.email ?? admin.id}`,
  });

  revalidatePath("/admin/affiliates");

  if (result.outcome === "sent") return { success: true };
  if (result.outcome === "failed") return { success: false, error: result.error };
  return { success: false, error: result.reason };
}

/**
 * Cancel a payout before it sends (admin only). This is the point of the 24h
 * gate: a deal marked funded by mistake can be pulled back before any money
 * moves. Refuses once the gift card exists — a sent card can't be recalled.
 */
export async function cancelAffiliatePayout(
  payoutId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: payout } = await db
    .from("affiliate_payouts")
    .select("id, status")
    .eq("id", payoutId)
    .maybeSingle();

  if (!payout) return { success: false, error: "Payout not found" };
  if (payout.status === "sent" || payout.status === "delivered") {
    return { success: false, error: "Gift card already sent — it can't be canceled" };
  }
  // 'awaiting_link' looks unsent — nobody has been emailed — but the reward-link
  // order is already placed and the balance already deducted. Cancelling here
  // wouldn't refund anything; it would only strand a card we paid for. Let the
  // worker finish delivering it.
  if (payout.status === "awaiting_link") {
    return {
      success: false,
      error:
        "The gift card is already paid for — only its claim link is still being generated. It will deliver on the next payout run.",
    };
  }
  if (payout.status === "canceled") return { success: true };

  const note = reason?.trim() || "Canceled by an admin before release";
  const { error } = await db
    .from("affiliate_payouts")
    .update({
      status: "canceled",
      hold_reason: null,
      error: `${note} (${admin.email ?? admin.id})`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payoutId)
    .not("status", "in", "(sent,delivered,awaiting_link)");

  if (error) return { success: false, error: error.message };

  console.warn(`[affiliates] payout ${payoutId} canceled by admin ${admin.id}: ${note}`);
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

/**
 * Reveal the gift card's claim link for one payout (admin only).
 *
 * Deliberately a fetch-on-demand action rather than a column in the payouts
 * table: a reward link has no recipient OTP, so anyone who reads it can redeem
 * the balance. It must not sit in the page HTML of a list view that an admin
 * might screen-share. This exists for the one case that matters — our email
 * bounced, or the affiliate lost it, and someone has to hand the link over.
 *
 * Falls back to re-fetching from Giftronaut when the stored copy is missing:
 * the order is the source of truth, `reward_link` is only a cache.
 */
export async function revealPayoutClaimLink(
  payoutId: string
): Promise<{ success: boolean; link?: string; error?: string }> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: payout } = await db
    .from("affiliate_payouts")
    .select("id, reward_link, giftronaut_order_id")
    .eq("id", payoutId)
    .maybeSingle();

  if (!payout) return { success: false, error: "Payout not found" };
  if (payout.reward_link) {
    console.warn(`[affiliates] claim link revealed for payout ${payoutId} by admin ${admin.id}`);
    return { success: true, link: payout.reward_link };
  }
  if (!payout.giftronaut_order_id) {
    return { success: false, error: "This payout has no reward link (choice-card email flow)" };
  }

  try {
    const { getOrder } = await import("@/lib/giftronaut");
    const order = await getOrder(payout.giftronaut_order_id);
    if (!order.rewardLink) {
      return { success: false, error: `Order is ${order.status} — no claim link minted yet` };
    }
    await db
      .from("affiliate_payouts")
      .update({ reward_link: order.rewardLink, updated_at: new Date().toISOString() })
      .eq("id", payoutId);
    console.warn(`[affiliates] claim link revealed for payout ${payoutId} by admin ${admin.id}`);
    return { success: true, link: order.rewardLink };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
