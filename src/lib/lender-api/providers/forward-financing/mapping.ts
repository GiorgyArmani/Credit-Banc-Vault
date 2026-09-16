// src/lib/lender-api/providers/forward-financing/mapping.ts
//
// Pure: our deal → Forward Financing POST /v1/lead body, plus FF's dropdowns,
// document tags and status reading. No I/O, no env — fully unit tested.

import type {
  BuiltApplication,
  Gap,
  LenderApiSource,
  NormalizedStatus,
  OutboundDocument,
  OutboundDocumentResult,
  PickDefinition,
  Picks,
} from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { digitsOnly, nonEmpty, splitName, toInt, toIsoDate } from "../../normalize";
import { FF_ENTITY_TYPES, FF_INDUSTRIES, FF_LOAN_USES, FF_REVENUE_BUCKETS } from "./constants";

interface FfAddress {
  street1: string;
  street2?: string;
  city?: string;
  state: string;
  zip: string;
}

export interface FfLeadRequest {
  lead: {
    contacts_attributes: Array<{
      first_name: string;
      last_name: string;
      email?: string;
      title?: string;
      born_on?: string;
      home_phone?: string;
      cell_phone?: string;
      ssn: string;
      current_address_attributes: FfAddress;
    }>;
    account_attributes: {
      entity_type: string;
      name: string;
      started_on: string;
      legal_name?: string;
      phone: string;
      email?: string;
      fein?: string;
      monthly_revenue?: string;
      industry_name: string;
      current_address_attributes?: FfAddress;
    };
    loan_attributes?: { company_name?: string; daily_payment_amount?: number; balance?: number };
    application_attributes: {
      has_current_loan?: boolean;
      applicant_is_owner?: boolean;
      loan_use?: string;
      capital_needed?: string;
      owner_1_percent_ownership?: number;
      owner_2_percent_ownership?: number;
      reference_id: string;
      notes?: string;
    };
  };
}

export const FF_PICKS: readonly PickDefinition[] = [
  { key: "entity_type", label: "Entity type", options: FF_ENTITY_TYPES, required: true },
  { key: "industry_name", label: "Industry", options: FF_INDUSTRIES, required: true },
  { key: "loan_use", label: "Use of funds", options: FF_LOAN_USES, required: false },
  { key: "monthly_revenue", label: "Monthly revenue", options: FF_REVENUE_BUCKETS, required: false },
];

export const FF_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
  "owner_1_name",
  "ssn",
  "owner_1_street",
  "owner_1_state",
  "owner_1_zip",
  "client_phone",
];

/** Drop null/undefined/"" keys so optional FF fields are omitted, not sent empty. */
function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")
  ) as T;
}

export function mapFfEntityType(v: string | null | undefined): string | null {
  const s = (v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s === "llc") return "LLC";
  if (s === "llp" || s === "limitedliabilitypartnership") return "Limited Liability Partnership";
  if (s === "lp" || s === "limitedpartnership") return "Limited Partnership";
  if (s === "partnership" || s === "generalpartnership" || s === "gp") return "General Partnership";
  if (["scorp", "ccorp", "corp", "corporation", "inc"].includes(s)) return "Corporation";
  if (["soleprop", "soleproprietor", "soleproprietorship"].includes(s)) return "Sole Proprietor";
  return null;
}

export function bucketMonthlyRevenue(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined || !(amount > 0)) return null;
  if (amount < 5000) return FF_REVENUE_BUCKETS[0];
  if (amount < 10000) return FF_REVENUE_BUCKETS[1];
  if (amount < 20000) return FF_REVENUE_BUCKETS[2];
  if (amount < 50000) return FF_REVENUE_BUCKETS[3];
  if (amount <= 100000) return FF_REVENUE_BUCKETS[4];
  return FF_REVENUE_BUCKETS[5];
}

