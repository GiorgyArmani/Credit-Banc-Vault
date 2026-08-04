import type { SupabaseClient } from "@supabase/supabase-js";
import { sendGiftCard } from "@/lib/giftronaut";
import { send_affiliate_payout_notification } from "@/lib/email";
import { slackPostMessage } from "@/lib/slack-api";

/**
 * Roles whose `funded` transition is allowed to trigger a real payout. Mirrors
 * FUNDED_ROLES in app/actions/pipeline.ts — keep the two in sync.
 */
const PAYOUT_ACTOR_ROLES = new Set(["admin", "underwriting", "advisor"]);

/**
 * Pipeline statuses that mean the deal is NOT funded. If the file's latest
 * status is one of these when the gift card is due to be created, the funded
 * mark was reverted inside the waiting window and the payout is canceled.
 *
 * `funded` and `consulting_program` are deliberately absent: a funded client
 * moving into the consulting program is still a funded client.
 */
const UNFUNDED_STATUSES = new Set([
  "created",
  "onboarding",
  "documents_requested",
  "documents_received",
  "under_review",
  "lender_matched",
  "declined",
]);

/** Read a positive number from env, falling back when unset or unparseable. */
function numEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * How long a queued payout waits before the gift card may be created. This is
 * the recovery window: real money leaves the building at the end of it, so a
 * mis-clicked "Funded" or a reversed deal can still be caught. Mirrored by the
 * DB default on affiliate_payouts.release_at.
 */
function payoutDelayHours(): number {
  return numEnv("AFFILIATE_PAYOUT_DELAY_HOURS", 24);
}

