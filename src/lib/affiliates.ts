import type { SupabaseClient } from "@supabase/supabase-js";
import { sendGiftCard, claimRewardLink, pollRewardLink } from "@/lib/giftronaut";
import {
  send_affiliate_payout_notification,
  send_affiliate_link_used_email,
} from "@/lib/email";
import { slackPostMessage } from "@/lib/slack-api";

/**
 * How the gift card reaches the affiliate.
 *
 *   "reward_link" — we order a link, Giftronaut emails nobody, and OUR funded
 *                   email carries the claim button. One email, our branding.
 *   anything else — the legacy choice-card order, which makes Giftronaut send
 *                   its own email on top of ours.
 *
 * Opt-in by env because the link path needs migration 20260818 (reward_link +
 * the 'awaiting_link' status). Unset, this file touches no new column.
 */
function rewardLinksEnabled(): boolean {
  return process.env.AFFILIATE_PAYOUT_MODE === "reward_link";
}

/**
 * How long a reward-link order may be polled inside one request before the row
 * is parked for the next worker pass. The money is already spent at that point;
 * this only bounds how long we hold the request open waiting for the URL.
 *
 * It matters more than it looks: the payout cron runs DAILY (Hobby-plan cron
 * limits — see the cron route), so a row that parks as 'awaiting_link' waits up
 * to 24h for its claim email. Now that our email IS the gift card, that wait is
 * the affiliate's wait. The caller therefore passes whatever is left of the
 * request's own budget, and this default only applies to callers that don't.
 */
function rewardLinkPollMs(budgetMs?: number): number {
  const fallback = numEnv("AFFILIATE_REWARD_LINK_POLL_MS", 45_000);
  if (budgetMs == null) return fallback;
  // Never below one poll interval — a 0ms budget would park every row.
  return Math.max(5_000, Math.min(budgetMs, numEnv("AFFILIATE_REWARD_LINK_POLL_MAX_MS", 240_000)));
}

/**
 * After this long, a paid-for order that still has no URL stops being "just
 * slow" and becomes something a human should look at. It is never re-ordered —
 * the charge exists — so the only escalation available is a hold.
 */
function rewardLinkStaleHours(): number {
  return numEnv("AFFILIATE_REWARD_LINK_STALE_HOURS", 72);
}

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
 * The reward figure QUOTED to an affiliate before anything is owed — same clamp
 * as the payout path below, because the two must never disagree in front of the
 * affiliate. Quoting only; nothing here spends money.
 */
