import type { SupabaseClient } from "@supabase/supabase-js";
import { sendGiftCard } from "@/lib/giftronaut";
import { send_affiliate_payout_notification } from "@/lib/email";
import { slackPostMessage } from "@/lib/slack-api";

/**
 * Roles whose `funded` transition is allowed to trigger a real payout. Mirrors
 * FUNDED_ROLES in app/actions/pipeline.ts — keep the two in sync.
 */
const PAYOUT_ACTOR_ROLES = new Set(["admin", "underwriting", "advisor"]);

/** Read a positive number from env, falling back when unset or unparseable. */
function numEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Post a payout notice to the affiliate-money Slack channel. Best-effort and
 * no-ops when SLACK_AFFILIATE_CHANNEL_ID is unset, so payouts never depend on
 * Slack being configured. See [[slack_uw_channels]].
 */
async function postAffiliateAlert(text: string): Promise<void> {
  try {
    const channel = process.env.SLACK_AFFILIATE_CHANNEL_ID;
    if (!channel) return;
    await slackPostMessage(channel, text);
  } catch (err) {
    console.error("[affiliates] Slack alert failed (non-fatal):", err);
  }
}

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
      .select("id, referral_lead_id, user_id, client_email")
      .eq("id", clientVaultId)
      .maybeSingle();
    if (!vault?.referral_lead_id) return;

    // 1b. Defense in depth: pay only on a funded transition that a STAFF member
    //     recorded. updateLoanStatus already gates this, but real money leaves
    //     the building here, so we re-verify against the audit row instead of
    //     trusting the caller. Any other funded write (a future code path, a
    //     manual insert) lands here and is refused.
    const { data: fundedEntry } = await db
      .from("loan_status_history")
      .select("changed_by_role")
      .eq("client_vault_id", clientVaultId)
      .eq("status", "funded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!fundedEntry || !PAYOUT_ACTOR_ROLES.has(fundedEntry.changed_by_role ?? "")) {
      console.warn(
        `[affiliates] REFUSED payout for ${clientVaultId}: funded transition actor role`,
        fundedEntry?.changed_by_role ?? "(no funded row)"
      );
      return;
    }

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

    // 2b. Self-referral guard: an affiliate must not collect on their own vault.
    //     Recorded as a `canceled` payout rather than a silent return so it is
    //     visible on /admin/affiliates and the UNIQUE(client_vault_id) row is
    //     claimed — an admin can still override deliberately.
    const affiliateEmail = affiliate.email?.trim().toLowerCase() || null;
    const vaultEmail = vault.client_email?.trim().toLowerCase() || null;
    const isSelfReferral =
      (!!affiliate.user_id && !!vault.user_id && affiliate.user_id === vault.user_id) ||
      (!!affiliateEmail && !!vaultEmail && affiliateEmail === vaultEmail);

    if (isSelfReferral) {
      console.warn(
        `[affiliates] REFUSED payout for ${clientVaultId}: self-referral by affiliate ${affiliate.id}`
      );
      await db.from("affiliate_payouts").insert({
        affiliate_id: affiliate.id,
        referral_lead_id: lead.id,
        client_vault_id: clientVaultId,
        commission_amount: 0,
        status: "canceled",
        error: "Self-referral — affiliate matches the referred client",
      });
      return;
    }

    // Commission is server-side only (env), but clamp it to a hard ceiling so a
    // fat-fingered AFFILIATE_COMMISSION_AMOUNT ("50000") can't send an outsized
    // gift card. The ceiling sits well above the $500 program so ordinary
    // changes to the reward still work untouched.
    const configured = Number(process.env.AFFILIATE_COMMISSION_AMOUNT ?? 500);
    const ceilingRaw = Number(process.env.AFFILIATE_COMMISSION_MAX ?? 1000);
    const ceiling = Number.isFinite(ceilingRaw) && ceilingRaw > 0 ? ceilingRaw : 1000;
    if (!Number.isFinite(configured) || configured <= 0) {
      console.error("[affiliates] invalid AFFILIATE_COMMISSION_AMOUNT:", process.env.AFFILIATE_COMMISSION_AMOUNT);
      return;
    }
    if (configured > ceiling) {
      console.error(
        `[affiliates] AFFILIATE_COMMISSION_AMOUNT ${configured} exceeds ceiling ${ceiling} — clamping. Check the env config.`
      );
    }
    const commission = Math.min(configured, ceiling);

    // Find the funded deal behind this vault.
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

    // 3. HOLD guardrails. Each of these records the payout row but does NOT send
    //    the gift — the reason lands on `error` and an admin releases it with the
    //    Retry control on /admin/affiliates. Nothing is silently lost; the money
    //    just needs a second human. Every hold pings Slack.
    const holds: string[] = [];

    // 3a. A pipeline status alone is not proof money moved — one staff account
    //     dragging a kanban card must not be able to manufacture a payout.
    if (!fundingDealId) {
      holds.push("No funded funding_deals row for this vault");
    }

    // 3b. Per-affiliate velocity: an unusual burst from one affiliate is the
    //     signature of an abused referral flow.
    const windowDays = numEnv("AFFILIATE_PAYOUT_WINDOW_DAYS", 30);
    const maxPerAffiliate = numEnv("AFFILIATE_MAX_PAYOUTS_PER_AFFILIATE", 10);
    const windowStart = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    const { count: recentForAffiliate } = await db
      .from("affiliate_payouts")
      .select("id", { count: "exact", head: true })
      .eq("affiliate_id", affiliate.id)
      .in("status", ["sent", "delivered"])
      .gte("created_at", windowStart);
    if ((recentForAffiliate ?? 0) >= maxPerAffiliate) {
      holds.push(
        `Affiliate hit the cap of ${maxPerAffiliate} payouts in ${windowDays} days (${recentForAffiliate} sent)`
      );
    }

    // 3c. Global daily spend: the backstop that bounds total damage from any
    //     abuse route we haven't thought of.
    const maxDaily = numEnv("AFFILIATE_MAX_DAILY_PAYOUT_TOTAL", 5000);
    const dayStart = new Date(Date.now() - 86_400_000).toISOString();
    const { data: todaysPayouts } = await db
      .from("affiliate_payouts")
      .select("commission_amount")
      .in("status", ["sent", "delivered"])
      .gte("created_at", dayStart);
    const spentToday = (todaysPayouts ?? []).reduce(
      (sum: number, r: { commission_amount: number | string | null }) =>
        sum + Number(r.commission_amount || 0),
      0
    );
    if (spentToday + commission > maxDaily) {
      holds.push(
        `Daily payout cap: $${spentToday} already sent in 24h, +$${commission} exceeds $${maxDaily}`
      );
    }

    const heldReason = holds.length ? `HELD: ${holds.join("; ")}` : null;

    // 4. Insert the payout row. UNIQUE(client_vault_id) dedupes: a duplicate
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
        error: heldReason,
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
    const affiliateLabel =
      [affiliate.first_name, affiliate.last_name].filter(Boolean).join(" ").trim() ||
      affiliate.email ||
      affiliate.id;

    // Held → leave the row `pending` with the reason, alert, and send nothing.
    if (heldReason) {
      console.warn(`[affiliates] payout ${payout.id} HELD for review: ${holds.join("; ")}`);
      await postAffiliateAlert(
        `:warning: *Affiliate payout held for review*\n` +
          `• Affiliate: ${affiliateLabel}\n` +
          `• Amount: $${commission}\n` +
          `• Vault: \`${clientVaultId}\`\n` +
          `• Reason: ${holds.join("; ")}\n` +
          `Release it from /admin/affiliates if it's legitimate.`
      );
      return;
    }

    if (!recipientEmail) {
      await db
        .from("affiliate_payouts")
        .update({ status: "failed", error: "Affiliate has no email on file", updated_at: nowIso })
        .eq("id", payout.id);
      return;
    }

    // 5. Send the gift via Giftronaut (idempotencyKey = payout id).
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
      await postAffiliateAlert(
        `:money_with_wings: *Affiliate payout sent*\n` +
          `• Affiliate: ${affiliateLabel}\n` +
          `• Amount: $${commission}\n` +
          `• Order: ${result.orderId ?? "(no id returned)"}\n` +
          `• Vault: \`${clientVaultId}\``
      );
    } catch (giftErr) {
      const giftErrMsg = giftErr instanceof Error ? giftErr.message : String(giftErr);
      console.error("[affiliates] Giftronaut send failed:", giftErr);
      await db
        .from("affiliate_payouts")
        .update({ status: "failed", error: giftErrMsg, updated_at: nowIso })
        .eq("id", payout.id);
      await postAffiliateAlert(
        `:x: *Affiliate payout FAILED*\n` +
          `• Affiliate: ${affiliateLabel}\n` +
          `• Amount: $${commission}\n` +
          `• Error: ${giftErrMsg}\n` +
          `Retry from /admin/affiliates.`
      );
      return; // admin can retry from the affiliates admin page
    }

    // 6. Notify the affiliate (in-app + email). Best-effort.
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
