// src/lib/lender-api/providers/fundkite/mapping.ts
//
// Pure: our deal → Fundkite POST /api/v1/deals body, plus their dropdowns,
// document types and status reading. No I/O, no env — fully unit tested.

import type { BuiltApplication, Gap, LenderApiSource, NormalizedStatus, PickDefinition, Picks } from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { US_STATE_CODES, digitsOnly, nonEmpty, splitName, toInt, toIsoDate } from "../../normalize";
import {
  FUNDKITE_DOCUMENT_TYPES,
  FUNDKITE_ENTITY_TYPES,
  FUNDKITE_INTAKE_FAILED,
  FUNDKITE_OTHER_DOCUMENT_TYPE,
} from "./constants";

export interface FundkiteDealRequest {
  external_id: string;
  legal_name: string;
  dba?: string;
  requested_amount: number;
  primary_email: string;
  primary_phone: string;
  federal_tax_id: string;
  type_of_entity: string;
  state_of_incorporation: string;
  date_business_started: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  owner_1_first_name: string;
  owner_1_last_name: string;
  owner_1_ownership_percentage: number;
  owner_1_email?: string;
  owner_1_cell_phone?: string;
  owner_1_ssn: string;
  owner_1_date_of_birth: string;
  owner_1_fico?: number;
  owner_1_street: string;
  owner_1_city: string;
  owner_1_state: string;
  owner_1_zip: string;
}

export const FUNDKITE_PICKS: readonly PickDefinition[] = [
  { key: "type_of_entity", label: "Entity type", options: FUNDKITE_ENTITY_TYPES, required: true },
  {
    key: "state_of_incorporation",
    label: "State of incorporation (confirm — prefilled from the business address)",
    options: US_STATE_CODES,
    required: true,
  },
];

export const FUNDKITE_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
  "owner_1_name",
  "ssn",
  "owner_1_dob",
  "owner_1_street",
  "owner_1_city",
  "owner_1_state",
  "owner_1_zip",
  "client_phone",
  "ein",
  "business_street",
  "company_city",
  "company_state",
  "company_zip_code",
];

export function mapFundkiteEntityType(v: string | null | undefined): string | null {
  const s = (v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s === "llc" || s === "limitedliabilitycompany") return "LLC";
  if (s === "llp" || s === "limitedliabilitypartnership") return "Limited Liability Partnership";
  if (["partnership", "generalpartnership", "gp", "lp", "limitedpartnership"].includes(s)) return "Partnership";
  if (["scorp", "ccorp", "corp", "corporation", "inc", "incorporated"].includes(s)) return "Corporation";
  if (["soleprop", "soleproprietor", "soleproprietorship"].includes(s)) return "Sole Proprietorship";
  if (s === "nonprofit" || s === "notforprofit") return "Non-Profit";
  return null;
}

export function suggestFundkitePicks(source: LenderApiSource): Record<string, string | null> {
  const { vault, business, resolved } = source;
  return {
    type_of_entity: mapFundkiteEntityType(business?.legal_entity_type ?? vault.legal_entity_type),
    // We don't record where a business incorporated; its operating state is
    // right far more often than not, and the pick label asks UW to confirm.
    state_of_incorporation: resolved.values.company_state,
  };
}

function phone10(v: unknown): string | null {
  const d = digitsOnly(v);
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length === 10 ? d : null;
}

export function redactFundkiteDeal(payload: FundkiteDealRequest): FundkiteDealRequest {
  const d = digitsOnly(payload.owner_1_ssn);
  return { ...payload, owner_1_ssn: d ? `*****${d.slice(-4)}` : "" };
}

