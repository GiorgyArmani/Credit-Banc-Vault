// src/lib/lender-api/providers/smartbiz/mapping.ts
//
// Pure: our deal → SmartBiz POST /v3/business + POST /v3/submission bodies,
// plus their dropdowns, document types and status reading. No I/O, no env.

import { createHash } from "node:crypto";
import type { BuiltApplication, Gap, LenderApiSource, NormalizedStatus, PickDefinition, Picks } from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { digitsOnly, nonEmpty, splitName, toInt, toIsoDate } from "../../normalize";
import { resolveNaics } from "@/data/naics";
import {
  SMARTBIZ_ANSWERS,
  SMARTBIZ_BUSINESS_TAX_CODES,
  SMARTBIZ_BUSINESS_TYPES,
  SMARTBIZ_DOCUMENT_TYPES,
  SMARTBIZ_MAX_AMOUNT,
  SMARTBIZ_MIN_AMOUNT,
  SMARTBIZ_MIN_OWNER_PCT,
  SMARTBIZ_OTHER_DOCUMENT_TYPE,
  SMARTBIZ_PERSONAL_TAX_CODES,
  SMARTBIZ_PRODUCTS,
} from "./constants";

interface SmartBizAddress {
  tags: string[];
  address_1: string;
  address_2?: string;
  city: string;
  state: string;
  zip: string;
}
interface SmartBizPhone {
  number: string;
  name: "home" | "mobile" | "fax" | "business";
}
export interface SmartBizOwner {
  percent_owned: number;
  type: "person";
  owner: {
    first_name: string;
    last_name: string;
    ssn: string;
    birthday: string;
    email: string;
    phone_numbers: SmartBizPhone[];
    addresses: SmartBizAddress[];
  };
}
export interface SmartBizBusinessRequest {
  tin?: { type: "ein"; value: string };
  name: string;
  inception_date: string;
  business_story?: string;
  type?: string;
  addresses: SmartBizAddress[];
  industry: string;
  profile: { number_of_employees: number; annual_revenue: number };
  phone_numbers: SmartBizPhone[];
  email: string;
  client_reference_id: string;
  owners: SmartBizOwner[];
}
export interface SmartBizSubmissionRequest {
  business_id: string;
  requested_products?: string[];
  loan_application: { amount_requested: number };
  client_reference_id: string;
  business_history: {
    business_operating_at_least_two_years: string;
    has_past_bankruptcy: string;
    has_defaulted_on_government_guaranteed_loan: string;
  };
}
/** What buildApplication returns: two calls' bodies, sent in order by the provider. */
export interface SmartBizApplication {
  business: SmartBizBusinessRequest;
  submission: Omit<SmartBizSubmissionRequest, "business_id">;
  clientReferenceId: string;
}

export const SMARTBIZ_PICKS: readonly PickDefinition[] = [
  { key: "business_type", label: "Business type", options: SMARTBIZ_BUSINESS_TYPES, required: true },
  { key: "requested_product", label: "Product (any = SmartBiz evaluates all)", options: SMARTBIZ_PRODUCTS, required: true },
  { key: "business_operating_at_least_two_years", label: "Operating at least 2 years?", options: SMARTBIZ_ANSWERS, required: true },
  { key: "has_past_bankruptcy", label: "Past bankruptcy?", options: SMARTBIZ_ANSWERS, required: true },
  {
    key: "has_defaulted_on_government_guaranteed_loan",
    label: "Defaulted on a government-guaranteed loan?",
    options: SMARTBIZ_ANSWERS,
    required: true,
  },
];

export const SMARTBIZ_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
  "owner_1_name",
  "ssn",
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
];

