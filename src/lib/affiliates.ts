import type { SupabaseClient } from "@supabase/supabase-js";
import { sendGiftCard } from "@/lib/giftronaut";
import { send_affiliate_payout_notification } from "@/lib/email";

/**
 * Link a newly-created client vault back to the referral lead that produced it,
 * so affiliate attribution survives from the public pre-qualification flow all
 * the way to a funded deal.
 *
 * Called at the end of every vault-creation path. Matches an unconverted
 * `referral_leads` row by GHL contact id first (most reliable — the referral
 * already created the GHL contact), then by email. On a match it:
 *   - marks the lead `converted` and stamps `converted_vault_id`,
 *   - stamps `client_data_vault.referral_lead_id` (the funded-payout hook walks
 *     this), and mirrors the affiliate name onto `referral_partner` for the
 *     existing client-profile UI.
 *
 * Best-effort and non-throwing: attribution must never break signup. Pass a
 * SERVICE-ROLE client (referral_leads is RLS-locked to service role).
 * See [[ghl_integration_contract]], [[role_model]].
 */
export async function linkReferralLeadToVault(
  db: SupabaseClient,
  args: { vaultId: string; email?: string | null; ghlContactId?: string | null }
): Promise<void> {
  const { vaultId, email, ghlContactId } = args;
  if (!vaultId) return;

  try {
    let lead: { id: string; affiliate_id: string | null } | null = null;

    if (ghlContactId) {
      const { data } = await db
        .from("referral_leads")
        .select("id, affiliate_id")
        .eq("ghl_contact_id", ghlContactId)
        .neq("status", "converted")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      lead = data ?? null;
    }

    if (!lead && email) {
      const { data } = await db
        .from("referral_leads")
        .select("id, affiliate_id")
        .eq("email", email.toLowerCase())
        .neq("status", "converted")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      lead = data ?? null;
    }

    if (!lead) return;

    const nowIso = new Date().toISOString();

    await db
      .from("referral_leads")
      .update({ status: "converted", converted_vault_id: vaultId, updated_at: nowIso })
      .eq("id", lead.id);

    // Attribution lives ONLY on referral_lead_id — this is the public affiliate
    // program. We deliberately do NOT touch client_data_vault.referral_partner /
    // GHL AFFILIATE_ASSIGNED: those belong to the separate internal
    // referral-partner program and must not be overwritten.
    await db
      .from("client_data_vault")
      .update({ referral_lead_id: lead.id })
      .eq("id", vaultId);
  } catch (err) {
    console.error("[affiliates] linkReferralLeadToVault failed (non-fatal):", err);
  }
}

/**
 * Pay the affiliate when a referred vault reaches `funded`. Called from the
 * pipeline `funded` transition. Idempotent and non-throwing:
 *   - no-op unless the vault carries a referral_lead_id (i.e. it's a referral),
 *   - a UNIQUE(client_vault_id) on affiliate_payouts + the payout-id
 *     idempotency key guarantee at most one Giftronaut send per funded deal.
 *
 * Pass a SERVICE-ROLE client. The reward is a fixed amount
 * (AFFILIATE_COMMISSION_AMOUNT, default $500). See [[role_model]].
 */
export async function createAffiliatePayoutForFundedVault(
  db: SupabaseClient,
  clientVaultId: string
): Promise<void> {
  try {
    // 1. Is this vault a referral?
    const { data: vault } = await db
      .from("client_data_vault")
      .select("id, referral_lead_id")
      .eq("id", clientVaultId)
      .maybeSingle();
    if (!vault?.referral_lead_id) return;

    // 2. lead -> affiliate
    const { data: lead } = await db
      .from("referral_leads")
      .select("id, affiliate_id")
      .eq("id", vault.referral_lead_id)
      .maybeSingle();
    if (!lead?.affiliate_id) return;

    const { data: affiliate } = await db
      .from("affiliates")
      .select("id, user_id, first_name, last_name, email, giftronaut_email")
      .eq("id", lead.affiliate_id)
      .maybeSingle();
    if (!affiliate) return;

    const commission = Number(process.env.AFFILIATE_COMMISSION_AMOUNT ?? 500);

    // Optionally record the funded deal for the audit trail (best-effort).
    let fundingDealId: string | null = null;
    const { data: fundingDeal } = await db
      .from("funding_deals")
      .select("id, business_profiles!inner(client_vault_id)")
      .eq("business_profiles.client_vault_id", clientVaultId)
      .not("funded_at", "is", null)
      .order("funded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fundingDeal?.id) fundingDealId = fundingDeal.id;

    // 3. Insert the pending payout. UNIQUE(client_vault_id) dedupes: a duplicate
    //    funded event hits the conflict and we stop (no second gift).
    const { data: payout, error: insertErr } = await db
      .from("affiliate_payouts")
      .insert({
        affiliate_id: affiliate.id,
        referral_lead_id: lead.id,
        client_vault_id: clientVaultId,
        funding_deal_id: fundingDealId,
        commission_amount: commission,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertErr) {
      if (insertErr.code === "23505") {
        console.log("[affiliates] payout already exists for vault", clientVaultId);
        return;
      }
      throw insertErr;
    }

    const nowIso = new Date().toISOString();
    const recipientEmail = affiliate.giftronaut_email || affiliate.email;

    if (!recipientEmail) {
      await db
        .from("affiliate_payouts")
        .update({ status: "failed", error: "Affiliate has no email on file", updated_at: nowIso })
        .eq("id", payout.id);
      return;
    }

    // 4. Send the gift via Giftronaut (idempotencyKey = payout id).
    try {
      const result = await sendGiftCard({
        email: recipientEmail,
        firstName: affiliate.first_name,
        lastName: affiliate.last_name,
        amount: commission,
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
    } catch (giftErr: any) {
      console.error("[affiliates] Giftronaut send failed:", giftErr);
      await db
        .from("affiliate_payouts")
        .update({ status: "failed", error: String(giftErr?.message ?? giftErr), updated_at: nowIso })
        .eq("id", payout.id);
      return; // admin can retry from the affiliates admin page
    }

    // 5. Notify the affiliate (in-app + email). Best-effort.
    const rewardStr = commission.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

    try {
      if (affiliate.user_id) {
        await db.from("in_app_notifications").insert({
          user_id: affiliate.user_id,
          client_id: clientVaultId,
          title: "Reward earned 🎉",
          message: `Your referral was funded — a ${rewardStr} reward is on its way!`,
        });
      }
    } catch (notifErr) {
      console.error("[affiliates] in-app notification failed (non-fatal):", notifErr);
    }

    try {
      if (recipientEmail) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
        await send_affiliate_payout_notification({
          affiliate_name: [affiliate.first_name, affiliate.last_name].filter(Boolean).join(" ").trim() || "there",
          affiliate_email: recipientEmail,
          reward_amount: rewardStr,
          login_url: `${appUrl}/affiliate/dashboard`,
        });
      }
    } catch (emailErr) {
      console.error("[affiliates] payout email failed (non-fatal):", emailErr);
    }
  } catch (err) {
    console.error("[affiliates] createAffiliatePayoutForFundedVault failed (non-fatal):", err);
  }
}