export function buildFundkiteDeal(source: LenderApiSource, picks: Picks, ctx: { referenceId: string }): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d, analysis } = source;

  const effectivePicks: Record<string, string | null> = { ...suggestFundkitePicks(source) };
  for (const def of FUNDKITE_PICKS) {
    const chosen = nonEmpty(picks[def.key]);
    if (chosen) effectivePicks[def.key] = chosen;
  }
  for (const def of FUNDKITE_PICKS) {
    const value = effectivePicks[def.key];
    if (!value) {
      if (def.required) gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "missing" });
    } else if (!def.options.includes(value)) {
      gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "invalid" });
    }
  }

  // ── Owner ────────────────────────────────────────────────────────────────
  const name = splitName(r.owner_1_name);
  if (!name.first || !name.last) {
    gaps.push({ field: "owner_1_name", label: "Owner first and last name", kind: "missing" });
  }
  const ssn = digitsOnly(r.ssn);
  if (ssn.length !== 9) gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: r.ssn ? "invalid" : "missing" });
  const dob = toIsoDate(r.owner_1_dob);
  if (!dob) gaps.push({ field: "owner_1_dob", label: VAULT_FIELD_LABELS.owner_1_dob, kind: "missing" });
  for (const field of ["owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const ownership = toInt(v.owner_1_ownership_pct);
  const email = nonEmpty(v.client_email);
  if (!email) gaps.push({ field: "client_email", label: "Client email (edit the client profile)", kind: "missing" });
  const cell = phone10(r.client_phone);
  const fico = analysis?.fico ?? toInt(/^\s*\d{3}\s*$/.test(v.credit_score ?? "") ? v.credit_score : null);

  // ── Business ─────────────────────────────────────────────────────────────
  // The vault's DBA, legal name and EIN describe the PRIMARY business; another
  // business is identified only by its own business_profiles row.
  const isPrimaryBusiness = !b || b.is_primary;
  const legalName = isPrimaryBusiness
    ? nonEmpty(v.company_name) ?? nonEmpty(b?.company_name)
    : nonEmpty(b?.company_name) ?? nonEmpty(b?.business_name);
  const dba = isPrimaryBusiness ? nonEmpty(v.dba) ?? nonEmpty(b?.business_name) : nonEmpty(b?.business_name);
  if (!legalName) {
    gaps.push({ field: "business_name", label: "Business legal name (edit the client profile)", kind: "missing" });
  }
  const ein = isPrimaryBusiness ? digitsOnly(r.ein) : "";
  if (ein.length !== 9) {
    gaps.push({
      field: "ein",
      label: isPrimaryBusiness ? "EIN (9 digits)" : "EIN for this business (edit the client profile)",
      kind: r.ein ? "invalid" : "missing",
    });
  }
  for (const field of ["business_street", "company_city", "company_state", "company_zip_code"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const primaryPhone = phone10(b?.phone) ?? cell;
  if (!primaryPhone) {
    gaps.push({ field: "client_phone", label: "Business phone (10 digits)", kind: r.client_phone ? "invalid" : "missing" });
  }
  const started = toIsoDate(b?.business_start_date) ?? toIsoDate(v.business_start_date);
  if (!started) {
    gaps.push({ field: "business_start_date", label: "Business start date (edit the client profile)", kind: "missing" });
  }
  const requested = toInt(d?.capital_requested ?? v.capital_requested);
  if (!requested || requested <= 0) {
    gaps.push({ field: "capital_requested", label: "Requested amount (edit the funding deal)", kind: "missing" });
  }

  const payload: FundkiteDealRequest = {
    // Correlates webhooks and status back to this exact attempt.
    external_id: ctx.referenceId,
    legal_name: legalName ?? "",
    ...(dba && dba !== legalName ? { dba } : {}),
    requested_amount: requested ?? 0,
    primary_email: email ?? "",
    primary_phone: primaryPhone ?? "",
    federal_tax_id: ein.length === 9 ? ein : "",
    type_of_entity: effectivePicks.type_of_entity ?? "",
    state_of_incorporation: effectivePicks.state_of_incorporation ?? "",
    date_business_started: started ?? "",
    street: r.business_street ?? "",
    city: r.company_city ?? "",
    state: r.company_state ?? "",
    postal_code: r.company_zip_code ?? "",
    owner_1_first_name: name.first ?? "",
    owner_1_last_name: name.last ?? "",
    // Required; 100 is the honest default for the single-owner files this maps.
    owner_1_ownership_percentage: ownership && ownership > 0 && ownership <= 100 ? ownership : 100,
    ...(email ? { owner_1_email: email } : {}),
    ...(cell ? { owner_1_cell_phone: cell } : {}),
    owner_1_ssn: ssn.length === 9 ? ssn : "",
    owner_1_date_of_birth: dob ?? "",
    ...(fico && fico > 0 ? { owner_1_fico: fico } : {}),
    owner_1_street: r.owner_1_street ?? "",
    owner_1_city: r.owner_1_city ?? "",
    owner_1_state: r.owner_1_state ?? "",
    owner_1_zip: r.owner_1_zip ?? "",
    // owner_2 is omitted: the block must be complete and the vault holds only
    // the second owner's name and share.
  };

  return { payload, redacted: redactFundkiteDeal(payload), gaps, effectivePicks };
}

export function fundkiteDocumentType(docCode: string | null): string {
  if (!docCode) return FUNDKITE_OTHER_DOCUMENT_TYPE;
  return FUNDKITE_DOCUMENT_TYPES.find((t) => t.docCodes.includes(docCode))?.type ?? FUNDKITE_OTHER_DOCUMENT_TYPE;
}

export function fundkiteTagsForDocCode(docCode: string | null): string[] {
  return [fundkiteDocumentType(docCode)];
}

// ── Status ─────────────────────────────────────────────────────────────────

export interface FundkiteDealStatus {
  id?: string;
  status?: string;
  deal_status?: string | null;
  external_id?: string | null;
  submission_number?: string | null;
}

/**
 * `status` is Fundkite's intake (processing → received | failed). The
 * underwriting outcome is `deal_status`, a free CRM string with no documented
 * vocabulary — read by keyword, and anything unrecognised stays in progress
 * rather than guessing a verdict.
 */
export function interpretFundkiteStatus(raw: unknown): NormalizedStatus {
  const s = (raw && typeof raw === "object" ? ((raw as { data?: unknown }).data ?? raw) : {}) as FundkiteDealStatus;
  const intake = nonEmpty(s.status)?.toLowerCase() ?? "processing";
  const crm = nonEmpty(s.deal_status);
  const ref = nonEmpty(s.submission_number) ? ` (submission ${s.submission_number})` : "";

  if (intake === FUNDKITE_INTAKE_FAILED) {
    return {
      kind: "needs_info",
      stage: "Intake failed",
      note: "Fundkite could not process this deal into their CRM. Check with Fundkite before resending.",
    };
  }
  if (!crm) return { kind: "in_progress", stage: intake === "received" ? `Received${ref}` : "Processing" };

  const note = `Fundkite: ${crm}${ref}`;
  if (/declin|reject|dead|not\s*interested|no\s*offer|withdrawn/i.test(crm)) return { kind: "declined", stage: crm, note };
  if (/approv|offer|contract|funded/i.test(crm)) return { kind: "approved", stage: crm, note };
  if (/pending\s*(docs|info)|missing|stip|need|info\s*requested|hold/i.test(crm)) return { kind: "needs_info", stage: crm, note };
  return { kind: "in_progress", stage: crm };
}
