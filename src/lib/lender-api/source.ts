// src/lib/lender-api/source.ts
//
// Loads everything a provider maps from, scoped to the assignment's business
// and funding round. One loader for every lender, so providers never query.

import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveDeal } from "@/lib/funding-deals";
import type { LenderApiSource, SourceBusiness, SourceDeal } from "./types";
import { resolveVaultFields, scopeResolvedToBusiness, VAULT_SOURCE_COLUMNS, type SourceVault } from "./vault-fields";

export type AdminClient = ReturnType<typeof createAdminClient>;

const BUSINESS_COLUMNS =
  "id, is_primary, business_name, company_name, legal_entity_type, industry, business_start_date, phone, company_city, company_state, company_zip_code, avg_monthly_deposits";
const DEAL_COLUMNS = "id, capital_requested, loan_purpose, file_synopsis";

export async function loadLenderApiSource(
  admin: AdminClient,
  assignmentId: string
): Promise<LenderApiSource | null> {
  const { data: assignment, error: aErr } = await admin
    .from("client_lender_assignments")
    .select("id, client_id, business_profile_id, funding_deal_id, lender_name, specialty, decision, admin_review, status")
    .eq("id", assignmentId)
    .maybeSingle();
  if (aErr) console.error("loadLenderApiSource assignment error:", aErr.message);
  if (!assignment) return null;

  const { data: vault, error: vErr } = await admin
    .from("client_data_vault")
    .select(VAULT_SOURCE_COLUMNS)
    .eq("id", assignment.client_id)
    .maybeSingle();
  if (vErr) console.error("loadLenderApiSource vault error:", vErr.message);
  if (!vault) return null;

  // The client's primary business, in the order the rest of the app uses.
  const { data: primary } = await admin
    .from("business_profiles")
    .select("id")
    .eq("client_vault_id", assignment.client_id)
    .order("is_primary", { ascending: false })
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Legacy assignments carry no business id: fall back to the primary business.
  const businessId: string | null = assignment.business_profile_id ?? primary?.id ?? null;

  const businessRow = businessId
    ? (((await admin.from("business_profiles").select(BUSINESS_COLUMNS).eq("id", businessId).maybeSingle()).data ??
        null) as SourceBusiness | null)
    : null;
  // is_primary defaults to false and older vaults may have no row flagged: the
  // first business in the canonical order is the one the vault's business
  // columns describe, so it must not be treated as a second business.
  const business: SourceBusiness | null = businessRow
    ? { ...businessRow, is_primary: businessRow.is_primary === true || businessRow.id === primary?.id }
    : null;

  // The round this assignment belongs to; NULL = legacy → the newest round.
  let dealId: string | null = assignment.funding_deal_id ?? null;
  if (!dealId && businessId) dealId = (await getActiveDeal(admin, businessId))?.id ?? null;
  const deal = dealId
    ? (((await admin.from("funding_deals").select(DEAL_COLUMNS).eq("id", dealId).maybeSingle()).data ??
        null) as SourceDeal | null)
    : null;

  let analysisQuery = admin
    .from("bank_analysis_results")
    .select("avg_revenue, avg_monthly_deposits, fico, total_neg_days, has_bankruptcy, accounts_data, created_at")
    .eq("client_id", assignment.client_id);
  if (deal) {
    analysisQuery = analysisQuery.eq("funding_deal_id", deal.id);
  } else if (businessId) {
    // No deal to scope by: fall back to this business explicitly, but still
    // allow NULL business_profile_id rows — those are legacy analyses run
    // before multi-business existed, so they cannot belong to a sibling
    // business and are safe (indeed correct) to attach here.
    analysisQuery = analysisQuery.or(`business_profile_id.eq.${businessId},business_profile_id.is.null`);
  }
  const { data: analysis } = await analysisQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { data: positions } = await admin
    .from("client_open_positions")
    .select("lender_name, current_balance, payment_amount, payment_frequency, business_profile_id")
    .eq("client_vault_id", assignment.client_id);

  const typedVault = vault as unknown as SourceVault;

  return {
    assignment: { ...assignment, business_profile_id: businessId, funding_deal_id: deal?.id ?? null },
    vault: typedVault,
    // A second business never inherits the primary's street, EIN or address.
    resolved: scopeResolvedToBusiness(resolveVaultFields(typedVault), business),
    business,
    deal,
    analysis: analysis ?? null,
    openPositions: (positions ?? [])
      .filter((p: any) => !p.business_profile_id || p.business_profile_id === businessId)
      .map((p: any) => ({
        lender_name: p.lender_name,
        current_balance: p.current_balance,
        payment_amount: p.payment_amount,
        payment_frequency: p.payment_frequency,
      })),
  };
}