// First match wins, so specific rules precede broad ones
// ("Electrical Contractors" must hit HVAC before "contractor").
const INDUSTRY_RULES: Array<[RegExp, (typeof FF_INDUSTRIES)[number]]> = [
  [/account|\bcpa\b|tax prep|bookkeep/i, "Accounting & Tax Services"],
  [/electric|plumb|hvac|heating|air condition/i, "Electricians/Plumbing/HVAC"],
  [/truck|freight|transport|logistic|towing/i, "Trucking & Transportation"],
  [/auto|mechanic|car sales|rv dealer|vehicle|motor/i, "Automotive"],
  [/restaurant|\bbar\b|catering|food service|cafe/i, "Restaurants & Bars"],
  [/gas station/i, "Gas Stations"],
  [/convenience/i, "Convenience Stores"],
  [/pharmac/i, "Pharmacies"],
  [/home health/i, "Home Healthcare"],
  [/health|medical|dental|dentist|clinic|physician/i, "Medical"],
  [/farm|agricultur|soil|planting|crop/i, "Farming"],
  [/subcontract/i, "Subcontractor"],
  [/construct|contractor|remodel|roofing|painting|restoration|builder/i, "General Contractor"],
  [/landscap|lawn/i, "Landscaping"],
  [/janitor|cleaning/i, "Janitorial"],
  [/manufactur/i, "Manufacturing"],
  [/wholesale|distribut/i, "Wholesale & Distribution"],
  [/wine|liquor/i, "Wine & Liquor"],
  [/jewel/i, "Jewelry"],
  [/furniture/i, "Furniture"],
  [/salon|\bspa\b|barber|beauty/i, "Salons & Spas"],
  [/\bgym|fitness/i, "Gyms"],
  [/hotel|motel|hospitality/i, "Hotels/Hospitality"],
  [/\blaw\b|legal|attorney/i, "Law Firms"],
  [/real estate|insurance|property/i, "Real Estate/Insurance"],
  [/recycl/i, "Recycling"],
  [/security guard|security services/i, "Security Guard"],
  [/staffing|recruit/i, "Staffing"],
  [/travel/i, "Travel"],
  [/ticket|concert|venue/i, "Ticket/Concert Venues"],
  [/school|education|tutor/i, "Education"],
  [/consult|marketing/i, "Consulting"],
  [/retail|store|shop|e-?commerce|eccomerce/i, "Retail"],
];

export function suggestFfIndustry(text: string | null | undefined): string | null {
  const s = nonEmpty(text);
  if (!s) return null;
  return INDUSTRY_RULES.find(([re]) => re.test(s))?.[1] ?? null;
}

const LOAN_USE_RULES: Array<[RegExp, (typeof FF_LOAN_USES)[number]]> = [
  [/consolidat|refinanc|pay ?off|extinguish/i, "Debt Refinancing"],
  [/equipment repair/i, "Equipment Repair"],
  [/equipment|machine/i, "Equipment Purchase"],
  [/inventory|purchase order/i, "Inventory"],
  [/location/i, "New Location"],
  [/renovat|remodel/i, "Renovation"],
  [/\bhir(e|es|ing)\b/i, "Hiring Employees"],
  [/payroll/i, "Payroll"],
  [/marketing/i, "Marketing"],
  [/\btax/i, "Taxes"],
  [/material/i, "Materials"],
  [/expan/i, "Business Expansion"],
];

export function suggestFfLoanUse(text: string | null | undefined): string {
  const s = nonEmpty(text);
  if (!s) return "Working Capital";
  return LOAN_USE_RULES.find(([re]) => re.test(s))?.[1] ?? "Working Capital";
}

export function suggestFfPicks(source: LenderApiSource): Record<string, string | null> {
  const { vault, business, deal, analysis } = source;
  return {
    entity_type: mapFfEntityType(business?.legal_entity_type ?? vault.legal_entity_type),
    industry_name: suggestFfIndustry(business?.industry ?? vault.industry),
    loan_use: suggestFfLoanUse(deal?.loan_purpose ?? vault.loan_purpose),
    monthly_revenue: bucketMonthlyRevenue(
      analysis?.avg_revenue ?? analysis?.avg_monthly_deposits ?? business?.avg_monthly_deposits ?? vault.avg_monthly_deposits
    ),
  };
}

export function redactFfLead(payload: FfLeadRequest): FfLeadRequest {
  const clone: FfLeadRequest = JSON.parse(JSON.stringify(payload));
  for (const c of clone.lead.contacts_attributes) {
    const d = digitsOnly(c.ssn);
    c.ssn = d ? `***-**-${d.slice(-4)}` : "";
  }
  return clone;
}

