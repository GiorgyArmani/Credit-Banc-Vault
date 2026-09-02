// src/lib/funding-deals.ts
//
// One place that answers "which funding_deals row is this business working on?".
//
// Before this helper, six call sites each inlined
//   select id from funding_deals where business_profile_id = X
//     order by display_order asc limit 1
// i.e. "the OLDEST deal" — which was correct only while every business had
// exactly one. The moment a client comes back for a second round that lookup
// resolves to the funded round and UPDATEs it, destroying round 1's
// funded_amount / lender_funded / funded_term / funded_at. The only durable
// trace left was the free-text LOAN FUNDED DETAILS internal note.
//
// The active deal is now the NEWEST round (highest display_order). On existing
// data — one deal per business, all at display_order 0 — newest and oldest are
// the same row, so switching call sites over is a no-op until a second round is
// actually created.
//
// Every function takes the service-role client explicitly (same shape as
// createAffiliatePayoutForFundedVault): funding_deals is reached through
// business_profiles, and the callers are already admin-client server actions.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Columns every caller needs. Kept in one string so shapes don't drift. */
export const FUNDING_DEAL_COLUMNS =
  "id, business_profile_id, display_order, created_at, " +
  "capital_requested, proposed_loan_type, loan_purpose, funding_eta, " +
  "contract_completed, contract_completed_at, contract_url, signwell_envelope_id, " +
  "loan_product_type, lender_funded, funded_amount, funded_term, funded_at, " +
  "sales_rep_funded, date_of_submission, file_synopsis, use_of_proceeds, slack_channel";

export interface FundingDeal {
  id: string;
  business_profile_id: string;
  display_order: number | null;
  created_at: string;
  capital_requested: number | null;
  proposed_loan_type: string | null;
  loan_purpose: string | null;
  funding_eta: string | null;
  contract_completed: boolean | null;
  contract_completed_at: string | null;
  contract_url: string | null;
  signwell_envelope_id: string | null;
  loan_product_type: string | null;
  lender_funded: string | null;
  funded_amount: number | null;
  funded_term: string | null;
  funded_at: string | null;
  sales_rep_funded: string | null;
  date_of_submission: string | null;
  file_synopsis: string | null;
  use_of_proceeds: string | null;
  slack_channel: string | null;
}

/** True once UW has recorded the funded figures — the round is closed. */
export function isDealFunded(deal: Pick<FundingDeal, "funded_at"> | null): boolean {
  return !!deal?.funded_at;
}

/**
 * Every round for a business, newest first. Round number = position from the
 * end, so the oldest row is "Round 1".
 */
export async function getDealsForBusiness(
  db: SupabaseClient,
  businessProfileId: string
): Promise<FundingDeal[]> {
  const { data, error } = await db
    .from("funding_deals")
    .select(FUNDING_DEAL_COLUMNS)
    .eq("business_profile_id", businessProfileId)
    .order("display_order", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getDealsForBusiness error:", error);
    return [];
  }
  return (data ?? []) as unknown as FundingDeal[];
}

/**
 * The round currently being worked: the newest one. Note this can be a FUNDED
 * deal — callers that are about to write funded figures must check
 * isDealFunded() and open a new round rather than overwriting.
 */
export async function getActiveDeal(
  db: SupabaseClient,
  businessProfileId: string
): Promise<FundingDeal | null> {
  const { data, error } = await db
    .from("funding_deals")
    .select(FUNDING_DEAL_COLUMNS)
    .eq("business_profile_id", businessProfileId)
    .order("display_order", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getActiveDeal error:", error);
    return null;
  }
  return (data ?? null) as unknown as FundingDeal | null;
}

/**
 * The active deal, creating an empty one if the business has none. For writers
 * (contract sync, funding-ask edits) that need a row to hang data on. Does NOT
 * open a new round when the existing deal is funded — see startNewFundingRound.
 */
