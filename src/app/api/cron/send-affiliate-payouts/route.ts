// src/app/api/cron/send-affiliate-payouts/route.ts
//
// The affiliate payout worker — the only automated thing that spends money.
//
// A `funded` pipeline transition does not create a gift card any more; it only
// enqueues an affiliate_payouts row with `release_at` = now + 24h (see
// createAffiliatePayoutForFundedVault). This job picks up rows whose gate has
// passed and hands each to processAffiliatePayout — which re-verifies the deal
// is STILL funded before ordering anything. A deal un-funded inside the window
// is canceled here rather than paid.
//
// CADENCE: registered DAILY in vercel.json (`0 17 * * *`). Vercel's Hobby plan
// rejects anything more frequent at deploy time, so the schedule is written to
// the lowest common denominator. The consequence is latency, never a premature
// send: `release_at` is still a hard floor, so the real wait is 24h to ~48h
// depending on where a deal's funding lands relative to the daily run. Moving to
// hourly (`15 * * * *`) needs no code change — only the plan and vercel.json.
//
// It deliberately does NOT re-derive eligibility itself. Every rule lives in
// lib/affiliates.ts so the cron path and the admin release control cannot drift
// apart on who gets paid.
//
// Auth mirrors the other crons (Bearer CRON_SECRET), with one difference: this
// route spends real money, so the development bypass only covers ?dry=1. A live
// send always needs the secret, on every environment.
//
// Query params:
//   ?dry=1            list what WOULD send; touches nothing.
//   ?payoutId=<uuid>  restrict to one row (targeted re-run after a fix).
//
// See [[affiliate_program]], [[slack_uw_channels]].

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretsMatch } from "@/lib/secret-compare";
import { processAffiliatePayout, maxSendAttempts, type PayoutOutcome } from "@/lib/affiliates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Rows handled per run. Bounds both wall-clock and blast radius. Anything over
 * the limit waits for the next run — a full day at the current cadence — so this
 * sits well above any plausible daily volume for a $500-per-funded-deal program.
 */
const BATCH_SIZE = 50;

/**
 * How long a failed row waits before the worker retries it. Below the current
 * daily cadence, so in practice every failure gets exactly one retry per run;
 * it becomes the real bound only if the schedule tightens.
 */
const RETRY_BACKOFF_MINUTES = 60;

/**
 * Slack left at the end of `maxDuration` for the DB writes, Slack alerts and the
 * response after the last poll. Without it a run that waits to the last second
 * gets killed mid-update, leaving a paid order with no row to prove it.
 */
const RESERVE_SECONDS = 45;

function hasCronSecret(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/send-affiliate-payouts] CRON_SECRET is not set in env");
    return false;
  }
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return secretsMatch(token, expected);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const onlyPayoutId = url.searchParams.get("payoutId");

  // Local dev may inspect the queue without the secret, but may never spend.
  const authorized =
    hasCronSecret(req) || (dryRun && process.env.NODE_ENV === "development");
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const db = createAdminClient();

  // Due = past its release gate, not held for an admin, not already resolved.
  // Failed rows come back after a backoff; processAffiliatePayout enforces the
  // attempt cap, so a permanently broken row stops retrying on its own.
  const backoffCutoff = new Date(
    startedAt.getTime() - RETRY_BACKOFF_MINUTES * 60_000
  ).toISOString();

  let query = db
    .from("affiliate_payouts")
    .select("id, client_vault_id, commission_amount, status, release_at, attempts")
    // 'awaiting_link' rows are already PAID: their reward-link order exists and
    // only its claim URL is still being minted. They come back here so the
    // worker can finish the job (poll + send our email) — never to re-order.
    .in("status", ["queued", "pending", "failed", "awaiting_link"])
    .is("hold_reason", null)
    .lt("attempts", maxSendAttempts())
    .lte("release_at", startedAt.toISOString())
    .or(`last_attempt_at.is.null,last_attempt_at.lt.${backoffCutoff}`)
    .order("release_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (onlyPayoutId) query = query.eq("id", onlyPayoutId);

  const { data: due, error } = await query;

  if (error) {
    console.error("[cron/send-affiliate-payouts] queue read failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!due?.length) {
    return NextResponse.json({
      ok: true,
      dryRun,
      ranAt: startedAt.toISOString(),
      due: 0,
      sent: 0,
    });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      ranAt: startedAt.toISOString(),
      due: due.length,
      wouldProcess: due.map((p) => ({
        payoutId: p.id,
        clientVaultId: p.client_vault_id,
        amount: Number(p.commission_amount || 0),
        status: p.status,
        releaseAt: p.release_at,
        attempts: p.attempts,
      })),
    });
  }

  // Sequential on purpose: these are money orders against a third-party API, and
  // the daily-spend cap inside processAffiliatePayout reads what has already been
  // sent. Running them in parallel would let a batch race past that ceiling.
  //
  // The budget below is about the reward-link path specifically. Those orders
  // are asynchronous: the charge lands immediately but the claim URL is minted
  // by a background job on Giftronaut's side, and our email can't go out until
  // it exists. Whatever is left of this request is spent waiting for it, because
  // the alternative — parking the row — means the affiliate waits until the NEXT
  // daily run for a card that was already paid for. Rows that run out of budget
  // still park safely as 'awaiting_link'; nothing is ever double-ordered.
  const deadline = startedAt.getTime() + (maxDuration - RESERVE_SECONDS) * 1000;
  const results: Array<{ payoutId: string } & PayoutOutcome> = [];
  for (const p of due) {
    const outcome = await processAffiliatePayout(db, p.id, {
      actorLabel: "cron",
      pollBudgetMs: Math.max(0, deadline - Date.now()),
    });
    results.push({ payoutId: p.id, ...outcome });
  }

  const tally = (o: PayoutOutcome["outcome"]) => results.filter((r) => r.outcome === o).length;
  const summary = {
    ok: true,
    dryRun: false,
    ranAt: startedAt.toISOString(),
    due: due.length,
    sent: tally("sent"),
    canceled: tally("canceled"),
    held: tally("held"),
    deferred: tally("deferred"),
    skipped: tally("skipped"),
    failed: tally("failed"),
    results,
  };

  console.log(
    `[cron/send-affiliate-payouts] due=${summary.due} sent=${summary.sent} canceled=${summary.canceled} held=${summary.held} failed=${summary.failed}`
  );

  return NextResponse.json(summary);
}