export function buildFfLead(
  source: LenderApiSource,
  picks: Picks,
  ctx: { referenceId: string }
): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d } = source;

  const effectivePicks: Record<string, string | null> = { ...suggestFfPicks(source) };
  for (const def of FF_PICKS) {
    const chosen = nonEmpty(picks[def.key]);
    if (chosen) effectivePicks[def.key] = chosen;
  }
  for (const def of FF_PICKS) {
    const value = effectivePicks[def.key];
    if (!value) {
      if (def.required) gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "missing" });
    } else if (!def.options.includes(value)) {
      gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "invalid" });
    }
  }

  const name = splitName(r.owner_1_name);
  if (!name.first || !name.last) {
    gaps.push({ field: "owner_1_name", label: "Owner first and last name", kind: "missing" });
  }
  const ssn = r.ssn ?? "";
  if (ssn.length !== 9) {
    gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: ssn ? "invalid" : "missing" });
  }
  for (const field of ["owner_1_street", "owner_1_state", "owner_1_zip"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }

  // The vault's DBA, legal name and EIN belong to the primary business. Another
  // business is identified only by its own business_profiles row.
  const isPrimaryBusiness = !b || b.is_primary;
  const businessName = isPrimaryBusiness
    ? nonEmpty(v.dba) ?? nonEmpty(b?.company_name) ?? nonEmpty(b?.business_name) ?? nonEmpty(v.company_name)
    : nonEmpty(b?.company_name) ?? nonEmpty(b?.business_name);
  const legalName = isPrimaryBusiness
    ? nonEmpty(v.company_name) ?? nonEmpty(b?.company_name)
    : nonEmpty(b?.company_name);
  if (!businessName) {
    gaps.push({ field: "business_name", label: "Business name (edit the client profile)", kind: "missing" });
  }
  const startedOn = toIsoDate(b?.business_start_date) ?? toIsoDate(v.business_start_date);
  if (!startedOn) {
    gaps.push({ field: "business_start_date", label: "Business start date (edit the client profile)", kind: "missing" });
  }
  const businessPhone = [digitsOnly(b?.phone), digitsOnly(r.client_phone)].find((p) => p.length >= 10) ?? null;
  if (!businessPhone) {
    gaps.push({ field: "client_phone", label: "Business phone (10 digits)", kind: "missing" });
  }

  const cell = digitsOnly(r.client_phone);
  const home = digitsOnly(v.owner_1_home_phone);

  const businessAddress =
    r.business_street && r.company_state && r.company_zip_code
      ? (compact({ street1: r.business_street, city: r.company_city, state: r.company_state, zip: r.company_zip_code }) as FfAddress)
      : undefined;

  const largest = [...source.openPositions].sort(
    (x, y) => (y.current_balance ?? 0) - (x.current_balance ?? 0)
  )[0];
  const loan_attributes = largest
    ? compact({
        company_name: largest.lender_name,
        balance: largest.current_balance ?? undefined,
        daily_payment_amount:
          largest.payment_frequency === "Daily" ? toInt(largest.payment_amount) ?? undefined : undefined,
      })
    : undefined;

  const capital = d?.capital_requested ?? v.capital_requested;
  const notes = [nonEmpty(d?.loan_purpose ?? v.loan_purpose), nonEmpty(d?.file_synopsis)]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2000);

  const payload: FfLeadRequest = {
    lead: compact({
      contacts_attributes: [
        compact({
          first_name: name.first ?? "",
          last_name: name.last ?? "",
          email: nonEmpty(v.client_email) ?? undefined,
          born_on: r.owner_1_dob ?? undefined,
          cell_phone: cell.length >= 10 ? cell : undefined,
          home_phone: home.length >= 10 ? home : undefined,
          ssn,
          current_address_attributes: compact({
            street1: r.owner_1_street ?? "",
            city: r.owner_1_city ?? undefined,
            state: r.owner_1_state ?? "",
            zip: r.owner_1_zip ?? "",
          }) as FfAddress,
        }),
      ],
      account_attributes: compact({
        entity_type: effectivePicks.entity_type ?? "",
        name: businessName ?? "",
        started_on: startedOn ?? "",
        legal_name: legalName ?? undefined,
        phone: businessPhone ?? "",
        email: nonEmpty(v.client_email) ?? undefined,
        // r.ein is already null for a non-primary business (scopeResolvedToBusiness); guarded twice on purpose.
        fein: isPrimaryBusiness && r.ein && r.ein.length === 9 ? r.ein : undefined,
        monthly_revenue: effectivePicks.monthly_revenue ?? undefined,
        industry_name: effectivePicks.industry_name ?? "",
        current_address_attributes: businessAddress,
      }),
      loan_attributes,
      application_attributes: compact({
        has_current_loan: source.openPositions.length > 0,
        applicant_is_owner: true,
        loan_use: effectivePicks.loan_use ?? undefined,
        capital_needed:
          capital !== null && capital !== undefined && capital > 0 ? String(Math.round(capital)) : undefined,
        owner_1_percent_ownership: toInt(v.owner_1_ownership_pct) ?? undefined,
        owner_2_percent_ownership: toInt(v.owner_2_ownership_pct) ?? undefined,
        reference_id: ctx.referenceId,
        notes: notes || undefined,
      }),
    }) as FfLeadRequest["lead"],
  };

  return { payload, redacted: redactFfLead(payload), gaps, effectivePicks };
}