/** Send attempts the worker makes before leaving the row to an admin. */
export function maxSendAttempts(): number {
  return numEnv("AFFILIATE_PAYOUT_MAX_ATTEMPTS", 3);
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
 * Link a newly-created client vault back to the affiliate lead that produced it,
 * so affiliate attribution survives from the public pre-qualification flow all
 * the way to a funded deal.
 *
 * Called at the end of every vault-creation path. Matches an unconverted
 * `affiliate_leads` row by GHL contact id first (most reliable — the referral
 * already created the GHL contact), then by email. On a match it:
 *   - marks the lead `converted` and stamps `converted_vault_id`,
 *   - stamps `client_data_vault.affiliate_lead_id` (the funded-payout hook walks
 *     this), and mirrors the affiliate name onto `referral_partner` for the
 *     existing client-profile UI.
 *
 * Best-effort and non-throwing: attribution must never break signup. Pass a
 * SERVICE-ROLE client (affiliate_leads is RLS-locked to service role).
 * See [[ghl_integration_contract]], [[role_model]].
 */
export async function linkAffiliateLeadToVault(
  db: SupabaseClient,
  args: { vaultId: string; email?: string | null; ghlContactId?: string | null }
): Promise<void> {
  const { vaultId, email, ghlContactId } = args;
  if (!vaultId) return;

  try {
    let lead: { id: string; affiliate_id: string | null } | null = null;

    if (ghlContactId) {
      const { data } = await db
        .from("affiliate_leads")
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
        .from("affiliate_leads")
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
      .from("affiliate_leads")
      .update({ status: "converted", converted_vault_id: vaultId, updated_at: nowIso })
      .eq("id", lead.id);

    // Attribution lives ONLY on affiliate_lead_id — this is the public affiliate
    // program. We deliberately do NOT touch client_data_vault.referral_partner /
    // GHL AFFILIATE_ASSIGNED: those belong to the separate internal
    // referral-partner program and must not be overwritten.
    await db
      .from("client_data_vault")
      .update({ affiliate_lead_id: lead.id })
      .eq("id", vaultId);
  } catch (err) {
    console.error("[affiliates] linkAffiliateLeadToVault failed (non-fatal):", err);
  }
}

/**
 * QUEUE the affiliate's reward when a referred vault reaches `funded`. Called
 * from the pipeline `funded` transition, and the ONLY thing that ever enqueues a
 * payout — no other event creates one.
 *
 * This does not create the gift card. It writes a `queued` affiliate_payouts row
 * with `release_at` = now + AFFILIATE_PAYOUT_DELAY_HOURS (24h), and the cron
 * worker (/api/cron/send-affiliate-payouts) calls processAffiliatePayout once
 * that passes — re-verifying the deal is still funded at that moment. A funded
 * mark reverted inside the window never becomes a gift card.
 *
 * Idempotent and non-throwing:
 *   - no-op unless the vault carries an affiliate_lead_id (i.e. it's a referral),
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
      .select("id, affiliate_lead_id, user_id, client_email")
      .eq("id", clientVaultId)
      .maybeSingle();
    if (!vault?.affiliate_lead_id) return;

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
      .from("affiliate_leads")
      .select("id, affiliate_id")
      .eq("id", vault.affiliate_lead_id)
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
        affiliate_lead_id: lead.id,
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

    // 3. HOLD guardrails. Each of these still records the payout row, but stamps
    //    `hold_reason` so the worker will never auto-send it — an admin releases
    //    it with the control on /admin/affiliates. Nothing is silently lost; the
    //    money just needs a second human. Every hold pings Slack.
    //
    //    The global daily-spend cap is NOT checked here: the spend happens 24h
    //    from now, so it is evaluated at send time where it can defer rather
    //    than permanently hold.
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

    const heldReason = holds.length ? holds.join("; ") : null;

    // 4. Insert the QUEUED payout row. UNIQUE(client_vault_id) dedupes: a
    //    duplicate funded event hits the conflict and we stop (no second gift).
    //    release_at is the 24h gate — the worker will not look at this row
    //    before it, and the column carries a matching DB default.
    const releaseAt = new Date(Date.now() + payoutDelayHours() * 3_600_000);
    const { data: payout, error: insertErr } = await db
      .from("affiliate_payouts")
      .insert({
        affiliate_id: affiliate.id,
        affiliate_lead_id: lead.id,
        client_vault_id: clientVaultId,
        funding_deal_id: fundingDealId,
        commission_amount: commission,
        status: "queued",
        release_at: releaseAt.toISOString(),
        hold_reason: heldReason,
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

    const affiliateLabel = labelAffiliate(affiliate);

    // 5. Announce it. Nothing is sent here — the worker owns that — so the alert
    //    says WHEN the money will move, which is the whole point of the gate:
    //    there is still time to cancel it from /admin/affiliates.
    if (heldReason) {
      console.warn(`[affiliates] payout ${payout.id} HELD for review: ${heldReason}`);
      await postAffiliateAlert(
        `:warning: *Affiliate payout held for review*\n` +
          `• Affiliate: ${affiliateLabel}\n` +
          `• Amount: $${commission}\n` +
          `• Vault: \`${clientVaultId}\`\n` +
          `• Reason: ${heldReason}\n` +
          `It will NOT send automatically. Release it from /admin/affiliates if it's legitimate.`
      );
      return;
    }

    console.log(
      `[affiliates] payout ${payout.id} queued for ${releaseAt.toISOString()} (vault ${clientVaultId})`
    );
    await postAffiliateAlert(
      `:hourglass_flowing_sand: *Affiliate payout queued*\n` +
        `• Affiliate: ${affiliateLabel}\n` +
        `• Amount: $${commission}\n` +
        `• Vault: \`${clientVaultId}\`\n` +
        `• Sends: ${releaseAt.toUTCString()} (in ${payoutDelayHours()}h)\n` +
        `Cancel it from /admin/affiliates before then if this deal didn't fund.`
    );
  } catch (err) {
    console.error("[affiliates] createAffiliatePayoutForFundedVault failed (non-fatal):", err);
  }
}

/** Human-readable affiliate name for logs and Slack. */
function labelAffiliate(a: {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  return [a.first_name, a.last_name].filter(Boolean).join(" ").trim() || a.email || a.id;
}

/** What processAffiliatePayout did with a row. */
export type PayoutOutcome =
  | { outcome: "sent"; orderId: string | null }
  /** Not due, already resolved, held, or claimed by a concurrent run. */
  | { outcome: "skipped"; reason: string }
  /** Transient block (daily spend cap) — release_at was pushed out, retry later. */
  | { outcome: "deferred"; reason: string }
  /** A guardrail now needs an admin decision; the worker won't touch it again. */
  | { outcome: "held"; reason: string }
  /** Terminal: the deal is no longer a payable funded referral. */
  | { outcome: "canceled"; reason: string }
  | { outcome: "failed"; error: string };

type PayoutRow = {
  id: string;
  affiliate_id: string | null;
  affiliate_lead_id: string | null;
  client_vault_id: string | null;
  commission_amount: number | string | null;
  status: string;
  hold_reason: string | null;
  release_at: string;
  attempts: number;
};

/**
 * Create the gift card for one queued payout — the ONLY place that spends money
 * on the affiliate program. Called by the cron worker for due rows, and by the
 * admin release/retry control.
 *
 * Everything checked at queue time is re-checked HERE, against the state of the
 * world 24h later, because that is what the waiting window is for. In
 * particular: the file must still be marked funded and still carry a funded
 * funding_deals row. If the funded mark was reverted the payout is canceled, not
 * paid.
 *
 * Concurrency: the row is claimed with a compare-and-swap on `attempts`, so two
 * overlapping cron runs can never both send. Giftronaut's idempotency key
 * (= payout id) is the second line of defence.
 *
 * `admin: true` bypasses the 24h gate, an existing hold and the attempt cap —
 * that is a human deliberately overriding — but NEVER the funded re-verification.
 * Pass a SERVICE-ROLE client. Non-throwing.
 */
export async function processAffiliatePayout(
  db: SupabaseClient,
  payoutId: string,
  opts: { admin?: boolean; actorLabel?: string } = {}
): Promise<PayoutOutcome> {
  const admin = opts.admin === true;
  const who = opts.actorLabel ?? (admin ? "admin" : "cron");

  try {
    const { data: payout } = await db
      .from("affiliate_payouts")
      .select(
        "id, affiliate_id, affiliate_lead_id, client_vault_id, commission_amount, status, hold_reason, release_at, attempts"
      )
      .eq("id", payoutId)
      .maybeSingle<PayoutRow>();

    if (!payout) return { outcome: "skipped", reason: "Payout not found" };
    if (payout.status === "sent" || payout.status === "delivered") {
      return { outcome: "skipped", reason: "Already sent" };
    }
    if (payout.status === "canceled") {
      return { outcome: "skipped", reason: "Payout was canceled" };
    }
    if (payout.hold_reason && !admin) {
      return { outcome: "skipped", reason: `Held: ${payout.hold_reason}` };
    }
    if (!admin && new Date(payout.release_at).getTime() > Date.now()) {
      return { outcome: "skipped", reason: `Not due until ${payout.release_at}` };
    }
    if (!admin && payout.attempts >= maxSendAttempts()) {
      return { outcome: "skipped", reason: `Exhausted ${payout.attempts} send attempts` };
    }

    const commission = Number(payout.commission_amount || 0);
    if (!Number.isFinite(commission) || commission <= 0) {
      return await holdPayout(db, payout, "Payout has no valid commission amount");
    }

    // Both FKs are nullable in the schema. A row missing either can't be
    // verified against a funded deal, so it can never be paid automatically.
    if (!payout.client_vault_id || !payout.affiliate_id) {
      return await holdPayout(db, payout, "Payout is missing its vault or affiliate link");
    }

    // --- Re-verify the deal, 24h on. ---------------------------------------
    // company_name/client_name ride along for the payout email, which names the
    // business that funded ("Acme Coffee officially funded through Credit Banc").
    const { data: vault } = await db
      .from("client_data_vault")
      .select("id, affiliate_lead_id, user_id, client_email, company_name, client_name")
      .eq("id", payout.client_vault_id)
      .maybeSingle();

    if (!vault) {
      return await cancelPayout(db, payout, "Client vault no longer exists");
    }
    if (vault.affiliate_lead_id !== payout.affiliate_lead_id) {
      return await cancelPayout(db, payout, "Referral attribution was removed from this vault");
    }

    // The funded mark itself. The latest pipeline entry is the live answer: if
    // the file was dragged back out of Funded during the window, this is where
    // we find out — and the gift card is never created.
    const { data: latest } = await db
      .from("loan_status_history")
      .select("status, changed_by_role, created_at")
      .eq("client_vault_id", payout.client_vault_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      return await cancelPayout(db, payout, "No pipeline history for this file");
    }
    if (UNFUNDED_STATUSES.has(latest.status)) {
      return await cancelPayout(
        db,
        payout,
        `Deal is no longer funded — pipeline moved to "${latest.status}" inside the review window`
      );
    }

    // Whoever recorded funded must still be staff (defence in depth, same rule
    // as queue time).
    const { data: fundedEntry } = await db
      .from("loan_status_history")
      .select("changed_by_role")
      .eq("client_vault_id", payout.client_vault_id)
      .eq("status", "funded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!fundedEntry || !PAYOUT_ACTOR_ROLES.has(fundedEntry.changed_by_role ?? "")) {
      return await cancelPayout(
        db,
        payout,
        `No staff-recorded funded transition (actor: ${fundedEntry?.changed_by_role ?? "none"})`
      );
    }

    // The money-truth row behind the status. recordPipelineTransition refuses a
    // funded transition without it, so its absence means it was cleared after
    // the fact — that needs a human, not an automatic $500.
    const { data: fundedDeal } = await db
      .from("funding_deals")
      .select("id, business_profiles!inner(client_vault_id)")
      .eq("business_profiles.client_vault_id", payout.client_vault_id)
      .not("funded_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (!fundedDeal?.id && !admin) {
      return await holdPayout(db, payout, "No funded funding_deals row for this vault");
    }

    // --- Re-verify the affiliate. ------------------------------------------
    const { data: affiliate } = await db
      .from("affiliates")
      .select("id, user_id, first_name, last_name, email, giftronaut_email, status")
      .eq("id", payout.affiliate_id)
      .maybeSingle();

    if (!affiliate) {
      return await cancelPayout(db, payout, "Affiliate record no longer exists");
    }
    if (affiliate.status !== "active" && !admin) {
      return await holdPayout(db, payout, `Affiliate is ${affiliate.status}`);
    }

    const affiliateEmail = affiliate.email?.trim().toLowerCase() || null;
    const vaultEmail = vault.client_email?.trim().toLowerCase() || null;
    if (
      (!!affiliate.user_id && !!vault.user_id && affiliate.user_id === vault.user_id) ||
      (!!affiliateEmail && !!vaultEmail && affiliateEmail === vaultEmail)
    ) {
      return await cancelPayout(db, payout, "Self-referral — affiliate matches the referred client");
    }

    const recipientEmail = affiliate.giftronaut_email || affiliate.email;
    if (!recipientEmail) {
      return await holdPayout(db, payout, "Affiliate has no email on file");
    }

    // --- Global daily spend cap. -------------------------------------------
    // Transient by nature, so it DEFERS rather than holds: push release_at out
    // an hour and the worker picks the row up again once the window clears.
    const maxDaily = numEnv("AFFILIATE_MAX_DAILY_PAYOUT_TOTAL", 5000);
    const dayStart = new Date(Date.now() - 86_400_000).toISOString();
    const { data: recentSends } = await db
      .from("affiliate_payouts")
      .select("commission_amount")
      .in("status", ["sent", "delivered"])
      .gte("sent_at", dayStart);
    const spentToday = (recentSends ?? []).reduce(
      (sum: number, r: { commission_amount: number | string | null }) =>
        sum + Number(r.commission_amount || 0),
      0
    );
    if (spentToday + commission > maxDaily && !admin) {
      const reason = `Daily payout cap: $${spentToday} sent in 24h, +$${commission} exceeds $${maxDaily}`;
      const nextIso = new Date(Date.now() + 3_600_000).toISOString();
      await db
        .from("affiliate_payouts")
        .update({ release_at: nextIso, updated_at: new Date().toISOString() })
        .eq("id", payout.id);
      console.warn(`[affiliates] payout ${payout.id} deferred to ${nextIso}: ${reason}`);
      return { outcome: "deferred", reason };
    }

    // --- Claim the row, then spend. ----------------------------------------
    // Compare-and-swap on `attempts`: whoever wins this update owns the send.
    // A loser (overlapping cron run, double-clicked admin button) backs off.
    const claimIso = new Date().toISOString();
    const { data: claimed } = await db
      .from("affiliate_payouts")
      .update({
        attempts: payout.attempts + 1,
        last_attempt_at: claimIso,
        updated_at: claimIso,
      })
      .eq("id", payout.id)
      .eq("attempts", payout.attempts)
      .in("status", ["queued", "pending", "failed"])
      .select("id");

    if (!claimed?.length) {
      return { outcome: "skipped", reason: "Claimed by a concurrent run" };
    }

    const affiliateLabel = labelAffiliate(affiliate);
    const nowIso = new Date().toISOString();

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
          hold_reason: null,
          sent_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", payout.id);

      console.log(`[affiliates] payout ${payout.id} sent by ${who}, order ${result.orderId}`);
      await postAffiliateAlert(
        `:money_with_wings: *Affiliate payout sent*\n` +
          `• Affiliate: ${affiliateLabel}\n` +
          `• Amount: $${commission}\n` +
          `• Order: ${result.orderId ?? "(no id returned)"}\n` +
          `• Vault: \`${payout.client_vault_id}\`\n` +
          `• Released by: ${who}`
      );

      await notifyAffiliateOfReward(db, {
        affiliate,
        recipientEmail,
        clientVaultId: payout.client_vault_id,
        commission,
        referralName: vault.company_name || vault.client_name || null,
      });

      return { outcome: "sent", orderId: result.orderId };
    } catch (giftErr) {
      const giftErrMsg = giftErr instanceof Error ? giftErr.message : String(giftErr);
      console.error(`[affiliates] Giftronaut send failed for payout ${payout.id}:`, giftErr);
      const attemptsUsed = payout.attempts + 1;
      const exhausted = attemptsUsed >= maxSendAttempts();
      // On the last attempt, park the row for an admin. Without this the worker
      // keeps re-reading a permanently broken payout every hour and — because
      // the queue is drained oldest-first — starves newly due ones.
      await db
        .from("affiliate_payouts")
        .update({
          status: "failed",
          error: giftErrMsg,
          hold_reason: exhausted
            ? `Giftronaut send failed ${attemptsUsed}× — needs an admin`
            : null,
          updated_at: nowIso,
        })
        .eq("id", payout.id);
      await postAffiliateAlert(
        `:x: *Affiliate payout FAILED* (attempt ${attemptsUsed}/${maxSendAttempts()})\n` +
          `• Affiliate: ${affiliateLabel}\n` +
          `• Amount: $${commission}\n` +
          `• Error: ${giftErrMsg}\n` +
          (exhausted ? `No further automatic retries — retry from /admin/affiliates.` : `Will retry automatically.`)
      );
      return { outcome: "failed", error: giftErrMsg };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[affiliates] processAffiliatePayout(${payoutId}) failed (non-fatal):`, err);
    return { outcome: "failed", error: msg };
  }
}

/** Terminal refusal: record why, alert, and never look at the row again. */
async function cancelPayout(
  db: SupabaseClient,
  payout: PayoutRow,
  reason: string
): Promise<PayoutOutcome> {
  console.warn(`[affiliates] payout ${payout.id} CANCELED: ${reason}`);
  await db
    .from("affiliate_payouts")
    .update({
      status: "canceled",
      hold_reason: null,
      error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payout.id);
  await postAffiliateAlert(
    `:no_entry: *Affiliate payout canceled — no gift card was created*\n` +
      `• Amount: $${Number(payout.commission_amount || 0)}\n` +
      `• Vault: \`${payout.client_vault_id}\`\n` +
      `• Reason: ${reason}`
  );
  return { outcome: "canceled", reason };
}

/** Park the row for an admin decision; the worker skips held rows. */
async function holdPayout(
  db: SupabaseClient,
  payout: PayoutRow,
  reason: string
): Promise<PayoutOutcome> {
  console.warn(`[affiliates] payout ${payout.id} HELD: ${reason}`);
  await db
    .from("affiliate_payouts")
    .update({ hold_reason: reason, updated_at: new Date().toISOString() })
    .eq("id", payout.id);
  await postAffiliateAlert(
    `:warning: *Affiliate payout held at send time*\n` +
      `• Amount: $${Number(payout.commission_amount || 0)}\n` +
      `• Vault: \`${payout.client_vault_id}\`\n` +
      `• Reason: ${reason}\n` +
      `It will NOT send automatically. Review it on /admin/affiliates.`
  );
  return { outcome: "held", reason };
}

/**
 * Tell the affiliate their reward is on its way. Deliberately fired only AFTER
 * the card is ordered — a queued payout can still be canceled, and promising
 * money that then evaporates is worse than telling them a day late.
 */
async function notifyAffiliateOfReward(
  db: SupabaseClient,
  args: {
    affiliate: { user_id?: string | null; first_name?: string | null; last_name?: string | null };
    recipientEmail: string;
    clientVaultId: string | null;
    commission: number;
    /** Referred business (or contact) name, for the "X officially funded" line. */
    referralName?: string | null;
  }
): Promise<void> {
  const { affiliate, recipientEmail, clientVaultId, commission, referralName } = args;
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
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
    await send_affiliate_payout_notification({
      affiliate_name:
        [affiliate.first_name, affiliate.last_name].filter(Boolean).join(" ").trim() || "there",
      affiliate_email: recipientEmail,
      reward_amount: rewardStr,
      login_url: `${appUrl}/affiliate/dashboard`,
      referral_name: referralName ?? null,
    });
  } catch (emailErr) {
    console.error("[affiliates] payout email failed (non-fatal):", emailErr);
  }
}
