// src/lib/lender-api/providers/samson/mapping.ts
//
// Pure: our deal → Samson Funding's "Create Record" JSON, plus their document
// types and status reading. No I/O, no env.
//
// Formats follow their only example: hyphenated SSN / tax id / phones, ISO
// dates, numbers as strings, stateOfIncorporation as a full state name.

import type { BuiltApplication, Gap, LenderApiSource, NormalizedStatus, PickDefinition, Picks } from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { digitsOnly, nonEmpty, splitName, toInt, toIsoDate, toStateCode, toStateName, toZip5 } from "../../normalize";
import { resolveNaics } from "@/data/naics";
import { SAMSON_DEAL_TYPES, SAMSON_DOC_TYPES, SAMSON_SALES_OFFICE } from "./constants";

export interface SamsonAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface SamsonOwner {
  ssn: string;
  name: string;
  homePhone?: string;
  dateOfBirth?: string;
  ownershipPercentage?: string;
  email?: string;
  homeAddress?: SamsonAddress;
}

export interface SamsonRecord {
  business: {
    taxID?: string;
    name: string;
    phone: string;
    businessInceptionDate: string;
    stateOfIncorporation?: string;
    dba?: string;
    email?: string;
    industry?: string;
    entityType?: string;
    dealType: string;
    website?: string;
    naicsCode?: string;
    sicCode?: string;
    address: SamsonAddress;
  };
  owners: SamsonOwner[];
  sales: {
    firstName?: string;
    lastName?: string;
    repEmail?: string;
    repPhone?: string;
    salesOffice: string;
  };
  selfReported: {
    monthlyRevenue?: string;
    desiredLoanAmount?: string;
    useOfFunds?: string;
  };
  submissionNotes: string;
}

export interface SamsonDocument {
  oppId: string;
  fileName: string;
  docType: string;
  fileData: string;
}

export const SAMSON_PICKS: readonly PickDefinition[] = [
  { key: "deal_type", label: "Deal type", options: SAMSON_DEAL_TYPES, required: true },
];

export const SAMSON_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
  "owner_1_name",
  "ssn",
  "owner_1_street",
  "owner_1_city",
  "owner_1_state",
  "owner_1_zip",
  "client_phone",
  "business_street",
  "company_city",
  "company_state",
  "company_zip_code",
];

export function suggestSamsonPicks(): Record<string, string | null> {
  return { deal_type: "New" };
}

/** "777-123-4567", as their example. */
export function toSamsonPhone(v: unknown): string | null {
  let d = digitsOnly(v);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null;
}

