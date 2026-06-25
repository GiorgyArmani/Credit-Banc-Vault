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
  // The real funded amount stamped onto funding_deals by UW's Loan Funded flow,
  // aggregated per vault. Preferred when present; otherwise we fall back to the
  // requested amount so historical deals (funded before this column was written)
  // still register on the KPI.
  funding_deal_amount?: number | string | null
}

function to_finite_number(raw: number | string | null | undefined): number | null {
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

export function compute_funded_amount(inputs: FundedAmountInputs): number {
  const funded = to_finite_number(inputs.funding_deal_amount)
  if (funded != null) return funded

  const v = inputs.vault
  if (!v) return 0
  return to_finite_number(v.capital_requested) ?? 0
}