function quotedRewardAmount(): string {
  const configured = Number(process.env.AFFILIATE_COMMISSION_AMOUNT ?? 500);
  const ceilingRaw = Number(process.env.AFFILIATE_COMMISSION_MAX ?? 1000);
  const ceiling = Number.isFinite(ceilingRaw) && ceilingRaw > 0 ? ceilingRaw : 1000;
  const amount = Math.min(
    Number.isFinite(configured) && configured > 0 ? configured : 500,
    ceiling
  );
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Tell the affiliate their link just produced a pre-qualified referral.
 *
 * TRIGGER: the moment /r/<code> accepts a QUALIFIED lead and the GHL contact is
 * created carrying that affiliate's tags. That creation is the milestone, and it
 * is the LAST one the affiliate is entitled to see — everything after it
 * (booking, documents, underwriting, the deal) is the client's private file.
 *
 * This used to fire on booking instead, from POST /api/webhooks/ghl-appointment.
 * Better milestone on paper, worthless in practice: it needed a GHL automation
 * to call us that was never wired, so `booked_at` is NULL on every row the
 * program has ever produced and not one affiliate was ever told their link
 * worked. Qualification is ours, in-process, and cannot silently stop firing.
 *
 * Once per lead by construction — the submit route reaches this only on a NEW
 * qualified row, and its duplicate guard means a resubmission never gets here.
 *
 * Best-effort and non-throwing: a captured lead is never lost over a mail
 * hiccup. Pass a SERVICE-ROLE client — `affiliates` and `in_app_notifications`
 * are both service-role-only under RLS, and a denial there fails SILENTLY.
 * See [[affiliate_program]], [[rls_client_writes_need_service_role]].
 */
export async function notifyAffiliateLinkUsed(
  db: SupabaseClient,
  args: { affiliateId: string; referralName: string }
): Promise<boolean> {
  const { affiliateId, referralName } = args;
  if (!affiliateId) return false;

  try {
    const { data: affiliate } = await db
      .from("affiliates")
      .select("id, first_name, last_name, email, user_id")
      .eq("id", affiliateId)
      .maybeSingle();

    if (!affiliate?.email) {
      console.warn(
        `[affiliates] affiliate ${affiliateId} has no email — link-used notice skipped`
      );
      return false;
    }

    const affiliateName =
      [affiliate.first_name, affiliate.last_name].filter(Boolean).join(" ").trim() || "there";
    const referral = referralName?.trim() || "Someone";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";

    await send_affiliate_link_used_email({
      affiliate_name: affiliateName,
      affiliate_email: affiliate.email,
      referral_name: referral,
      reward_amount: quotedRewardAmount(),
      dashboard_url: `${appUrl}/affiliate/dashboard`,
      terms_url: `${appUrl}/affiliate`,
    });

    // In-app, for affiliates who have a portal login. Separate try: the email is
    // the real delivery and has already landed by here, so a notification
    // failure must not report the whole thing as unsent.
    if (affiliate.user_id) {
      try {
        await db.from("in_app_notifications").insert({
          user_id: affiliate.user_id,
          title: "Someone used your link 👀",
          message: `${referral} pre-qualified through your affiliate link.`,
        });
      } catch (notifErr) {
        console.error("[affiliates] in-app link-used notice failed (non-fatal):", notifErr);
      }
    }

    console.log(`✅ [affiliates] affiliate ${affiliateId} notified — link used by ${referral}`);
    return true;
  } catch (err) {
    console.error("[affiliates] notifyAffiliateLinkUsed failed (non-fatal):", err);
    return false;
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
  opts: { admin?: boolean; actorLabel?: string; pollBudgetMs?: number } = {}
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
    // The order for this row is PLACED AND PAID; only its claim URL is missing.
    // Resume before every eligibility check below — those checks can cancel a
    // payout, and cancelling a charge we can't claw back would just mean the
    // affiliate never gets the card we already bought.
    if (payout.status === "awaiting_link") {
      return await resumeRewardLinkPayout(db, payout.id, who, opts.pollBudgetMs);
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
    // company_name/client_name ride along for the payout email, which names who
    // funded ("Dana Whitfield from Acme Coffee officially funded through Credit
    // Banc"). Both are passed separately — the email composes the phrase and
    // degrades on its own when either half is missing.
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
      // Reward-link path: Giftronaut mints a claim URL and emails nobody, so the
      // affiliate hears about this exactly once — from us, below.
      if (rewardLinksEnabled()) {
        const link = await claimRewardLink({
          amount: commission,
          idempotencyKey: payout.id,
          timeoutMs: rewardLinkPollMs(opts.pollBudgetMs),
        });

        // Money is spent from here on, link or no link.
        if (!link.rewardLink) {
          await db
            .from("affiliate_payouts")
            .update({
              status: "awaiting_link",
              giftronaut_order_id: link.orderId,
              giftronaut_status: link.status,
              error: null,
              hold_reason: null,
              // Stamped even though nobody has been emailed: it marks the moment
              // the charge happened, which is what the staleness check measures.
              sent_at: nowIso,
              updated_at: nowIso,
            })
            .eq("id", payout.id);

          console.warn(
            `[affiliates] payout ${payout.id} ordered (${link.orderId}) but the reward link is not minted yet — parked as awaiting_link`
          );
          await postAffiliateAlert(
            `:hourglass: *Affiliate reward link pending*\n` +
              `• Affiliate: ${affiliateLabel}\n` +
              `• Amount: $${commission}\n` +
              `• Order: ${link.orderId} (charged — do NOT re-send)\n` +
              `• The claim email goes out on the next worker pass, once Giftronaut mints the URL.`
          );
          return { outcome: "deferred", reason: `Reward link not minted yet (order ${link.orderId})` };
        }

        await db
          .from("affiliate_payouts")
          .update({
            status: "sent",
            giftronaut_order_id: link.orderId,
            giftronaut_status: link.status,
            reward_link: link.rewardLink,
            error: null,
            hold_reason: null,
            sent_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", payout.id);

        console.log(
          `[affiliates] payout ${payout.id} reward link ready by ${who}, order ${link.orderId}`
        );
        await postAffiliateAlert(
          `:money_with_wings: *Affiliate payout sent*\n` +
            `• Affiliate: ${affiliateLabel}\n` +
            `• Amount: $${commission}\n` +
            `• Order: ${link.orderId} (reward link — claim button is in our email)\n` +
            `• Vault: \`${payout.client_vault_id}\`\n` +
            `• Released by: ${who}`
        );

        await notifyAffiliateOfReward(db, {
          affiliate,
          recipientEmail,
          clientVaultId: payout.client_vault_id,
          commission,
          referralName: vault.client_name || null,
          referralCompany: vault.company_name || null,
          claimUrl: link.rewardLink,
        });

        return { outcome: "sent", orderId: link.orderId };
      }

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
        referralName: vault.client_name || null,
        referralCompany: vault.company_name || null,
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

type AwaitingLinkRow = {
  id: string;
  affiliate_id: string | null;
  client_vault_id: string | null;
  commission_amount: number | string | null;
  giftronaut_order_id: string | null;
  reward_link: string | null;
  sent_at: string | null;
};

/**
 * Finish a payout whose reward-link order exists but whose claim URL wasn't
 * minted before the placing request ran out of patience.
 *
 * This function NEVER orders anything — the charge already happened, and the URL
 * is a property of that order. It polls, stores the link, and sends our email.
 * Two consequences worth stating out loud:
 *
 *   - It must never cancel. Cancelling here would abandon a card we paid for.
 *     The worst outcome available is a hold, which still leaves an admin the
 *     link (re-fetchable from the order id).
 *   - The transition to 'sent' is a compare-and-swap on the status, so two
 *     overlapping passes can't both email the affiliate.
 *
 * Only reachable when status = 'awaiting_link', which only migration 20260818
 * makes possible — so the columns it reads are safe to select here.
 */
async function resumeRewardLinkPayout(
  db: SupabaseClient,
  payoutId: string,
  who: string,
  pollBudgetMs?: number
): Promise<PayoutOutcome> {
  const { data: row } = await db
    .from("affiliate_payouts")
    .select(
      "id, affiliate_id, client_vault_id, commission_amount, giftronaut_order_id, reward_link, sent_at"
    )
    .eq("id", payoutId)
    .maybeSingle<AwaitingLinkRow>();

  if (!row) return { outcome: "skipped", reason: "Payout not found" };

  const commission = Number(row.commission_amount || 0);
  const alertRow = (reason: string) =>
    `• Amount: $${commission}\n• Vault: \`${row.client_vault_id}\`\n• Reason: ${reason}`;

  if (!row.giftronaut_order_id) {
    // Unreachable through the code above — the order id is written in the same
    // update that sets 'awaiting_link'. If it ever happens there is nothing to
    // poll and nothing to re-order safely, so a human has to look at Giftronaut.
    const reason = "Awaiting a reward link but the row carries no Giftronaut order id";
    await db
      .from("affiliate_payouts")
      .update({ hold_reason: reason, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    await postAffiliateAlert(`:warning: *Affiliate payout stuck*\n${alertRow(reason)}`);
    return { outcome: "held", reason };
  }

  let link = row.reward_link ?? null;
  let orderStatus = "COMPLETE";

  if (!link) {
    try {
      const polled = await pollRewardLink(row.giftronaut_order_id, {
        timeoutMs: rewardLinkPollMs(pollBudgetMs),
      });
      link = polled.rewardLink;
      orderStatus = polled.status;
    } catch (pollErr) {
      // A terminal order status (CANCELED/FAILED) lands here. Money may or may
      // not have come back; either way it is an admin's call, not a retry.
      const reason = pollErr instanceof Error ? pollErr.message : String(pollErr);
      await db
        .from("affiliate_payouts")
        .update({ error: reason, hold_reason: reason, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      await postAffiliateAlert(`:x: *Affiliate reward link failed*\n${alertRow(reason)}`);
      return { outcome: "held", reason };
    }
  }

  if (!link) {
    const orderedAt = row.sent_at ? new Date(row.sent_at).getTime() : Date.now();
    const ageHours = (Date.now() - orderedAt) / 3_600_000;
    if (ageHours >= rewardLinkStaleHours()) {
      const reason =
        `Giftronaut order ${row.giftronaut_order_id} has had no reward link for ` +
        `${Math.floor(ageHours)}h — the charge exists, so check the order in their dashboard`;
      await db
        .from("affiliate_payouts")
        .update({ hold_reason: reason, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      await postAffiliateAlert(`:warning: *Affiliate reward link stale*\n${alertRow(reason)}`);
      return { outcome: "held", reason };
    }
    return {
      outcome: "deferred",
      reason: `Reward link still pending for order ${row.giftronaut_order_id}`,
    };
  }

  const nowIso = new Date().toISOString();
  const { data: claimed } = await db
    .from("affiliate_payouts")
    .update({
      status: "sent",
      reward_link: link,
      giftronaut_status: orderStatus,
      error: null,
      hold_reason: null,
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .eq("status", "awaiting_link")
    .select("id");

  if (!claimed?.length) {
    return { outcome: "skipped", reason: "Claimed by a concurrent run" };
  }

  const { data: affiliate } = await db
    .from("affiliates")
    .select("id, user_id, first_name, last_name, email, giftronaut_email")
    .eq("id", row.affiliate_id ?? "")
    .maybeSingle();
  const { data: vault } = await db
    .from("client_data_vault")
    .select("client_name, company_name")
    .eq("id", row.client_vault_id ?? "")
    .maybeSingle();

  const recipientEmail = affiliate?.giftronaut_email || affiliate?.email || null;
  if (affiliate && recipientEmail) {
    await notifyAffiliateOfReward(db, {
      affiliate,
      recipientEmail,
      clientVaultId: row.client_vault_id,
      commission,
      referralName: vault?.client_name || null,
      referralCompany: vault?.company_name || null,
      claimUrl: link,
    });
  } else {
    // The link exists and is paid for; only the delivery address is missing.
    await postAffiliateAlert(
      `:warning: *Reward link ready but undeliverable*\n` +
        alertRow("No email on file for the affiliate — send the claim link manually")
    );
  }

  console.log(
    `[affiliates] payout ${row.id} resumed by ${who} — reward link ready on order ${row.giftronaut_order_id}`
  );
  await postAffiliateAlert(
    `:money_with_wings: *Affiliate payout sent* (resumed)\n` +
      `• Amount: $${commission}\n` +
      `• Order: ${row.giftronaut_order_id}\n` +
      `• Vault: \`${row.client_vault_id}\`\n` +
      `• Released by: ${who}`
  );

  return { outcome: "sent", orderId: row.giftronaut_order_id };
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
    /** Contact at the referred business, for the "X officially funded" line. */
    referralName?: string | null;
    /** The referred business itself, for the same line. */
    referralCompany?: string | null;
    /**
     * Giftronaut reward-link claim URL, when the payout took the link path. Its
     * presence is what turns this email from "watch for a Giftronaut email" into
     * the delivery itself — see the email template. BEARER credential: it goes
     * to the affiliate's on-file address and nowhere else, never to a log.
     */
    claimUrl?: string | null;
  }
): Promise<void> {
  const {
    affiliate,
    recipientEmail,
    clientVaultId,
    commission,
    referralName,
    referralCompany,
    claimUrl,
  } = args;
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
        message: claimUrl
          ? `Your referral was funded — your ${rewardStr} gift card is ready to claim. Check your email.`
          : `Your referral was funded — a ${rewardStr} reward is on its way!`,
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
      referral_company: referralCompany ?? null,
      claim_url: claimUrl ?? null,
    });
  } catch (emailErr) {
    console.error("[affiliates] payout email failed (non-fatal):", emailErr);
  }
}
