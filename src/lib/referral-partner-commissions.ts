// src/lib/referral-partner-commissions.ts
//
// The Level-2 referral-partner earnings ledger.
//
// A row is recorded the moment a referred deal funds, even though the
// commission percentage is still under commercial discussion — an unpriced row
// (amount NULL) is recoverable later; a funding event we never recorded is not.
// Once a rate is agreed, backfilling amounts is a single UPDATE over rows that
// already carry the funded figures.
//
// NOTHING here is shown to partners yet. The portal deliberately renders
// referrals and pipeline progress only; surfacing dollars is a UI change on top
// of this data, not another migration. See [[affiliate_program]] for the
// separate, already-live affiliate reward (flat gift card, different table,
// different program — the two never cross-write).
//
// Every function takes a SERVICE-ROLE client and is non-throwing: a ledger
// failure must never block a funding transition.

import type { SupabaseClient } from "@supabase/supabase-js";

export type CommissionType = "percent" | "flat";

/**
 * Compute a commission from a partner's configured rate.
 * Returns null when the rate isn't set, or when a percent rate has no funded
 * amount to apply to — both mean "we cannot price this yet", which is exactly
 * what a NULL amount records.
 */
export function computeCommission(args: {
  commissionType: CommissionType | null | undefined;
  commissionValue: number | null | undefined;
  fundedAmount: number | null | undefined;
}): number | null {
  const { commissionType, commissionValue, fundedAmount } = args;
  if (!commissionType || commissionValue === null || commissionValue === undefined) {
    return null;
  }
  if (commissionType === "flat") {
    return Number(commissionValue);
  }
  if (fundedAmount === null || fundedAmount === undefined || !Number.isFinite(Number(fundedAmount))) {
    return null;
  }
  // Stored as a percentage (5 = 5%), matching how the admin UI collects it.
  return Math.round(Number(fundedAmount) * (Number(commissionValue) / 100) * 100) / 100;
}

/**
 * Record the commission owed on a vault that just funded.
 *
 * Idempotent: the (client_vault_id, funding_deal_id) unique index with NULLS NOT
 * DISTINCT means a repeat transition can't double-book, and a 23505 is treated
 * as success. Repeat borrowers DO earn per funded round — that is the deliberate
 * difference from affiliate_payouts, which pays once per vault.
 */
export async function createPartnerCommissionForFundedVault(
  db: SupabaseClient,
  clientVaultId: string,
  fundingDealId: string | null = null
): Promise<void> {
  try {
    const { data: vault, error: vaultErr } = await db
      .from("client_data_vault")
      .select("id, referral_partner_id")
      .eq("id", clientVaultId)
      .maybeSingle();

    if (vaultErr) {
      console.error("[partner-commission] vault read failed:", vaultErr);
      return;
    }
    // No partner on this deal — the overwhelmingly common case. Nothing owed.
    if (!vault?.referral_partner_id) return;

    const { data: partner, error: partnerErr } = await db
      .from("referral_partners")
      .select("id, name, commission_type, commission_value")
      .eq("id", vault.referral_partner_id)
      .maybeSingle();

    if (partnerErr || !partner) {
      console.error("[partner-commission] partner read failed:", partnerErr);
      return;
    }

    // Resolve the funded round so the ledger snapshots a real amount. When the
    // caller names a round we trust it; otherwise take the newest funded round
    // on this vault ([[repeat_funding_overwrites_first_deal]] — newest, never
    // oldest).
    let dealId: string | null = fundingDealId;
    let fundedAmount: number | null = null;

    if (dealId) {
      const { data: deal } = await db
        .from("funding_deals")
        .select("id, funded_amount")
        .eq("id", dealId)
        .maybeSingle();
      fundedAmount = deal?.funded_amount ?? null;
    } else {
      const { data: deal } = await db
        .from("funding_deals")
        .select("id, funded_amount, funded_at, business_profiles!inner(client_vault_id)")
        .eq("business_profiles.client_vault_id", clientVaultId)
        .not("funded_at", "is", null)
        .order("funded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      dealId = deal?.id ?? null;
      fundedAmount = deal?.funded_amount ?? null;
    }

    const commissionType = (partner.commission_type as CommissionType | null) ?? null;
    const commissionValue =
      partner.commission_value === null || partner.commission_value === undefined
        ? null
        : Number(partner.commission_value);

    const amount = computeCommission({ commissionType, commissionValue, fundedAmount });

    const { error: insertErr } = await db.from("referral_partner_commissions").insert({
      referral_partner_id: partner.id,
      client_vault_id: clientVaultId,
      funding_deal_id: dealId,
      funded_amount: fundedAmount,
      // Snapshot the rate as agreed AT FUNDING TIME — re-deriving it later would
      // silently reprice history whenever a partner renegotiates.
      commission_type: commissionType,
      commission_value: commissionValue,
      amount,
      status: "pending",
      note: amount === null ? "Awaiting commission rate" : null,
    });

    if (insertErr) {
      // 23505 = already recorded for this round. That's the dedupe working.
      if (insertErr.code === "23505") return;
      // 42P01 / 42703 = migration 20260807 not applied on this environment yet.
      // Log and move on rather than blocking the funding transition
      // ([[refactor_alongside_production]]).
      console.error("[partner-commission] insert failed (non-fatal):", insertErr);
      return;
    }

    console.log(
      `[partner-commission] recorded for ${partner.name} on vault ${clientVaultId}` +
        (amount === null ? " (unpriced — no rate configured)" : ` — ${amount}`)
    );
  } catch (err) {
    console.error("[partner-commission] threw (non-fatal):", err);
  }
}
