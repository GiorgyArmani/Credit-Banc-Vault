// src/app/admin/dashboard/_lib/funded-amount.ts
//
// Single source of truth for "how much was this deal funded for?" on the admin
// dashboard. Today the field lives on client_data_vault.capital_requested. After
// the funding_deals refactor lands in production, UW will stamp the actual
// funded amount onto funding_deals.funded_amount per deal — at that point swap
// the implementation here and every funded-$ KPI follows.
//
// Keep this function input-shape stable: callers pass the vault row (and later
// optionally the matching funding_deal row), and we return a numeric dollar
// amount. Returning 0 for missing data is intentional — the dashboard tiles
// already render $0 gracefully.

export interface FundedAmountInputs {
  vault: { capital_requested: number | string | null | undefined } | undefined
  // Reserved for when funding_deals is populated in prod:
  //   funding_deal?: { funded_amount: number | string | null }
}

export function compute_funded_amount(inputs: FundedAmountInputs): number {
  const v = inputs.vault
  if (!v) return 0
  const raw = v.capital_requested
  if (raw == null) return 0
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : 0
}
