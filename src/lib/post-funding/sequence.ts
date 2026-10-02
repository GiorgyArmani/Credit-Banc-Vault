// src/lib/post-funding/sequence.ts
//
// Runs the post-funding client email sequence: for each funded round, work out
// which step is due (steps.ts → nextAction) and send it. Called by
// /api/cron/post-funding-emails daily, and by fundLoanAction right after a
// round is marked funded so Email 1 goes out on the spot (a failed send there
// is retried by the cron within Email 1's 7-day window).
//
// WHICH ROUNDS RUN. One sequence per client at a time, on their most recent
// funding: a round only runs while it is
//   1. the NEWEST round on its business — a later round means the client came
//      back, and that round (once funded) starts a sequence of its own; and
//   2. the most recently funded round across the client's businesses — a
//      multi-business client must not get two sequences in parallel.
// Plus the client must have an email and not have unsubscribed.
//
// SEND IDEMPOTENCE. The post_funding_emails row is inserted BEFORE the send, as
// a claim: UNIQUE (funding_deal_id, step) means a cron run and the funding
// action racing on the same step can't both send it. A failed send deletes its
// claim so the next run retries. A crash between claim and send loses that one
// email rather than duplicating it — the right direction for client mail.
//
// Requires migration 20261002_post_funding_email_sequence.sql.

import type { SupabaseClient } from "@supabase/supabase-js";
import { send_post_funding_email } from "@/lib/email";
import { nextAction } from "./steps";
import { resolveSignature } from "./signatures";
import { unsubscribeUrls } from "./unsubscribe";

export interface PostFundingRunOptions {
  /** Resolve and report, send and record nothing. */
  dryRun?: boolean;
  /** "Now" for the schedule. Only honoured on a dry run (see the cron route). */
  asOf?: Date;
  onlyClientId?: string | null;
  onlyDealId?: string | null;
}

export interface PostFundingResult {
  dealId: string;
  clientVaultId?: string;
  clientName?: string;
  fundedAt: string;
  /** The step sent (or that would be, on a dry run). */
  step?: number;
  sent?: boolean;
  wouldSend?: boolean;
  /** Steps recorded as skipped this run — their windows had closed. */
  skipped?: number[];
  nextStep?: number;
  nextDueAt?: string;
  signer?: string;
  /** True when the advisor has no signature and Luigi signs instead. */
  signerIsFallback?: boolean;
  skipReason?: string;
  error?: string;
}

interface VaultRow {
  id: string;
  client_name: string | null;
  client_email: string | null;
  post_funding_unsubscribed_at: string | null;
  advisors: {
    email: string | null;
    is_external: boolean | null;
    referral_partner_id: string | null;
    external_advisor_id: string | null;
  } | null;
}

interface DealRow {
  id: string;
  business_profile_id: string;
  display_order: number | null;
  created_at: string;
  funded_at: string | null;
}