const TAGS: Record<string, string[]> = {
  business_bank_statements: ["bank_statement"],
  drivers_license: ["drivers_license"],
  drivers_license_front: ["drivers_license"],
  drivers_license_back: ["drivers_license"],
  voided_check: ["voided_check"],
  tax_returns: ["tax_return"],
  personal_tax_returns: ["tax_return"],
  balance_sheets: ["balance_sheet_income_statement"],
  profit_loss: ["balance_sheet_income_statement"],
  ar_report: ["accounts_receivable_report_invoices"],
  articles_of_incorporation: ["proof_of_ownership"],
  operating_agreement_bylaws: ["proof_of_ownership"],
};

export function ffTagsForDocCode(code: string | null): string[] {
  return code ? [...(TAGS[code] ?? [])] : [];
}

function money(n: unknown): string {
  const num = Number(n);
  return n === null || n === undefined || !Number.isFinite(num) ? "?" : `$${num.toLocaleString("en-US")}`;
}

export function interpretFfStatus(raw: unknown): NormalizedStatus {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const stage = typeof s.stage === "string" && s.stage ? s.stage : "Unknown";

  if (stage === "Approval Sent") {
    interface OfferVariant {
      position?: number;
      variant_type?: string;
      max_approval_amount?: number;
      max_term?: number;
      max_term_buy_rate?: number;
      net_funded_amount?: number;
      required_stipulations?: Array<{ type: string }>;
    }
    const variants: OfferVariant[] = Array.isArray(s.offer_variants) ? [...(s.offer_variants as OfferVariant[])] : [];
    variants.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const lines = variants.length
      ? variants.map(
          (o, i) =>
            `Offer ${o.position ?? i + 1} (${o.variant_type ?? "base"}): max ${money(o.max_approval_amount)} · ` +
            `${o.max_term ?? "?"} payments · buy rate ${o.max_term_buy_rate ?? "?"} · net funded ${money(o.net_funded_amount)}`
        )
      : [`Max approval ${money(s.max_approval)} · ${s.max_payments ?? "?"} payments`];
    const stips = Array.from(
      new Set(
        [
          ...(Array.isArray(s.required_stipulations) ? (s.required_stipulations as Array<{ type: string }>) : []),
          ...variants.flatMap((o) => o.required_stipulations ?? []),
        ]
          .map((x) => x?.type)
          .filter(Boolean)
      )
    );
    if (stips.length) lines.push(`Stips: ${stips.join(", ")}`);
    if (typeof s.offer_link === "string") lines.push(`Offer: ${s.offer_link}`);
    if (typeof s.notes === "string") lines.push(`Notes: ${s.notes}`);
    return { kind: "approved", stage, note: lines.join("\n") };
  }

  if (stage === "Declined") {
    const note = [
      typeof s.decline_drivers === "string" ? `Decline drivers: ${s.decline_drivers}` : null,
      typeof s.decline_notes === "string" ? `Notes: ${s.decline_notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    return { kind: "declined", stage, note: note || "Declined by Forward Financing (no reason given)" };
  }

  if (stage === "File Missing Info" || stage === "Waiting on ISO") {
    return { kind: "needs_info", stage, note: nonEmpty(s.missing_info as string) ?? `${stage} — check with Forward Financing` };
  }

  return { kind: "in_progress", stage };
}

export function mapFfAttachmentResults(
  docs: OutboundDocument[],
  res: { status: number; data: unknown; error: string | null }
): OutboundDocumentResult[] {
  const base = (d: OutboundDocument) => ({ documentId: d.documentId, filename: d.filename, stamped: d.stamped });

  if (res.status === 202) return docs.map((d) => ({ ...base(d), accepted: true }));

  if (res.status === 207) {
    interface AttachmentResponse {
      results?: Array<{ status?: string; error?: string; message?: string }>;
    }
    const results: Array<{ status?: string; error?: string; message?: string }> = Array.isArray(
      (res.data as AttachmentResponse)?.results
    )
      ? ((res.data as AttachmentResponse).results as Array<{ status?: string; error?: string; message?: string }>)
      : [];
    return docs.map((d, i) => {
      const item = results[i];
      return item?.status === "accepted"
        ? { ...base(d), accepted: true }
        : { ...base(d), accepted: false, error: String(item?.error ?? item?.message ?? item?.status ?? "not accepted") };
    });
  }

  return docs.map((d) => ({ ...base(d), accepted: false, error: res.error ?? `HTTP ${res.status}` }));
}