export async function getOrCreateActiveDeal(
  db: SupabaseClient,
  businessProfileId: string,
  defaults: Partial<FundingDeal> = {}
): Promise<FundingDeal | null> {
  const existing = await getActiveDeal(db, businessProfileId);
  if (existing) return existing;

  const { data, error } = await db
    .from("funding_deals")
    .insert({ business_profile_id: businessProfileId, display_order: 0, ...defaults })
    .select(FUNDING_DEAL_COLUMNS)
    .single();

  if (error) {
    console.error("getOrCreateActiveDeal insert error:", error);
    return null;
  }
  return data as unknown as FundingDeal;
}

/**
 * Open the next funding round for a business — the repeat-financing entry point.
 *
 * The new row starts with NULL funded figures (that is the whole point: round
 * N-1 keeps its outcome) and inherits the application fields as defaults, since
 * a renewal is usually the same product with a new amount. `overrides` wins over
 * the inherited values.
 *
 * Returns the previous deal too, so callers can carry documents forward and
 * label the round without re-querying.
 */
export async function startNewFundingRound(
  db: SupabaseClient,
  businessProfileId: string,
  overrides: Partial<
    Pick<FundingDeal, "capital_requested" | "proposed_loan_type" | "loan_purpose" | "funding_eta">
  > = {}
): Promise<{ deal: FundingDeal; previous: FundingDeal | null } | { deal: null; error: string }> {
  const deals = await getDealsForBusiness(db, businessProfileId);
  const previous = deals[0] ?? null;

  // display_order is the round sequence. Existing rows are all 0, so the first
  // new round lands at 1 and reads as "Round 2" — matching its position.
  const nextOrder = deals.reduce((max, d) => Math.max(max, d.display_order ?? 0), -1) + 1;

  const inherited = {
    capital_requested: previous?.capital_requested ?? null,
    proposed_loan_type: previous?.proposed_loan_type ?? null,
    loan_purpose: previous?.loan_purpose ?? null,
    funding_eta: null as string | null,
  };

  const { data, error } = await db
    .from("funding_deals")
    .insert({
      business_profile_id: businessProfileId,
      display_order: nextOrder,
      ...inherited,
      ...overrides,
    })
    .select(FUNDING_DEAL_COLUMNS)
    .single();

  if (error || !data) {
    console.error("startNewFundingRound insert error:", error);
    return { deal: null, error: error?.message || "Failed to create the funding round" };
  }

  return { deal: data as unknown as FundingDeal, previous };
}

/**
 * The round being worked for a CLIENT, when the caller has a vault id and no
 * business in hand (the admin lender-review path).
 *
 * Resolves the primary business first, falling back to the oldest — the same
 * order the client pages use to pick a default tab, so a lender added from the
 * admin surface lands on the round the rest of the app calls active. Returns
 * nulls rather than throwing: attributing a lender row to a round is an
 * improvement on NULL, never a reason to fail the add.
 */
export async function getActiveDealForClient(
  db: SupabaseClient,
  clientVaultId: string
): Promise<{ businessProfileId: string | null; deal: FundingDeal | null }> {
  const { data: businesses, error } = await db
    .from("business_profiles")
    .select("id, is_primary, created_at")
    .eq("client_vault_id", clientVaultId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error || !businesses?.length) {
    if (error) console.error("getActiveDealForClient business lookup:", error);
    return { businessProfileId: null, deal: null };
  }

  const businessProfileId = businesses[0].id as string;
  return { businessProfileId, deal: await getActiveDeal(db, businessProfileId) };
}

/**
 * Human label for a round — "Round 3" — derived from position in the ordered
 * list rather than stored, so it stays correct if a round is ever deleted.
 */
export function roundNumber(deals: FundingDeal[], dealId: string): number {
  // deals arrive newest-first; round 1 is the last element.
  const idx = deals.findIndex((d) => d.id === dealId);
  return idx === -1 ? deals.length : deals.length - idx;
}