/** A deterministic UUID4-shaped id: the same attempt always sends the same reference. */
export function clientReferenceUuid(referenceId: string): string {
  const h = createHash("sha256").update(referenceId).digest("hex").slice(0, 32).split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export function mapSmartBizBusinessType(v: string | null | undefined): string | null {
  const s = (v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s === "llc" || s === "limitedliabilitycompany") return "llc";
  if (["soleprop", "soleproprietor", "soleproprietorship", "sprop"].includes(s)) return "sprop";
  if (s === "scorp" || s === "scorporation") return "scorp";
  if (s === "ccorp" || s === "ccorporation") return "ccorp";
  if (s === "llp" || s === "limitedliabilitypartnership") return "llp";
  if (["partnership", "generalpartnership", "gp"].includes(s)) return "gp";
  if (s === "lp" || s === "limitedpartnership") return "lp";
  if (s === "nonprofit" || s === "notforprofit") return "np";
  if (s === "contractor" || s === "independentcontractor") return "contractor";
  // "Corporation"/"Inc" can be S or C — UW picks.
  return null;
}

function yearsSince(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function startDate(source: LenderApiSource): string | null {
  return toIsoDate(source.business?.business_start_date) ?? toIsoDate(source.vault.business_start_date);
}

export function suggestSmartBizPicks(source: LenderApiSource): Record<string, string | null> {
  const { vault, business, analysis } = source;
  const years = yearsSince(startDate(source));
  return {
    business_type: mapSmartBizBusinessType(business?.legal_entity_type ?? vault.legal_entity_type),
    requested_product: "any",
    business_operating_at_least_two_years: years === null ? null : years >= 2 ? "yes" : "no",
    has_past_bankruptcy: analysis?.has_bankruptcy === true ? "yes" : analysis?.has_bankruptcy === false ? "no" : null,
    // Nothing on file answers this one.
    has_defaulted_on_government_guaranteed_loan: null,
  };
}

function phone10(v: unknown): string | null {
  const d = digitsOnly(v);
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length === 10 ? d : null;
}

export function redactSmartBizApplication(app: SmartBizApplication): SmartBizApplication {
  return {
    ...app,
    business: {
      ...app.business,
      owners: app.business.owners.map((o) => {
        const d = digitsOnly(o.owner.ssn);
        return { ...o, owner: { ...o.owner, ssn: d ? `*****${d.slice(-4)}` : "" } };
      }),
    },
  };
}

export function buildSmartBizApplication(source: LenderApiSource, picks: Picks, ctx: { referenceId: string }): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d, analysis } = source;
  const clientReferenceId = clientReferenceUuid(ctx.referenceId);

  const effectivePicks: Record<string, string | null> = { ...suggestSmartBizPicks(source) };
  for (const def of SMARTBIZ_PICKS) {
    const chosen = nonEmpty(picks[def.key]);
    if (chosen) effectivePicks[def.key] = chosen;
  }
  for (const def of SMARTBIZ_PICKS) {
    const value = effectivePicks[def.key];
    if (!value) {
      if (def.required) gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "missing" });
    } else if (!def.options.includes(value)) {
      gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "invalid" });
    }
  }

  // ── Owner 1 ──────────────────────────────────────────────────────────────
  const name = splitName(r.owner_1_name);
  if (!name.first || !name.last) gaps.push({ field: "owner_1_name", label: "Owner first and last name", kind: "missing" });
  const ssn = digitsOnly(r.ssn);
  // Required by us, not their schema: a submission runs a soft credit pull.
  if (ssn.length !== 9) gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: r.ssn ? "invalid" : "missing" });
  const dob = toIsoDate(r.owner_1_dob);
  if (!dob) gaps.push({ field: "owner_1_dob", label: VAULT_FIELD_LABELS.owner_1_dob, kind: "missing" });
  for (const field of ["owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const email = nonEmpty(v.client_email);
  if (!email) gaps.push({ field: "client_email", label: "Client email (edit the client profile)", kind: "missing" });
  const cell = phone10(r.client_phone);
  if (!cell) gaps.push({ field: "client_phone", label: "Owner phone (10 digits)", kind: r.client_phone ? "invalid" : "missing" });
  // Never invent a share: a missing/0% owner 1 is a gap, not 100%.
  const pct1 = toInt(v.owner_1_ownership_pct);
  if (pct1 === null || pct1 === 0) {
    gaps.push({ field: "owner:1", label: "Owner 1 ownership %", kind: "missing" });
  } else if (!(pct1 > 0 && pct1 <= 100)) {
    gaps.push({ field: "owner:1", label: `Owner 1 ownership % (${pct1}%)`, kind: "invalid" });
  }
  const owner1Pct = pct1 ?? 0;

  // ── Owners 2–5 ───────────────────────────────────────────────────────────
  // Every 20%+ owner must be sent complete; under 20% is never sent.
  const coOwners: SmartBizOwner[] = [];
  if (!source.ownersAvailable) {
    // Co-owners unknown, not absent: never silently send a single-owner file.
    const vv = v as unknown as Record<string, unknown>;
    for (const n of [2, 3, 4, 5] as const) {
      const pct = toInt(vv[`owner_${n}_ownership_pct`]);
      if (pct !== null && pct >= SMARTBIZ_MIN_OWNER_PCT) {
        gaps.push({
          field: `owner:${n}`,
          label: `Owner ${n} (${nonEmpty(vv[`owner_${n}_name`]) ?? "unnamed"}, ${pct}%): owner details can't be loaded yet`,
          kind: "missing",
        });
      }
    }
  } else {
    for (const o of [...source.owners].sort((a, b) => a.position - b.position)) {
      // A named owner at 0% is almost always a share nobody filled in — ask,
      // don't drop. Between 0 and 20% is SmartBiz's own rule: never sent.
      if (o.ownership_pct === 0 && nonEmpty(o.full_name)) {
        gaps.push({
          field: `owner:${o.position}`,
          label: `Owner ${o.position} (${o.full_name}, 0%): confirm the ownership %`,
          kind: "invalid",
        });
        continue;
      }
      if (!(o.ownership_pct >= SMARTBIZ_MIN_OWNER_PCT)) continue;
      const on = splitName(o.full_name);
      const oDob = toIsoDate(o.dob);
      const oSsn = digitsOnly(o.ssn);
      const oPhone = phone10(o.phone);
      const oEmail = nonEmpty(o.email);
      const missing: string[] = [];
      if (!on.first || !on.last) missing.push("full name");
      if (!oDob) missing.push("DOB");
      if (oSsn.length !== 9) missing.push("SSN");
      if (!nonEmpty(o.street) || !nonEmpty(o.city) || !nonEmpty(o.state) || !nonEmpty(o.zip)) missing.push("home address");
      if (!oEmail) missing.push("email");
      if (!oPhone) missing.push("phone");
      if (missing.length) {
        gaps.push({
          field: `owner:${o.position}`,
          label: `Owner ${o.position} (${o.full_name}, ${o.ownership_pct}%): missing ${missing.join(", ")}`,
          kind: "missing",
        });
        continue;
      }
      coOwners.push({
        percent_owned: o.ownership_pct,
        type: "person",
        owner: {
          first_name: on.first as string,
          last_name: on.last as string,
          ssn: oSsn,
          birthday: oDob as string,
          email: oEmail as string,
          phone_numbers: [{ number: oPhone as string, name: "mobile" }],
          addresses: [{ tags: ["primary"], address_1: o.street as string, city: o.city as string, state: o.state as string, zip: o.zip as string }],
        },
      });
    }
  }
  const shareTotal = owner1Pct + coOwners.reduce((sum, o) => sum + o.percent_owned, 0);
  if (shareTotal > 100) {
    gaps.push({ field: "owner:shares", label: `Ownership adds up to ${shareTotal}% — it can't pass 100%`, kind: "invalid" });
  }

  // ── Business ─────────────────────────────────────────────────────────────
  const isPrimaryBusiness = !b || b.is_primary;
  const legalName = isPrimaryBusiness
    ? nonEmpty(v.company_name) ?? nonEmpty(b?.company_name)
    : nonEmpty(b?.company_name) ?? nonEmpty(b?.business_name);
  if (!legalName) gaps.push({ field: "business_name", label: "Business legal name (edit the client profile)", kind: "missing" });
  // EIN is optional for SmartBiz; the vault's EIN describes the primary business only.
  const ein = isPrimaryBusiness ? digitsOnly(r.ein) : "";
  for (const field of ["business_street", "company_city", "company_state", "company_zip_code"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const bizPhone = phone10(b?.phone) ?? cell;
  const started = startDate(source);
  if (!started) gaps.push({ field: "business_start_date", label: "Business start date (edit the client profile)", kind: "missing" });

  const rawIndustry = nonEmpty(b?.industry) ?? (isPrimaryBusiness ? nonEmpty(v.industry) : null);
  const naics = resolveNaics(rawIndustry);
  if (!rawIndustry) {
    gaps.push({ field: "business:industry", label: "Industry (NAICS)", kind: "missing" });
  } else if (!naics) {
    gaps.push({ field: "business:industry", label: `Industry needs a NAICS code (currently "${rawIndustry}")`, kind: "invalid" });
  }

  const employees = b?.employees_count ?? null;
  if (employees === null || employees === undefined) {
    gaps.push({ field: "business:employees_count", label: "Employee count", kind: "missing" });
  } else if (employees <= 0) {
    // 0 is what the fast form writes when nobody asked.
    gaps.push({ field: "business:employees_count", label: "Employee count is 0 — confirm it", kind: "invalid" });
  }

  const annualRevenue =
    toInt(b?.avg_annual_revenue) ||
    (analysis?.avg_revenue ? Math.round(analysis.avg_revenue * 12) : null) ||
    (b?.avg_monthly_deposits ? Math.round(b.avg_monthly_deposits * 12) : null) ||
    // Deposits often live only on the vault (the profile header reads them from
    // there). Like the other vault fields, they describe the primary business.
    (isPrimaryBusiness && v.avg_monthly_deposits ? Math.round(v.avg_monthly_deposits * 12) : null);
  if (!annualRevenue) {
    gaps.push({
      field: "annual_revenue",
      label: "Annual revenue (set monthly deposits on the client profile, or run the bank analysis)",
      kind: "missing",
    });
  }

  const requested = toInt(d?.capital_requested ?? v.capital_requested);
  if (!requested || requested <= 0) {
    gaps.push({ field: "capital_requested", label: "Requested amount (edit the funding deal)", kind: "missing" });
  } else if (requested < SMARTBIZ_MIN_AMOUNT || requested > SMARTBIZ_MAX_AMOUNT) {
    gaps.push({ field: "capital_requested", label: "SmartBiz takes $50,000–$350,000 (edit the funding deal)", kind: "invalid" });
  }

  const product = effectivePicks.requested_product;
  const business: SmartBizBusinessRequest = {
    ...(ein.length === 9 ? { tin: { type: "ein" as const, value: ein } } : {}),
    name: legalName ?? "",
    inception_date: started ?? "",
    ...(nonEmpty(d?.file_synopsis) ? { business_story: nonEmpty(d?.file_synopsis) as string } : {}),
    ...(effectivePicks.business_type ? { type: effectivePicks.business_type } : {}),
    addresses: [
      {
        tags: ["primary"],
        address_1: r.business_street ?? "",
        city: r.company_city ?? "",
        state: r.company_state ?? "",
        zip: r.company_zip_code ?? "",
      },
    ],
    industry: naics?.code ?? "",
    profile: { number_of_employees: employees && employees > 0 ? employees : 0, annual_revenue: annualRevenue ?? 0 },
    phone_numbers: bizPhone ? [{ number: bizPhone, name: "business" }] : [],
    email: email ?? "",
    client_reference_id: clientReferenceId,
    owners: [
      {
        percent_owned: owner1Pct,
        type: "person",
        owner: {
          first_name: name.first ?? "",
          last_name: name.last ?? "",
          ssn: ssn.length === 9 ? ssn : "",
          birthday: dob ?? "",
          email: email ?? "",
          phone_numbers: cell ? [{ number: cell, name: "mobile" }] : [],
          addresses: [
            {
              tags: ["primary"],
              address_1: r.owner_1_street ?? "",
              city: r.owner_1_city ?? "",
              state: r.owner_1_state ?? "",
              zip: r.owner_1_zip ?? "",
            },
          ],
        },
      },
      ...coOwners,
    ],
  };
  if (!business.tin) delete business.tin;

  const submission: SmartBizApplication["submission"] = {
    ...(product && product !== "any" ? { requested_products: [product] } : {}),
    loan_application: { amount_requested: requested ?? 0 },
    client_reference_id: clientReferenceId,
    business_history: {
      business_operating_at_least_two_years: effectivePicks.business_operating_at_least_two_years ?? "",
      has_past_bankruptcy: effectivePicks.has_past_bankruptcy ?? "",
      has_defaulted_on_government_guaranteed_loan: effectivePicks.has_defaulted_on_government_guaranteed_loan ?? "",
    },
  };

  const app: SmartBizApplication = { business, submission, clientReferenceId };
  return { payload: app, redacted: redactSmartBizApplication(app), gaps, effectivePicks };
}

// ── Documents ──────────────────────────────────────────────────────────────

const TAX_BUCKETS = ["last_years", "two_years_ago", "three_years_ago"] as const;

/**
 * Tax returns go in year buckets relative to the last tax year. The year is
 * read from the filename; unreadable or out-of-range → last year's bucket
 * with no tax_year (SmartBiz then files it by its own review).
 */
export function smartBizDocumentUpload(docCode: string | null, filename: string, now: Date): { document_type: string; tax_year?: number } {
  const kind = docCode && (SMARTBIZ_BUSINESS_TAX_CODES as readonly string[]).includes(docCode)
    ? "business"
    : docCode && (SMARTBIZ_PERSONAL_TAX_CODES as readonly string[]).includes(docCode)
      ? "personal"
      : null;
  if (kind) {
    const year = Number(filename.match(/(?:^|\D)(20\d{2})(?:\D|$)/)?.[1]);
    const offset = Number.isFinite(year) ? now.getUTCFullYear() - 1 - year : -1;
    if (offset >= 0 && offset < TAX_BUCKETS.length) {
      return { document_type: `${TAX_BUCKETS[offset]}_${kind}_tax_return`, tax_year: year };
    }
    return { document_type: `last_years_${kind}_tax_return` };
  }
  if (!docCode) return { document_type: SMARTBIZ_OTHER_DOCUMENT_TYPE };
  const type = SMARTBIZ_DOCUMENT_TYPES.find((t) => t.docCodes.includes(docCode))?.type;
  return { document_type: type ?? SMARTBIZ_OTHER_DOCUMENT_TYPE };
}

export function smartBizTagsForDocCode(docCode: string | null): string[] {
  return [smartBizDocumentUpload(docCode, "", new Date()).document_type];
}

// ── Status ─────────────────────────────────────────────────────────────────

interface SmartBizSubmissionResponse {
  data?: {
    id?: string;
    attributes?: {
      loan_application?: { status?: string | null; status_reasons?: Array<{ description?: string }> | null };
    };
  };
}

const APPROVED = new Set(["OFFER_GENERATED", "CLOSING", "FUNDED"]);
const NEEDS_HUMAN = new Set(["WITHDRAWN", "EXPIRED"]);

export function interpretSmartBizStatus(raw: unknown): NormalizedStatus {
  const app = (raw as SmartBizSubmissionResponse | null)?.data?.attributes?.loan_application;
  const status = nonEmpty(app?.status)?.toUpperCase() ?? null;
  if (!status) return { kind: "in_progress", stage: "Submitted" };
  if (APPROVED.has(status)) return { kind: "approved", stage: status, note: `SmartBiz: ${status}` };
  if (status === "DECLINED") {
    const reasons = (app?.status_reasons ?? []).map((x) => nonEmpty(x?.description)).filter(Boolean);
    return {
      kind: "declined",
      stage: status,
      note: reasons.length ? `SmartBiz declined: ${reasons.join("; ")}` : "SmartBiz declined at pre-qualification (no reasons given)",
    };
  }
  if (NEEDS_HUMAN.has(status)) return { kind: "needs_info", stage: status, note: `SmartBiz marked this application ${status}.` };
  return { kind: "in_progress", stage: status };
}
