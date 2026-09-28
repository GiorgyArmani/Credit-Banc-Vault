// src/lib/owners.ts
//
// The ONE place owner data is read and written (server-only).
//
// Owner 1 lives on client_data_vault (owner_1_*, ssn, home_address) — five
// lenders, both contract flows and onboarding read those columns. Owners 2–5
// live in business_owners (one list per CLIENT, shared by every business),
// with full data. Every save also rewrites the legacy owner_N_name /
// owner_N_ownership_pct + number_of_owners vault columns, which Lender Match,
// the UW page, bank analysis, Forward Financing and GHL still read.
//
// business_owners is service-role only (RLS on, no policies) and holds SSNs:
// callers hand the browser maskOwner() output, never a StoredOwner.

import type { createAdminClient } from "@/lib/supabase/admin";
import type { SourceOwner } from "@/lib/lender-api/types";
import { digitsOnly, nonEmpty, toIsoDate, toStateCode, toZip5 } from "@/lib/lender-api/normalize";
import { resolveVaultFields, type SourceVault } from "@/lib/lender-api/vault-fields";
import { phoneKey } from "@/lib/phone";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface OwnerInput {
  position: number;
  full_name: string;
  ownership_pct: number;
  dob?: string | null;
  ssn?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface Owner1Input {
  ownership_pct?: number | null;
  dob?: string | null;
  ssn?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export type MaskedOwner = Omit<SourceOwner, "ssn"> & { ssn_last4: string | null };

const POSITIONS = [2, 3, 4, 5] as const;
const TABLE = "business_owners";
const COLUMNS = "position, full_name, ownership_pct, dob, ssn, street, city, state, zip, email, phone";

/** Table missing (migration not applied): PostgREST schema cache or Postgres undefined_table. */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /could not find the table|does not exist/i.test(error.message ?? "");
}

export function validateOwners(owner1Pct: number | null, owners: OwnerInput[]): string[] {
  const errors: string[] = [];
  // Owner 1: null means "keep the stored share" (callers resolve it first). An
  // explicit non-finite value (NaN from a direct server call) is bad input.
  let o1 = 0;
  if (owner1Pct !== null && owner1Pct !== undefined) {
    const n1 = Number(owner1Pct);
    if (!Number.isFinite(n1)) {
      errors.push("Owner 1: ownership % is required.");
    } else {
      o1 = n1;
      if (!(n1 >= 0 && n1 <= 100)) errors.push("Owner 1: ownership must be 0–100%.");
    }
  }
  // Non-finite (null/undefined/NaN) shares are ignored here — they get their
  // own "ownership % is required" error per-owner below, and must never let a
  // NaN leak into the share-total arithmetic or its message.
  const total =
    o1 +
    owners.reduce((sum, o) => {
      const n = Number(o.ownership_pct);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  if (total > 100) errors.push(`Ownership adds up to ${total}% — it can't pass 100%.`);
  const seen = new Set<number>();
  for (const o of owners) {
    if (!(POSITIONS as readonly number[]).includes(o.position)) {
      errors.push(`Owner position ${o.position} is outside 2–5.`);
      continue;
    }
    if (seen.has(o.position)) errors.push(`Owner ${o.position} is listed twice.`);
    seen.add(o.position);
    const n = `Owner ${o.position}`;
    if (!nonEmpty(o.full_name)) errors.push(`${n}: name is required.`);
    const pct = Number(o.ownership_pct);
    if (o.ownership_pct === null || o.ownership_pct === undefined || !Number.isFinite(pct)) {
      // A blank/NaN share must never pass silently as 0%.
      errors.push(`${n}: ownership % is required.`);
    } else if (!(pct >= 0 && pct <= 100)) {
      errors.push(`${n}: ownership must be 0–100%.`);
    }
    if (nonEmpty(o.ssn) && digitsOnly(o.ssn).length !== 9) errors.push(`${n}: SSN must be 9 digits.`);
    if (nonEmpty(o.dob) && !toIsoDate(o.dob)) errors.push(`${n}: date of birth is not a valid date.`);
    if (nonEmpty(o.state) && !(/^[A-Za-z]{2}$/.test((o.state as string).trim()) && toStateCode(o.state))) {
      errors.push(`${n}: state must be a 2-letter code.`);
    }
    if (nonEmpty(o.zip) && !toZip5(o.zip)) errors.push(`${n}: zip must be 5 digits.`);
    if (nonEmpty(o.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email as string)) errors.push(`${n}: email is not valid.`);
    if (nonEmpty(o.phone) && !normalizeOwnerPhone(o.phone)) errors.push(`${n}: phone must be 10 digits.`);
  }
  return errors;
}

/** A co-owner phone as stored: 10 digits (a leading US 1 dropped), or null when blank/partial. */
export function normalizeOwnerPhone(raw: string | null | undefined): string | null {
  return phoneKey(raw) || null;
}

type LegacyOwnerVault = Partial<Record<`owner_${2 | 3 | 4 | 5}_${"name" | "ownership_pct"}`, unknown>>;
export type OwnerDraft = Omit<MaskedOwner, "ownership_pct"> & { ownership_pct: number | null };

/**
 * Co-owners that exist ONLY on the legacy vault columns (owner_N_name set, no
 * business_owners row — e.g. signup's owner save failed). Returned as drafts
 * so the editor shows them and the next save keeps them instead of clearing
 * the legacy columns. A missing share stays null so the editor flags it.
 */
export function legacyOwnerDrafts(vault: LegacyOwnerVault, owners: Array<{ position: number }>): OwnerDraft[] {
  const drafts: OwnerDraft[] = [];
  for (const p of POSITIONS) {
    const name = nonEmpty(vault[`owner_${p}_name`]);
    if (!name || owners.some((o) => o.position === p)) continue;
    const rawPct = vault[`owner_${p}_ownership_pct`];
    const pct = rawPct === null || rawPct === undefined || rawPct === "" ? NaN : Number(rawPct);
    drafts.push({
      position: p,
      full_name: name,
      ownership_pct: Number.isFinite(pct) ? pct : null,
      dob: null,
      street: null,
      city: null,
      state: null,
      zip: null,
      email: null,
      phone: null,
      ssn_last4: null,
    });
  }
  return drafts;
}

export function planLegacyOwnerColumns(
  owners: Array<{ position: number; full_name: string; ownership_pct: number }>
): Record<string, string | number | null> {
  const plan: Record<string, string | number | null> = {};
  for (const p of POSITIONS) {
    const o = owners.find((x) => x.position === p);
    plan[`owner_${p}_name`] = o ? o.full_name.trim() : null;
    plan[`owner_${p}_ownership_pct`] = o ? Number(o.ownership_pct) : null;
  }
  plan.number_of_owners = owners.length > 0 ? "More than one" : "One";
  return plan;
}

export function mergeSsn(input: string | null | undefined, stored: string | null): string | null {
  const d = digitsOnly(input);
  return d ? d : stored;
}

export function maskOwner(o: SourceOwner): MaskedOwner {
  const { ssn, ...rest } = o;
  const d = digitsOnly(ssn);
  return { ...rest, ssn_last4: d.length === 9 ? d.slice(-4) : null };
}

function toStored(row: Record<string, unknown>): SourceOwner {
  return {
    position: Number(row.position),
    full_name: String(row.full_name ?? ""),
    ownership_pct: Number(row.ownership_pct ?? 0),
    dob: (row.dob as string | null) ?? null,
    ssn: (row.ssn as string | null) ?? null,
    street: (row.street as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    zip: (row.zip as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
  };
}

export async function loadClientOwners(admin: AdminClient, vaultId: string): Promise<{ available: boolean; owners: SourceOwner[] }> {
  const { data, error } = await admin.from(TABLE).select(COLUMNS).eq("client_vault_id", vaultId).order("position");
  if (error) {
    if (!isMissingTable(error)) console.error("loadClientOwners error:", error.message);
    return { available: false, owners: [] };
  }
  return { available: true, owners: (data ?? []).map((r) => toStored(r as Record<string, unknown>)) };
}

function composeAddress(street: string | null, city: string | null, state: string | null, zip: string | null): string | null {
  const tail = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, tail].filter(Boolean).join(", ") || null;
}

export interface Owner1Stored {
  ssn: string | null;
  owner_1_street: string | null;
  owner_1_city: string | null;
  owner_1_state: string | null;
  owner_1_zip: string | null;
  /** Free text written by onboarding; the structured columns are often NULL. */
  home_address?: string | null;
}

export interface Owner1Address {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/**
 * Owner 1's home address as every lender sees it: the structured owner_1_*
 * column when set, else that field parsed from the free-text home_address
 * (it IS resolveVaultFields, so the editor and the lender mappings agree).
 */
export function resolveOwner1Address(stored: Owner1Stored): Owner1Address {
  const { values } = resolveVaultFields({
    owner_1_street: stored.owner_1_street,
    owner_1_city: stored.owner_1_city,
    owner_1_state: stored.owner_1_state,
    owner_1_zip: stored.owner_1_zip,
    home_address: stored.home_address ?? null,
  } as unknown as SourceVault);
  return {
    street: values.owner_1_street,
    city: values.owner_1_city,
    state: values.owner_1_state,
    zip: values.owner_1_zip,
  };
}

/**
 * Pure computation of the owner-1 vault-update fields. A field left
 * `undefined` on the input keeps its stored value (address fields are merged,
 * not wholesale-replaced, so a street-only edit can't null out city/state/zip);
 * an explicit `""` or `null` clears it. "Stored" for the address means the
 * RESOLVED address (structured columns, else parsed home_address), and address
 * keys are written only when the merged address actually differs from it — so
 * a save that didn't touch the address (e.g. an onboarded client whose
 * structured columns are NULL) never erases home_address.
 */
export function planOwner1Update(input: Owner1Input, stored: Owner1Stored): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (input.ownership_pct != null) update.owner_1_ownership_pct = input.ownership_pct;
  if (input.dob !== undefined) update.owner_1_dob = toIsoDate(input.dob);
  const ssn = mergeSsn(input.ssn, stored.ssn);
  if (ssn !== stored.ssn) update.ssn = ssn;
  if (input.street !== undefined || input.city !== undefined || input.state !== undefined || input.zip !== undefined) {
    const cur = resolveOwner1Address(stored);
    const street = input.street !== undefined ? nonEmpty(input.street) : cur.street;
    const city = input.city !== undefined ? nonEmpty(input.city) : cur.city;
    const state = input.state !== undefined ? toStateCode(input.state) : cur.state;
    const zip = input.zip !== undefined ? toZip5(input.zip) : cur.zip;
    const changed = street !== cur.street || city !== cur.city || state !== cur.state || zip !== cur.zip;
    // An all-empty result never erases a stored address (saveClientOwners
    // rejects that input with an error before it gets here).
    const allEmpty = !street && !city && !state && !zip;
    if (changed && !allEmpty) Object.assign(update, {
      owner_1_street: street,
      owner_1_city: city,
      owner_1_state: state,
      owner_1_zip: zip,
      home_address: composeAddress(street, city, state, zip),
    });
  }
  return update;
}

function storedOwner1(vault: Record<string, unknown>): Owner1Stored {
  return {
    ssn: (vault.ssn as string | null) ?? null,
    owner_1_street: (vault.owner_1_street as string | null) ?? null,
    owner_1_city: (vault.owner_1_city as string | null) ?? null,
    owner_1_state: (vault.owner_1_state as string | null) ?? null,
    owner_1_zip: (vault.owner_1_zip as string | null) ?? null,
    home_address: (vault.home_address as string | null) ?? null,
  };
}

/**
 * True when the input blanks every address field (street/city/state/zip all
 * present and empty) while an address is on file. planOwner1Update refuses to
 * erase the address that way, so the save reports it instead of passing it
 * silently.
 */
export function owner1AddressClearedEntirely(input: Owner1Input, stored: Owner1Stored): boolean {
  const keys = ["street", "city", "state", "zip"] as const;
  if (!keys.every((k) => input[k] !== undefined && !nonEmpty(input[k]))) return false;
  const cur = resolveOwner1Address(stored);
  return keys.some((k) => !!cur[k]);
}

export async function saveClientOwners(
  admin: AdminClient,
  vaultId: string,
  input: { owner1?: Owner1Input; owners: OwnerInput[] }
): Promise<{ ok: true } | { ok: false; error: string; unavailable?: boolean }> {
  const { data: vault, error: vErr } = await admin
    .from("client_data_vault")
    .select("ssn, owner_1_ownership_pct, owner_1_street, owner_1_city, owner_1_state, owner_1_zip, home_address")
    .eq("id", vaultId)
    .maybeSingle();
  if (vErr || !vault) return { ok: false, error: "Client not found" };

  const owner1Pct = input.owner1?.ownership_pct ?? (Number(vault.owner_1_ownership_pct) || 0);
  const errors = validateOwners(owner1Pct, input.owners);
  const o1Input = input.owner1;
  // owner_1_ownership_pct is NOT NULL in the DB. An explicit `null` (the user
  // cleared the field) must error, not silently fall back to keeping the
  // stored value the way planOwner1Update's `!= null` guard does for undefined.
  if (o1Input && o1Input.ownership_pct === null) errors.push("Owner 1: ownership % is required.");
  if (o1Input?.ssn && digitsOnly(o1Input.ssn).length !== 9) errors.push("Owner 1: SSN must be 9 digits.");
  if (o1Input?.dob && !toIsoDate(o1Input.dob)) errors.push("Owner 1: date of birth is not a valid date.");
  if (nonEmpty(o1Input?.state) && !(/^[A-Za-z]{2}$/.test((o1Input!.state as string).trim()) && toStateCode(o1Input!.state))) {
    errors.push("Owner 1: state must be a 2-letter code.");
  }
  if (nonEmpty(o1Input?.zip) && !toZip5(o1Input?.zip)) errors.push("Owner 1: zip must be 5 digits.");
  if (o1Input && owner1AddressClearedEntirely(o1Input, storedOwner1(vault as Record<string, unknown>))) {
    errors.push("Owner 1: home address can't be cleared entirely — enter the new address or leave it as it was.");
  }
  if (errors.length) return { ok: false, error: errors.join(" ") };

  const existing = await loadClientOwners(admin, vaultId);
  if (!existing.available && input.owners.length > 0) {
    return { ok: false, unavailable: true, error: "Owner details can't be saved yet (database update pending)." };
  }

  if (existing.available) {
    const keep = input.owners.map((o) => o.position);
    const rows = input.owners.map((o) => {
      const stored = existing.owners.find((x) => x.position === o.position) ?? null;
      return {
        client_vault_id: vaultId,
        position: o.position,
        full_name: o.full_name.trim(),
        ownership_pct: Number(o.ownership_pct),
        dob: toIsoDate(o.dob),
        ssn: mergeSsn(o.ssn, stored?.ssn ?? null),
        street: nonEmpty(o.street),
        city: nonEmpty(o.city),
        state: toStateCode(o.state),
        zip: toZip5(o.zip),
        email: nonEmpty(o.email)?.toLowerCase() ?? null,
        phone: normalizeOwnerPhone(o.phone),
        updated_at: new Date().toISOString(),
      };
    });
    if (rows.length) {
      const { error } = await admin.from(TABLE).upsert(rows, { onConflict: "client_vault_id,position" });
      if (error) return { ok: false, error: `Could not save owners: ${error.message}` };
    }
    const removed = POSITIONS.filter((p) => !keep.includes(p));
    if (removed.length) {
      const { error } = await admin.from(TABLE).delete().eq("client_vault_id", vaultId).in("position", removed);
      if (error) return { ok: false, error: `Could not remove owners: ${error.message}` };
    }
  }

  const vaultUpdate: Record<string, unknown> = existing.available ? planLegacyOwnerColumns(input.owners) : {};
  if (o1Input) {
    Object.assign(
      vaultUpdate,
      planOwner1Update(o1Input, storedOwner1(vault as Record<string, unknown>))
    );
  }
  if (Object.keys(vaultUpdate).length) {
    vaultUpdate.updated_at = new Date().toISOString();
    const { error } = await admin.from("client_data_vault").update(vaultUpdate).eq("id", vaultId);
    if (error) return { ok: false, error: `Could not update the vault: ${error.message}` };
  }
  return { ok: true };
}