export async function runPostFundingSequence(
  db: SupabaseClient,
  opts: PostFundingRunOptions = {}
): Promise<PostFundingResult[]> {
  const dryRun = !!opts.dryRun;
  const now = dryRun && opts.asOf ? opts.asOf : new Date();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";

  const { data: fundedRaw, error: fundedErr } = await db
    .from("funding_deals")
    .select("id, business_profile_id, display_order, created_at, funded_at")
    .not("funded_at", "is", null);
  if (fundedErr) throw new Error(`load funded deals: ${fundedErr.message}`);
  const funded = (fundedRaw ?? []) as DealRow[];
  if (!funded.length) return [];

  const businessIds = Array.from(new Set(funded.map((d) => d.business_profile_id)));

  // Every round on those businesses (funded or not) → the newest per business.
  const { data: siblingsRaw, error: sibErr } = await db
    .from("funding_deals")
    .select("id, business_profile_id, display_order, created_at")
    .in("business_profile_id", businessIds);
  if (sibErr) throw new Error(`load sibling deals: ${sibErr.message}`);
  const newestOnBusiness = new Map<string, DealRow>();
  for (const d of (siblingsRaw ?? []) as DealRow[]) {
    const cur = newestOnBusiness.get(d.business_profile_id);
    const newer =
      !cur ||
      (d.display_order ?? 0) > (cur.display_order ?? 0) ||
      ((d.display_order ?? 0) === (cur.display_order ?? 0) && Date.parse(d.created_at) > Date.parse(cur.created_at));
    if (newer) newestOnBusiness.set(d.business_profile_id, d);
  }

  const { data: businesses, error: bizErr } = await db
    .from("business_profiles")
    .select("id, client_vault_id")
    .in("id", businessIds);
  if (bizErr) throw new Error(`load businesses: ${bizErr.message}`);
  const vaultOfBusiness = new Map((businesses ?? []).map((b) => [b.id, b.client_vault_id as string | null]));

  // Most recently funded round per client vault.
  const latestFundedInVault = new Map<string, DealRow>();
  for (const d of funded) {
    const vaultId = vaultOfBusiness.get(d.business_profile_id);
    if (!vaultId) continue;
    const cur = latestFundedInVault.get(vaultId);
    if (!cur || Date.parse(d.funded_at!) > Date.parse(cur.funded_at!)) latestFundedInVault.set(vaultId, d);
  }

  const vaultIds = Array.from(latestFundedInVault.keys());
  const { data: vaults, error: vaultErr } = vaultIds.length
    ? await db
        .from("client_data_vault")
        .select(
          "id, client_name, client_email, post_funding_unsubscribed_at, " +
            "advisors!client_data_vault_advisor_id_fkey(email, is_external, referral_partner_id, external_advisor_id)"
        )
        .in("id", vaultIds)
    : { data: [], error: null };
  if (vaultErr) throw new Error(`load vaults: ${vaultErr.message}`);
  const vaultMap = new Map(((vaults ?? []) as unknown as VaultRow[]).map((v) => [v.id, v]));

  const fundedIds = funded.map((d) => d.id);
  const { data: logRows, error: logErr } = await db
    .from("post_funding_emails")
    .select("funding_deal_id, step")
    .in("funding_deal_id", fundedIds);
  if (logErr) throw new Error(`load post_funding_emails: ${logErr.message}`);
  const recordedByDeal = new Map<string, Set<number>>();
  for (const r of logRows ?? []) {
    const set = recordedByDeal.get(r.funding_deal_id) ?? new Set<number>();
    set.add(r.step);
    recordedByDeal.set(r.funding_deal_id, set);
  }

  const results: PostFundingResult[] = [];

  for (const deal of funded) {
    if (opts.onlyDealId && deal.id !== opts.onlyDealId) continue;
    const vaultId = vaultOfBusiness.get(deal.business_profile_id) ?? undefined;
    if (opts.onlyClientId && vaultId !== opts.onlyClientId) continue;

    const result: PostFundingResult = { dealId: deal.id, clientVaultId: vaultId, fundedAt: deal.funded_at! };
    results.push(result);

    try {
      if (!vaultId) {
        result.skipReason = "business_or_vault_missing";
        continue;
      }
      if (newestOnBusiness.get(deal.business_profile_id)?.id !== deal.id) {
        result.skipReason = "superseded_by_newer_round";
        continue;
      }
      if (latestFundedInVault.get(vaultId)?.id !== deal.id) {
        result.skipReason = "superseded_by_later_funding";
        continue;
      }
      const vault = vaultMap.get(vaultId);
      if (!vault) {
        result.skipReason = "vault_missing";
        continue;
      }
      result.clientName = vault.client_name ?? undefined;
      if (vault.post_funding_unsubscribed_at) {
        result.skipReason = "unsubscribed";
        continue;
      }
      const clientEmail = String(vault.client_email ?? "").trim();
      if (!clientEmail.includes("@")) {
        result.skipReason = "no_client_email";
        continue;
      }

      const action = nextAction(new Date(deal.funded_at!), recordedByDeal.get(deal.id) ?? new Set(), now);
      if (action.skip.length) result.skipped = action.skip;

      if (!dryRun && action.skip.length) {
        const { error: skipErr } = await db.from("post_funding_emails").upsert(
          action.skip.map((step) => ({
            funding_deal_id: deal.id,
            client_vault_id: vaultId,
            step,
            status: "skipped",
          })),
          { onConflict: "funding_deal_id,step", ignoreDuplicates: true }
        );
        if (skipErr) throw new Error(`record skipped steps: ${skipErr.message}`);
      }

      if (action.kind === "done") {
        result.skipReason = "sequence_complete";
        continue;
      }
      if (action.kind === "wait") {
        result.skipReason = "not_due";
        result.nextStep = action.step;
        result.nextDueAt = action.dueAt.toISOString();
        continue;
      }

      result.step = action.step;
      const advisorEmail: string | null = vault.advisors?.email ?? null;
      // External = any partner-side advisor (flagged, a referral partner's deal
      // desk, or a Partner+ desk). Their clients always hear from Luigi.
      const adv = vault.advisors;
      const advisorIsExternal = !!(adv?.is_external || adv?.referral_partner_id || adv?.external_advisor_id);
      const { signature, isFallback } = resolveSignature(advisorEmail, { isExternal: advisorIsExternal });
      result.signer = signature.name;
      result.signerIsFallback = isFallback;

      if (dryRun) {
        result.wouldSend = true;
        continue;
      }

      // Claim the step, then send. See SEND IDEMPOTENCE above.
      const { error: claimErr } = await db.from("post_funding_emails").insert({
        funding_deal_id: deal.id,
        client_vault_id: vaultId,
        step: action.step,
        status: "sent",
        recipient_email: clientEmail,
        signer_email: signature.replyTo,
      });
      if (claimErr) {
        if (claimErr.code === "23505") {
          result.skipReason = "claimed_by_concurrent_run";
          continue;
        }
        throw new Error(`claim step ${action.step}: ${claimErr.message}`);
      }

      try {
        const unsub = unsubscribeUrls(vaultId, appUrl);
        await send_post_funding_email({
          step: action.step,
          client_name: vault.client_name ?? "",
          client_email: clientEmail,
          advisor_email: advisorEmail,
          advisor_is_external: advisorIsExternal,
          unsubscribe_url: unsub.page,
          one_click_unsubscribe_url: unsub.oneClick,
        });
        result.sent = true;
      } catch (sendErr) {
        await db.from("post_funding_emails").delete().eq("funding_deal_id", deal.id).eq("step", action.step);
        throw sendErr;
      }
    } catch (err) {
      console.error(`[post-funding] deal ${deal.id} failed:`, err);
      result.error = err instanceof Error ? err.message : "unknown";
    }
  }

  return results;
}
