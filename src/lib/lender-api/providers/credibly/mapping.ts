// src/lib/lender-api/providers/credibly/mapping.ts
//
// Pure: our deal → Credibly POST /v2/submissions body, plus their dropdown,
// stip matching and status reading. No I/O, no env — fully unit tested.

import type {
  BuiltApplication,
  Gap,
  LenderApiSource,
  NormalizedStatus,
  PickDefinition,
  Picks,
} from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { digitsOnly, nonEmpty, splitName, toInt, toIsoDate } from "../../normalize";
import {
  CREDIBLY_APPROVED_STATUSES,
  CREDIBLY_NEEDS_INFO_STATUSES,
  CREDIBLY_OWNERSHIP_TYPES,
  CREDIBLY_STALLED_STATUSES,
  CREDIBLY_STIP_RULES,
} from "./constants";
import type { CrediblyStipItem } from "./client";

export interface CrediblySubmissionRequest {
  business_overview: {
    dba: string;
    legal_name: string;
    business_address: string;
    business_city: string;
    business_state: string;
    business_postal_code: string;
    ownership_type: string;
    federal_tax_id: string;
    business_start_date: string;
    website?: string;
  };
  account_overview: { avg_monthly_deposits?: number };
  principals: Array<{
    first_name: string;
    last_name: string;
    percent_ownership: number;
    ssn: string;
    principal_address: string;
    principal_city: string;
    principal_state: string;
    principal_postal_code: string;
    date_of_birth: string;
    email: string;
  }>;
  amount_requested?: number;
}

export const CREDIBLY_PICKS: readonly PickDefinition[] = [
  {
    key: "ownership_type",
    label: "Entity type",
    options: CREDIBLY_OWNERSHIP_TYPES,
    required: true,
  },
];

/**
 * Credibly's required list is stricter than Forward Financing's: EIN, the
 * owner's date of birth and BOTH addresses are mandatory, not optional.
 */
export const CREDIBLY_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
  "owner_1_name",
  "ssn",
  "owner_1_dob",
  "owner_1_street",
  "owner_1_city",
  "owner_1_state",
  "owner_1_zip",
  "ein",
  "business_street",
  "company_city",
  "company_state",
  "company_zip_code",
];

export function mapCrediblyOwnershipType(v: string | null | undefined): string | null {
  const s = (v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s === "llc" || s === "limitedliabilitycompany") return "Limited Liability Company";
  if (s === "llp" || s === "limitedliabilitypartnership") return "Limited Liability Partnership";
  if (s === "lp" || s === "limitedpartnership") return "Limited Partnership";
  if (s === "partnership" || s === "generalpartnership" || s === "gp") return "Partnership";
  if (["scorp", "ccorp", "corp", "corporation", "inc", "incorporated"].includes(s)) return "Corporation";
  if (["soleprop", "soleproprietor", "soleproprietorship"].includes(s)) return "Sole Proprietorship";
  return null;
}

export function suggestCrediblyPicks(source: LenderApiSource): Record<string, string | null> {
  const { vault, business } = source;
  return {
    ownership_type: mapCrediblyOwnershipType(business?.legal_entity_type ?? vault.legal_entity_type),
  };
}

/** Credibly validates `^\d{2}-\d{7}$`. */
export function formatFederalTaxId(ein: string | null | undefined): string | null {
  const d = digitsOnly(ein);
  return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : null;
}

/** Credibly validates `^\d{3}-\d{2}-\d{4}$`. */
export function formatSsn(ssn: string | null | undefined): string | null {
  const d = digitsOnly(ssn);
  return d.length === 9 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : null;
}

export function redactCrediblySubmission(payload: CrediblySubmissionRequest): CrediblySubmissionRequest {
  const clone: CrediblySubmissionRequest = JSON.parse(JSON.stringify(payload));
  for (const p of clone.principals) {
    const d = digitsOnly(p.ssn);
    p.ssn = d ? `***-**-${d.slice(-4)}` : "";
  }
  return clone;
}

