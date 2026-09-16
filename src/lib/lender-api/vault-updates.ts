// src/lib/lender-api/vault-updates.ts
//
// Writes review-panel corrections back to the vault (decision: fix data at the
// source). Input MUST already be normalized by normalizeVaultUpdates — that
// allow-list is the security boundary for what staff can write here.

import type { AdminClient } from "./source";
import type { LenderApiSource } from "./types";
import type { VaultField } from "./vault-fields";

// NOT NULL columns on client_data_vault: a cleared value is ignored, not written.
const NOT_NULL = new Set<VaultField>(["owner_1_name", "client_phone", "company_state", "company_zip_code"]);
const BUSINESS_ADDRESS = new Set<VaultField>(["company_city", "company_state", "company_zip_code"]);

export const PRIMARY_ONLY_FIELDS_ERROR = "Business street and EIN can only be edited on the primary business.";

export type VaultUpdatePlan =
  | { ok: true; vault: Record<string, string | null>; business: Record<string, string | null> }
  | { ok: false; error: string };

/**
 * Where each correction goes. Primary business: everything to the vault, the
 * address mirrored to its business row. Any other business: its address goes
 * ONLY to its own business row (the vault's address is the primary's), owner
 * fields still go to the vault, and street/EIN are refused — the vault holds
 * just one of each and it belongs to the primary business.
 */
export function planVaultUpdates(
  updates: Partial<Record<VaultField, string | null>>,
  isPrimary: boolean
): VaultUpdatePlan {
  if (!isPrimary && ("business_street" in updates || "ein" in updates)) {
    return { ok: false, error: PRIMARY_ONLY_FIELDS_ERROR };
  }

  const vault: Record<string, string | null> = {};
  const business: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(updates) as Array<[VaultField, string | null]>) {
    if (value === null && NOT_NULL.has(key)) continue;
    const isAddress = BUSINESS_ADDRESS.has(key);
    if (isPrimary || !isAddress) vault[key] = value;
    if (isAddress) business[key] = value;
  }
  return { ok: true, vault, business };
}

export async function applyVaultUpdates(
  admin: AdminClient,
  source: LenderApiSource,
  updates: Partial<Record<VaultField, string | null>>
): Promise<{ error: string | null; httpStatus?: number }> {
  const isPrimary = !source.business || source.business.is_primary;
  const plan = planVaultUpdates(updates, isPrimary);
  if (!plan.ok) return { error: plan.error, httpStatus: 400 };

  const now = new Date().toISOString();
  if (Object.keys(plan.vault).length > 0) {
    const { error } = await admin
      .from("client_data_vault")
      .update({ ...plan.vault, updated_at: now })
      .eq("id", source.vault.id);
    if (error) {
      console.error("applyVaultUpdates vault error:", error.message);
      return { error: "Could not save the client's details." };
    }
  }

  const businessId = isPrimary ? source.assignment.business_profile_id : source.business!.id;
  if (businessId && Object.keys(plan.business).length > 0) {
    const { error: bErr } = await admin
      .from("business_profiles")
      .update({ ...plan.business, updated_at: now })
      .eq("id", businessId);
    if (bErr) {
      console.error("applyVaultUpdates business error:", bErr.message);
      // Primary: non-fatal, the vault row is the source the engine reads first.
      // Any other business: its row is the only place the address lives.
      if (!isPrimary) return { error: "Could not save the business's details." };
    }
  }

  return { error: null };
}
