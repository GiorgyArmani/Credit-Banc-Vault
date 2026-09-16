// src/lib/lender-api/vault-fields.ts
//
// The vault fields the lender-API review panel can show and correct, and the
// single place their values are normalized. Corrections are written back to
// client_data_vault (decision: fix data at the source), so the allow-list here
// is also the write-back security boundary — nothing outside it is writable.

import { digitsOnly, nonEmpty, parseUsAddress, toIsoDate, toStateCode, toZip5 } from "./normalize";

export const VAULT_FIELDS = [
  "ssn",
  "ein",
  "owner_1_name",
  "owner_1_dob",
  "owner_1_street",
  "owner_1_city",
  "owner_1_state",
  "owner_1_zip",
  "client_phone",
  "business_street",
  "company_city",
  "company_state",
  "company_zip_code",
] as const;

export type VaultField = (typeof VAULT_FIELDS)[number];

export const VAULT_FIELD_LABELS: Record<VaultField, string> = {
  ssn: "Owner SSN",
  ein: "EIN",
  owner_1_name: "Owner name",
  owner_1_dob: "Owner date of birth",
  owner_1_street: "Owner street",
  owner_1_city: "Owner city",
  owner_1_state: "Owner state",
  owner_1_zip: "Owner zip",
  client_phone: "Phone",
  business_street: "Business street",
  company_city: "Business city",
  company_state: "Business state",
  company_zip_code: "Business zip",
};

/** Columns loadLenderApiSource selects from client_data_vault. */
export const VAULT_SOURCE_COLUMNS = [
  "id", "user_id", "client_name", "client_email", "client_phone", "company_name", "dba",
  "ein", "ssn", "legal_entity_type", "industry", "business_start_date",
  "business_address", "business_street", "company_city", "company_state", "company_zip_code",
  "owner_1_name", "owner_1_ownership_pct", "owner_1_dob", "owner_1_home_phone",
  "home_address", "owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip",
  "owner_2_name", "owner_2_ownership_pct",
  "avg_monthly_deposits", "capital_requested", "loan_purpose",
].join(", ");

export interface SourceVault {
  id: string;
  user_id: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  company_name: string | null;
  dba: string | null;
  ein: string | null;
  ssn: string | null;
  legal_entity_type: string | null;
  industry: string | null;
  business_start_date: string | null;
  business_address: string | null;
  business_street: string | null;
  company_city: string | null;
  company_state: string | null;
  company_zip_code: string | null;
  owner_1_name: string | null;
  owner_1_ownership_pct: number | null;
  owner_1_dob: string | null;
  owner_1_home_phone: string | null;
  home_address: string | null;
  owner_1_street: string | null;
  owner_1_city: string | null;
  owner_1_state: string | null;
  owner_1_zip: string | null;
  owner_2_name: string | null;
  owner_2_ownership_pct: number | null;
  avg_monthly_deposits: number | null;
  capital_requested: number | null;
  loan_purpose: string | null;
}

export interface ResolvedVaultFields {
  values: Record<VaultField, string | null>;
  /** Fields whose value came from parsing free text — the panel asks UW to confirm them. */
  parsed: VaultField[];
}

export function resolveVaultFields(v: SourceVault): ResolvedVaultFields {
  const parsed: VaultField[] = [];
  const home = parseUsAddress(v.home_address);
  const biz = parseUsAddress(v.business_address);

  function pick(field: VaultField, structured: string | null, fromText: string | null): string | null {
    if (structured) return structured;
    if (fromText) parsed.push(field);
    return fromText;
  }

  const ssn = digitsOnly(v.ssn);
  const ein = digitsOnly(v.ein);

  const values: Record<VaultField, string | null> = {
    ssn: ssn || null,
    ein: ein || null,
    owner_1_name: nonEmpty(v.owner_1_name),
    owner_1_dob: toIsoDate(v.owner_1_dob),
    owner_1_street: pick("owner_1_street", nonEmpty(v.owner_1_street), home.street1),
    owner_1_city: pick("owner_1_city", nonEmpty(v.owner_1_city), home.city),
    owner_1_state: pick("owner_1_state", toStateCode(v.owner_1_state), home.state),
    owner_1_zip: pick("owner_1_zip", toZip5(v.owner_1_zip), home.zip),
    client_phone: nonEmpty(v.client_phone),
    business_street: pick("business_street", nonEmpty(v.business_street), biz.street1),
    company_city: pick("company_city", nonEmpty(v.company_city), biz.city),
    company_state: pick("company_state", toStateCode(v.company_state), biz.state),
    company_zip_code: pick("company_zip_code", toZip5(v.company_zip_code), biz.zip),
  };

  return { values, parsed };
}