export function buildCrediblySubmission(
  source: LenderApiSource,
  picks: Picks,
  _ctx: { referenceId: string }
): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d, analysis } = source;

  const effectivePicks: Record<string, string | null> = { ...suggestCrediblyPicks(source) };
  for (const def of CREDIBLY_PICKS) {
    const chosen = nonEmpty(picks[def.key]);
    if (chosen) effectivePicks[def.key] = chosen;
  }
  for (const def of CREDIBLY_PICKS) {
    const value = effectivePicks[def.key];
    if (!value) {
      if (def.required) gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "missing" });
    } else if (!def.options.includes(value)) {
      gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "invalid" });
    }
  }

  // ── Principal ────────────────────────────────────────────────────────────
  const name = splitName(r.owner_1_name);
  if (!name.first || !name.last) {
    gaps.push({ field: "owner_1_name", label: "Owner first and last name", kind: "missing" });
  }
  const ssn = formatSsn(r.ssn);
  if (!ssn) {
    gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: r.ssn ? "invalid" : "missing" });
  }
  const dob = toIsoDate(r.owner_1_dob);
  if (!dob) gaps.push({ field: "owner_1_dob", label: VAULT_FIELD_LABELS.owner_1_dob, kind: "missing" });
  for (const field of ["owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const email = nonEmpty(v.client_email);
  if (!email) {
    gaps.push({ field: "client_email", label: "Client email (edit the client profile)", kind: "missing" });
  }

  // ── Business ─────────────────────────────────────────────────────────────
  // The vault's DBA, legal name and EIN describe the PRIMARY business; another
  // business is identified only by its own business_profiles row.
  const isPrimaryBusiness = !b || b.is_primary;
  const legalName = isPrimaryBusiness
    ? nonEmpty(v.company_name) ?? nonEmpty(b?.company_name)
    : nonEmpty(b?.company_name) ?? nonEmpty(b?.business_name);
  const dba = isPrimaryBusiness
    ? nonEmpty(v.dba) ?? nonEmpty(b?.business_name) ?? legalName
    : nonEmpty(b?.business_name) ?? legalName;
  if (!legalName) {
    gaps.push({ field: "business_name", label: "Business legal name (edit the client profile)", kind: "missing" });
  }

  // EIN is required, and it belongs to the primary business only — a second
  // business on the same vault has no EIN of its own on file.
  const federalTaxId = isPrimaryBusiness ? formatFederalTaxId(r.ein) : null;
  if (!federalTaxId) {
    gaps.push({
      field: "ein",
      label: isPrimaryBusiness ? "EIN (9 digits)" : "EIN for this business (edit the client profile)",
      kind: r.ein ? "invalid" : "missing",
    });
  }

  for (const field of ["business_street", "company_city", "company_state", "company_zip_code"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }

  const startedOn = toIsoDate(b?.business_start_date) ?? toIsoDate(v.business_start_date);
  if (!startedOn) {
    gaps.push({
      field: "business_start_date",
      label: "Business start date (edit the client profile)",
      kind: "missing",
    });
  }

  const deposits = toInt(
    analysis?.avg_monthly_deposits ?? analysis?.avg_revenue ?? b?.avg_monthly_deposits ?? v.avg_monthly_deposits
  );
  const capital = toInt(d?.capital_requested ?? v.capital_requested);
  const ownership = toInt(v.owner_1_ownership_pct);

  const payload: CrediblySubmissionRequest = {
    business_overview: {
      dba: dba ?? "",
      legal_name: legalName ?? "",
      business_address: r.business_street ?? "",
      business_city: r.company_city ?? "",
      business_state: r.company_state ?? "",
      business_postal_code: r.company_zip_code ?? "",
      ownership_type: effectivePicks.ownership_type ?? "",
      federal_tax_id: federalTaxId ?? "",
      business_start_date: startedOn ?? "",
      // `website` is optional and the vault doesn't carry one — omitted.
    },
    account_overview: deposits && deposits > 0 ? { avg_monthly_deposits: deposits } : {},
    principals: [
      {
        first_name: name.first ?? "",
        last_name: name.last ?? "",
        // Their schema requires a number; 100 is the honest default for the
        // single-owner files this maps, and UW can correct the vault.
        percent_ownership: ownership && ownership > 0 ? ownership : 100,
        ssn: ssn ?? "",
        principal_address: r.owner_1_street ?? "",
        principal_city: r.owner_1_city ?? "",
        principal_state: r.owner_1_state ?? "",
        principal_postal_code: r.owner_1_zip ?? "",
        date_of_birth: dob ?? "",
        email: email ?? "",
      },
    ],
    ...(capital && capital > 0 ? { amount_requested: capital } : {}),
  };

  return { payload, redacted: redactCrediblySubmission(payload), gaps, effectivePicks };
}

/**
 * Credibly has no document-type field — the stip id in the URL IS the type —
 * and the spec enumerates no stip catalogue, so tags are meaningless here. The
 * doc code is matched against the stip's own text at upload time instead (see
 * matchStipForDocCode).
 */
export function crediblyTagsForDocCode(_code: string | null): string[] {
  return [];
}

/**
 * Pick the stip a document belongs to, by reading the stip's text. Returns
 * null when nothing matches — the engine then reports that file as not
 * accepted rather than guessing a slot and polluting the deal.
 */
export function matchStipForDocCode(
  docCode: string | null,
  stips: CrediblyStipItem[]
): CrediblyStipItem | null {
  if (!docCode || !stips.length) return null;
  for (const rule of CREDIBLY_STIP_RULES) {
    if (!rule.docCodes.includes(docCode)) continue;
    const hit = stips.find((s) => rule.test.test(`${s.short_text ?? ""} ${s.long_text ?? ""}`));
    if (hit) return hit;
  }
  return null;
}

function stipSummary(stips: CrediblyStipItem[]): string | null {
  const open = stips.filter((s) => !/receiv|complete|approved|satisf|clear/i.test(s.stip_status ?? ""));
  if (!open.length) return null;
  return `Outstanding: ${open.map((s) => `${s.short_text || s.stip_id} (${s.stip_status})`).join(", ")}`;
}

export function interpretCrediblyStatus(raw: unknown): NormalizedStatus {
  const s = (raw && typeof raw === "object" ? raw : {}) as {
    status?: string;
    stips?: CrediblyStipItem[];
    decline_reasons?: string[];
    action_links?: Record<string, Array<{ link?: string }>>;
  };
  const stage = nonEmpty(s.status) ?? "Unknown";
  const stips = Array.isArray(s.stips) ? s.stips : [];

  if (stage === "Declined") {
    const reasons = Array.isArray(s.decline_reasons) ? s.decline_reasons.filter(Boolean) : [];
    return {
      kind: "declined",
      stage,
      note: reasons.length ? `Decline reasons: ${reasons.join(", ")}` : "Declined by Credibly (no reason given)",
    };
  }

  const links = Object.values(s.action_links ?? {})
    .flat()
    .map((l) => nonEmpty(l?.link))
    .filter(Boolean) as string[];

  if (CREDIBLY_APPROVED_STATUSES.includes(stage)) {
    const lines = [`Credibly: ${stage}`];
    const outstanding = stipSummary(stips);
    if (outstanding) lines.push(outstanding);
    // Offer figures live behind the Offers API, not the status response.
    if (links.length) lines.push(`Links: ${links.join(" ")}`);
    return { kind: "approved", stage, note: lines.join("\n") };
  }

  if (CREDIBLY_NEEDS_INFO_STATUSES.includes(stage) || CREDIBLY_STALLED_STATUSES.includes(stage)) {
    const lines = [`Credibly: ${stage}`];
    const outstanding = stipSummary(stips);
    if (outstanding) lines.push(outstanding);
    if (links.length) lines.push(`Links: ${links.join(" ")}`);
    return { kind: "needs_info", stage, note: lines.join("\n") };
  }

  return { kind: "in_progress", stage };
}