function hyphenSsn(d: string): string {
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function share(v: unknown): number | null {
  const pct = toInt(v);
  return pct !== null && pct > 0 && pct <= 100 ? pct : null;
}

function address(street: unknown, city: unknown, state: unknown, zip: unknown): SamsonAddress | null {
  const s = nonEmpty(street);
  const c = nonEmpty(city);
  const st = toStateCode(state);
  const z = toZip5(zip);
  return s && c && st && z ? { addressLine1: s, city: c, state: st, zipCode: z } : null;
}

export function redactSamsonRecord(p: SamsonRecord): SamsonRecord {
  return { ...p, owners: p.owners.map((o) => ({ ...o, ssn: o.ssn ? `***-**-${o.ssn.slice(-4)}` : "" })) };
}

/** Monthly revenue, best source first. The vault's deposits describe the primary business only. */
function monthlyRevenueOf(source: LenderApiSource, isPrimaryBusiness: boolean): number | null {
  const { business: b, analysis, vault: v } = source;
  for (const monthly of [
    analysis?.avg_revenue,
    analysis?.avg_monthly_deposits,
    b?.avg_monthly_deposits,
    isPrimaryBusiness ? v.avg_monthly_deposits : null,
  ]) {
    const m = toInt(monthly);
    if (m && m > 0) return m;
  }
  return null;
}

export function buildSamsonApplication(source: LenderApiSource, picks: Picks, ctx: { referenceId: string }): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d } = source;

  // ── Picks ────────────────────────────────────────────────────────────────
  const effectivePicks: Record<string, string | null> = { ...suggestSamsonPicks() };
  for (const def of SAMSON_PICKS) {
    const chosen = nonEmpty(picks[def.key]);
    if (chosen) effectivePicks[def.key] = chosen;
    const value = effectivePicks[def.key];
    if (!value) {
      if (def.required) gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "missing" });
    } else if (!def.options.includes(value)) {
      gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "invalid" });
    }
  }

  // ── Owner 1 ──────────────────────────────────────────────────────────────
  const ownerName = nonEmpty(r.owner_1_name);
  const split = splitName(ownerName);
  if (!split.first || !split.last) gaps.push({ field: "owner_1_name", label: "Owner first and last name", kind: "missing" });
  const ssn = digitsOnly(r.ssn);
  if (ssn.length !== 9) gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: r.ssn ? "invalid" : "missing" });
  for (const field of ["owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const cell = toSamsonPhone(r.client_phone);
  const home = toSamsonPhone(v.owner_1_home_phone) ?? cell;
  const dob = toIsoDate(r.owner_1_dob);
  const pct1 = share(v.owner_1_ownership_pct);
  const homeAddress = address(r.owner_1_street, r.owner_1_city, r.owner_1_state, r.owner_1_zip);

  const owners: SamsonOwner[] = [
    {
      ssn: ssn.length === 9 ? hyphenSsn(ssn) : "",
      name: ownerName ?? "",
      ...(home ? { homePhone: home } : {}),
      ...(dob ? { dateOfBirth: dob } : {}),
      ...(pct1 ? { ownershipPercentage: String(pct1) } : {}),
      ...(nonEmpty(v.client_email) ? { email: nonEmpty(v.client_email) as string } : {}),
      ...(homeAddress ? { homeAddress } : {}),
    },
  ];

  // ── Owners 2–5 ───────────────────────────────────────────────────────────
  // Every co-owner with a share is sent or flagged — never dropped. Samson's
  // example sends an SSN for every owner, so a co-owner without one is a gap.
  if (!source.ownersAvailable) {
    const vv = v as unknown as Record<string, unknown>;
    for (const n of [2, 3, 4, 5] as const) {
      const pct = toInt(vv[`owner_${n}_ownership_pct`]);
      if (pct !== null && pct > 0) {
        gaps.push({
          field: `owner:${n}`,
          label: `Owner ${n} (${nonEmpty(vv[`owner_${n}_name`]) ?? "unnamed"}, ${pct}%): owner details can't be loaded yet`,
          kind: "missing",
        });
      }
    }
  } else {
    for (const o of [...source.owners].sort((a, b) => a.position - b.position)) {
      if (!(o.ownership_pct > 0)) continue;
      const label = `Owner ${o.position} (${nonEmpty(o.full_name) ?? "unnamed"}, ${o.ownership_pct}%)`;
      const on = splitName(o.full_name);
      const oSsn = digitsOnly(o.ssn);
      if (!on.first || !on.last) {
        gaps.push({ field: `owner:${o.position}`, label: `${label}: missing full name`, kind: "missing" });
        continue;
      }
      if (oSsn.length !== 9) {
        gaps.push({ field: `owner:${o.position}`, label: `${label}: missing SSN (9 digits)`, kind: o.ssn ? "invalid" : "missing" });
        continue;
      }
      const oDob = toIsoDate(o.dob);
      const oPhone = toSamsonPhone(o.phone);
      const oAddress = address(o.street, o.city, o.state, o.zip);
      const oPct = share(o.ownership_pct);
      owners.push({
        ssn: hyphenSsn(oSsn),
        name: nonEmpty(o.full_name) as string,
        ...(oPhone ? { homePhone: oPhone } : {}),
        ...(oDob ? { dateOfBirth: oDob } : {}),
        ...(oPct ? { ownershipPercentage: String(oPct) } : {}),
        ...(nonEmpty(o.email) ? { email: nonEmpty(o.email) as string } : {}),
        ...(oAddress ? { homeAddress: oAddress } : {}),
      });
    }
  }
  const shareTotal = owners.reduce((sum, o) => sum + (Number(o.ownershipPercentage) || 0), 0);
  if (shareTotal > 100) {
    gaps.push({ field: "owner:shares", label: `Ownership adds up to ${shareTotal}% — it can't pass 100%`, kind: "invalid" });
  }

  // ── Business ─────────────────────────────────────────────────────────────
  // The vault's DBA, legal name and EIN describe the PRIMARY business only.
  const isPrimaryBusiness = !b || b.is_primary;
  const legalName = isPrimaryBusiness
    ? nonEmpty(v.company_name) ?? nonEmpty(b?.company_name)
    : nonEmpty(b?.company_name) ?? nonEmpty(b?.business_name);
  if (!legalName) gaps.push({ field: "business_name", label: "Business legal name (edit the client profile)", kind: "missing" });
  const dba = isPrimaryBusiness ? nonEmpty(v.dba) ?? nonEmpty(b?.business_name) : nonEmpty(b?.business_name);
  // r.ein is already null for a non-primary business (scopeResolvedToBusiness).
  const ein = digitsOnly(r.ein);
  if (r.ein && ein.length !== 9) gaps.push({ field: "ein", label: "EIN (9 digits)", kind: "invalid" });

  const phone = toSamsonPhone(b?.phone) ?? cell;
  if (!phone) gaps.push({ field: "client_phone", label: "Phone (10-digit US number)", kind: r.client_phone ? "invalid" : "missing" });
  const started = toIsoDate(b?.business_start_date) ?? toIsoDate(v.business_start_date);
  if (!started) {
    gaps.push({ field: "business_start_date", label: "Business start date (edit the client profile)", kind: "missing" });
  }
  for (const field of ["business_street", "company_city", "company_state", "company_zip_code"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const bizAddress = address(r.business_street, r.company_city, r.company_state, r.company_zip_code);

  const entityType = nonEmpty(b?.legal_entity_type) ?? (isPrimaryBusiness ? nonEmpty(v.legal_entity_type) : null);
  const rawIndustry = nonEmpty(b?.industry) ?? (isPrimaryBusiness ? nonEmpty(v.industry) : null);
  const naics = resolveNaics(rawIndustry);

  // ── Deal ─────────────────────────────────────────────────────────────────
  const requested = toInt(d?.capital_requested ?? v.capital_requested);
  const monthly = monthlyRevenueOf(source, isPrimaryBusiness);
  const purpose = nonEmpty(d?.loan_purpose ?? v.loan_purpose);
  const rep = source.salesRep ?? null;
  const repPhone = toSamsonPhone(rep?.phone);

  // Samson has no reference field, so ours rides at the top of the notes.
  const submissionNotes = [`Credit Banc ref: ${ctx.referenceId}`, purpose, nonEmpty(d?.file_synopsis)]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);

  const payload: SamsonRecord = {
    business: {
      ...(ein.length === 9 ? { taxID: `${ein.slice(0, 2)}-${ein.slice(2)}` } : {}),
      name: legalName ?? "",
      phone: phone ?? "",
      businessInceptionDate: started ?? "",
      // We don't record the state of incorporation; the business's own state is the best we have.
      ...(toStateName(r.company_state) ? { stateOfIncorporation: toStateName(r.company_state) as string } : {}),
      ...(dba && dba !== legalName ? { dba } : {}),
      ...(nonEmpty(v.client_email) ? { email: nonEmpty(v.client_email) as string } : {}),
      ...(naics ? { industry: naics.title } : rawIndustry ? { industry: rawIndustry } : {}),
      ...(entityType ? { entityType } : {}),
      dealType: effectivePicks.deal_type ?? "",
      ...(naics ? { naicsCode: naics.code } : {}),
      address: bizAddress ?? { addressLine1: "", city: "", state: "", zipCode: "" },
    },
    owners,
    sales: {
      ...(nonEmpty(rep?.firstName) ? { firstName: nonEmpty(rep?.firstName) as string } : {}),
      ...(nonEmpty(rep?.lastName) ? { lastName: nonEmpty(rep?.lastName) as string } : {}),
      ...(nonEmpty(rep?.email) ? { repEmail: nonEmpty(rep?.email) as string } : {}),
      ...(repPhone ? { repPhone } : {}),
      salesOffice: SAMSON_SALES_OFFICE,
    },
    selfReported: {
      ...(monthly ? { monthlyRevenue: String(monthly) } : {}),
      ...(requested && requested > 0 ? { desiredLoanAmount: String(requested) } : {}),
      ...(purpose ? { useOfFunds: purpose.slice(0, 255) } : {}),
    },
    submissionNotes,
  };

  return { payload, redacted: redactSamsonRecord(payload), gaps, effectivePicks };
}

// ── Documents ──────────────────────────────────────────────────────────────

export function samsonDocType(docCode: string | null): string | null {
  if (!docCode) return null;
  return SAMSON_DOC_TYPES.find((t) => t.docCodes.includes(docCode))?.docType ?? null;
}

export function samsonTagsForDocCode(docCode: string | null): string[] {
  const t = samsonDocType(docCode);
  return t ? [t] : [];
}

// ── Responses ──────────────────────────────────────────────────────────────

/** Create Record answers {"Status":"Success","OpportunityId":"006…"}; anything else is not a success. */
export function readSamsonOpportunityId(data: unknown): string | null {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (String(d.Status ?? "").toLowerCase() !== "success") return null;
  const id = d.OpportunityId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Samson has no status API: a sent deal is "Submitted" until UW records Samson's answer by hand. */
export function interpretSamsonStatus(raw: unknown): NormalizedStatus {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const stage = typeof s.stage === "string" && s.stage ? s.stage : "Submitted";
  return { kind: "in_progress", stage };
}