const BUSINESS_SCOPED_FIELDS: readonly VaultField[] = [
  "business_street",
  "ein",
  "company_city",
  "company_state",
  "company_zip_code",
];

/**
 * The vault's business columns describe the PRIMARY business. For any other
 * business use that business's own address, and never carry the primary's
 * street or EIN over (the vault has no per-business street/EIN).
 */
export function scopeResolvedToBusiness(
  resolved: ResolvedVaultFields,
  business: {
    is_primary: boolean;
    company_city: string | null;
    company_state: string | null;
    company_zip_code: string | null;
  } | null
): ResolvedVaultFields {
  if (!business || business.is_primary) return resolved;
  return {
    values: {
      ...resolved.values,
      company_city: nonEmpty(business.company_city),
      company_state: toStateCode(business.company_state),
      company_zip_code: toZip5(business.company_zip_code),
      business_street: null,
      ein: null,
    },
    parsed: resolved.parsed.filter((f) => !BUSINESS_SCOPED_FIELDS.includes(f)),
  };
}

type NormalizeResult =
  | { ok: true; updates: Partial<Record<VaultField, string | null>> }
  | { ok: false; error: string };

const ALLOWED = new Set<string>(VAULT_FIELDS);

export function normalizeVaultUpdates(input: unknown): NormalizeResult {
  if (input === undefined || input === null) return { ok: true, updates: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "vault_updates must be an object" };
  }

  const updates: Partial<Record<VaultField, string | null>> = {};

  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED.has(key)) return { ok: false, error: `Unknown field: ${key}` };
    const field = key as VaultField;
    const text = nonEmpty(raw);

    switch (field) {
      case "ssn":
      case "ein": {
        if (!text) return { ok: false, error: `${field === "ssn" ? "SSN" : "EIN"} must be 9 digits` };
        const d = digitsOnly(text);
        if (d.length !== 9) return { ok: false, error: `${field === "ssn" ? "SSN" : "EIN"} must be 9 digits` };
        updates[field] = d;
        break;
      }
      case "owner_1_state": {
        if (!text) { updates[field] = null; break; }
        const code = toStateCode(text);
        if (!code) return { ok: false, error: "Owner state must be a US state" };
        updates[field] = code;
        break;
      }
      case "company_state": {
        // NOT NULL column.
        if (!text) return { ok: false, error: "Business state is required" };
        const code = toStateCode(text);
        if (!code) return { ok: false, error: "Business state must be a US state" };
        updates[field] = code;
        break;
      }
      case "owner_1_zip": {
        if (!text) { updates[field] = null; break; }
        const zip = toZip5(text);
        if (!zip) return { ok: false, error: "Owner zip must be 5 digits" };
        updates[field] = zip;
        break;
      }
      case "company_zip_code": {
        // NOT NULL column.
        if (!text) return { ok: false, error: "Business zip is required" };
        const zip = toZip5(text);
        if (!zip) return { ok: false, error: "Business zip must be 5 digits" };
        updates[field] = zip;
        break;
      }
      case "owner_1_dob": {
        if (!text) { updates[field] = null; break; }
        const iso = toIsoDate(text);
        if (!iso) return { ok: false, error: "Owner date of birth must be a date" };
        updates[field] = iso;
        break;
      }
      case "owner_1_name": {
        // NOT NULL column.
        if (!text) return { ok: false, error: "Owner name is required" };
        updates[field] = text;
        break;
      }
      case "client_phone": {
        // NOT NULL column; keep the formatting the rest of the app displays.
        if (!text || digitsOnly(text).length < 10) return { ok: false, error: "Phone must have at least 10 digits" };
        updates[field] = text;
        break;
      }
      default:
        updates[field] = text;
    }
  }

  return { ok: true, updates };
}
