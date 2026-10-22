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
import {
  SAMSON_DEAL_TYPES,
  SAMSON_DOC_TYPES,
  SAMSON_ENTITY_TYPES,
  SAMSON_INDUSTRIES,
  SAMSON_SALES_OFFICE,
} from "./constants";

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
  { key: "entity_type", label: "Entity type", options: SAMSON_ENTITY_TYPES, required: false },
  { key: "industry", label: "Industry", options: SAMSON_INDUSTRIES, required: false },
];

export const SAMSON_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
  "owner_1_name",
  "ssn",
  "owner_1_dob",
  "ein",
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

/** Our vault's entity spellings (LLC, S-Corp, Sole Prop, ...) → Samson's picklist. */
export function mapSamsonEntityType(v: string | null | undefined): (typeof SAMSON_ENTITY_TYPES)[number] | null {
  const s = (v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s === "llc" || s === "limitedliabilitycompany") return "LLC";
  if (s === "llp" || s === "limitedliabilitypartnership") return "LLP";
  if (s === "lp" || s === "limitedpartnership") return "Limited Partnership";
  if (s === "partnership" || s === "generalpartnership" || s === "gp") return "Partnership";
  if (s === "scorp" || s === "scorporation") return "S-Corp";
  if (s === "ccorp" || s === "ccorporation") return "C-Corp";
  if (["corp", "corporation", "inc"].includes(s)) return "Corporation";
  if (["soleprop", "soleproprietor", "soleproprietorship"].includes(s)) return "Sole Proprietor";
  return null;
}

// First match wins, so specific rules precede broad ones
// ("home health" before "health", "veterinary" before "clinic").
const INDUSTRY_RULES: Array<[RegExp, (typeof SAMSON_INDUSTRIES)[number]]> = [
  [/veterinar|animal hospital/i, "Veterinary Clinic"],
  [/home health|senior care|home care|therap/i, "Health Services"],
  [/health|medical|dental|dentist|clinic|physician|pharmac/i, "Healthcare"],
  [/salon|\bspa\b|barber|beauty|nail/i, "Beauty Salon / Spa"],
  [/restaurant|\bbar\b|catering|cafe|food service/i, "Restaurant/Bar"],
  [/grocery|bakery|baked|convenience|\bdeli\b|supermarket/i, "Grocery and Baked Goods"],
  [/food|beverage|liquor|wine|brew/i, "Food & Beverage"],
  [/hotel|motel|lodging|\binn\b/i, "Hotel, Motel, and Lodging"],
  [/hospitality/i, "Hospitality"],
  [/auto|mechanic|car sales|rv dealer|vehicle|bicycle|motor/i, "Automotive/Bicycle"],
  [/truck|freight|transport|logistic|towing|travel/i, "Travel and Transportation"],
  [/shipping|courier|delivery/i, "Shipping"],
  [/garden|nursery/i, "Garden Store / Retail Nursery"],
  [/landscap|lawn|farm|agricultur|crop|ranch/i, "Agriculture and Landscaping"],
  [/building material|lumber/i, "Building Materials"],
  [/electric|plumb|hvac|construct|contractor|remodel|roof|painting|builder|restoration|fire safety/i, "Construction"],
  [/engineer/i, "Engineering"],
  [/manufactur|fabricat/i, "Manufacturing"],
  [/machine/i, "Machinery"],
  [/wholesale|distribut/i, "Wholesale"],
  [/laundr|dry clean|garment/i, "Laundry and Garment Services"],
  [/apparel|clothing|fashion|boutique/i, "Apparel and Accessories"],
  [/furniture|home furnish/i, "Home Furnishing"],
  [/insurance/i, "Insurance"],
  [/\bbank/i, "Banking"],
  [/financ|lending|mortgage|invest/i, "Finance"],
  [/consult|marketing/i, "Consulting"],
  [/school|education|tutor|daycare|training/i, "Education"],
  [/software|tech|computer|\bit\b|saas/i, "Technology"],
  [/telecom/i, "Telecommunications"],
  [/media|publish|advertis/i, "Media"],
  [/\bgym|fitness|recreation/i, "Recreation"],
  [/entertain|concert|venue|event/i, "Entertainment"],
  [/solar|energy|oil\b/i, "Energy"],
  [/non-?profit|church|charity/i, "Not For Profit"],
  [/staffing|janitor|cleaning|security|legal|\blaw\b|attorney|account|bookkeep|\bcpa\b|real estate|property/i, "Business Services"],
  [/retail|store|shop|e-?commerce/i, "Retail Store"],
];

export function suggestSamsonIndustry(text: string | null | undefined): (typeof SAMSON_INDUSTRIES)[number] | null {
  const s = nonEmpty(text);
  if (!s) return null;
  return INDUSTRY_RULES.find(([re]) => re.test(s))?.[1] ?? null;
}

export function suggestSamsonPicks(source: LenderApiSource): Record<string, string | null> {
  const { vault, business } = source;
  const isPrimary = !business || business.is_primary;
  return {
    deal_type: "New",
    entity_type: mapSamsonEntityType(business?.legal_entity_type ?? (isPrimary ? vault.legal_entity_type : null)),
    industry: suggestSamsonIndustry(business?.industry ?? (isPrimary ? vault.industry : null)),
  };
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
  const effectivePicks: Record<string, string | null> = { ...suggestSamsonPicks(source) };
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
  if (!dob) gaps.push({ field: "owner_1_dob", label: VAULT_FIELD_LABELS.owner_1_dob, kind: r.owner_1_dob ? "invalid" : "missing" });
  const pct1 = share(v.owner_1_ownership_pct);
  if (!pct1) {
    gaps.push({ field: "owner:1", label: "Owner 1 ownership % (edit the client profile)", kind: v.owner_1_ownership_pct ? "invalid" : "missing" });
  }
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
      // Samson requires DOB, share and home address for EVERY owner.
      const oDob = toIsoDate(o.dob);
      const oAddress = address(o.street, o.city, o.state, o.zip);
      const oPct = share(o.ownership_pct);
      const missing = [!oDob && "date of birth", !oAddress && "home address", !oPct && "ownership %"].filter(Boolean);
      if (missing.length > 0) {
        gaps.push({ field: `owner:${o.position}`, label: `${label}: missing ${missing.join(", ")}`, kind: "missing" });
        continue;
      }
      const oPhone = toSamsonPhone(o.phone);
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
  if (ein.length !== 9) gaps.push({ field: "ein", label: "EIN (9 digits)", kind: r.ein ? "invalid" : "missing" });

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

  // Entity type and industry go out ONLY as Samson picklist values (the picks);
  // the vault's free text is just where the suggestion comes from.
  const entityType = effectivePicks.entity_type;
  const industry = effectivePicks.industry;
  const naics = resolveNaics(nonEmpty(b?.industry) ?? (isPrimaryBusiness ? nonEmpty(v.industry) : null));

  // ── Deal ─────────────────────────────────────────────────────────────────
  const requested = toInt(d?.capital_requested ?? v.capital_requested);
  if (!requested || requested <= 0) {
    gaps.push({ field: "capital_requested", label: "Requested amount (edit the funding deal)", kind: "missing" });
  }
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
      ...(industry ? { industry } : {}),
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
