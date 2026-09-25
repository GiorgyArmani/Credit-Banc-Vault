// src/lib/lender-api/providers/loot/mapping.ts
//
// Pure: our deal → Loot's multipart "submit customer application" form, plus
// their dropdowns, webhook reading and status reading. No I/O, no env — fully
// unit tested.
//
// Loot's form uses bracketed keys (`owners[0][address][zip]`), so the payload
// is built directly as that flat key → string map; client.ts only turns it
// into FormData.

import type { BuiltApplication, Gap, LenderApiSource, NormalizedStatus, PickDefinition, Picks } from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { digitsOnly, nonEmpty, splitName, toInt, toIsoDate } from "../../normalize";
import {
  LOOT_APPROVED_STAGES,
  LOOT_CUSTOMER_DECLINED_STAGES,
  LOOT_DEAL_DECISION,
  LOOT_DECLINED_STAGES,
  LOOT_ENTITY_TYPES,
  LOOT_INDUSTRIES,
  LOOT_MIN_ANNUAL_REVENUE,
  LOOT_MIN_REQUEST,
} from "./constants";

/** Flat multipart fields, keyed exactly as Loot names them. */
export type LootApplicationForm = Record<string, string>;

export const LOOT_PICKS: readonly PickDefinition[] = [
  { key: "entityType", label: "Entity type", options: LOOT_ENTITY_TYPES, required: true },
  { key: "industry", label: "Industry", options: LOOT_INDUSTRIES, required: false },
];

export const LOOT_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
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

/** Loot validates US phones as NNN-NNN-NNNN. */
export function toLootPhone(v: unknown): string | null {
  let d = digitsOnly(v);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null;
}

export function mapLootEntityType(v: string | null | undefined): string | null {
  const s = (v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s === "llc" || s === "limitedliabilitycompany") return "LLC";
  if (["scorp", "ccorp", "corp", "corporation", "inc", "incorporated"].includes(s)) return "CORPORATION";
  if (["soleprop", "soleproprietor", "soleproprietorship"].includes(s)) return "SOLE PROPRIETORSHIP";
  if (["partnership", "generalpartnership", "gp", "lp", "llp", "limitedpartnership", "limitedliabilitypartnership"].includes(s)) {
    return "PARTNERSHIP";
  }
  if (s === "nonprofit" || s === "notforprofit") return "NON-PROFIT";
  return null;
}

// First match wins, so specific rules precede broad ones.
const INDUSTRY_RULES: Array<[RegExp, (typeof LOOT_INDUSTRIES)[number]]> = [
  [/truck|freight|transport|logistic|towing|courier/i, "transportation-trucking"],
  [/restaurant|\bbar\b|catering|cafe|food service|brewery/i, "restaurants-bars"],
  [/hotel|motel|lodging|hospitality/i, "hotels"],
  [/e-?commerce|online|amazon|shopify/i, "online-store"],
  [/retail|store|shop|boutique/i, "retail-store"],
  [/wholesale|distribut/i, "wholesale"],
  [/manufactur|fabricat/i, "manufacturing"],
  [/construct|contractor|roofing|plumb|electric|hvac|landscap|remodel/i, "construction"],
  [/farm|agricult|ranch/i, "agriculture"],
  [/real estate|property|realty/i, "real-estate"],
  [/insurance|financ|accounting|bookkeep|tax/i, "finance-insurance"],
  [/medical|dental|health|clinic|pharma|chiropract|therap/i, "healthcare"],
  [/entertain|\bart\b|music|film|event|studio/i, "arts-entertainment"],
  [/consult|legal|law|marketing|agency|professional|software|\bit\b/i, "professional-services"],
];

export function suggestLootIndustry(industry: string | null | undefined): string | null {
  const s = nonEmpty(industry);
  if (!s) return null;
  for (const [re, value] of INDUSTRY_RULES) if (re.test(s)) return value;
  return "other";
}

export function suggestLootPicks(source: LenderApiSource): Record<string, string | null> {
  const { vault, business } = source;
  return {
    entityType: mapLootEntityType(business?.legal_entity_type ?? vault.legal_entity_type),
    industry: suggestLootIndustry(business?.industry ?? vault.industry),
  };
}

const SSN_KEY = /^owners\[\d+\]\[ssn\]$/;

export function redactLootApplication(form: LootApplicationForm): LootApplicationForm {
  const out: LootApplicationForm = { ...form };
  for (const key of Object.keys(out)) {
    if (SSN_KEY.test(key)) out[key] = out[key] ? `*****${out[key].slice(-4)}` : "";
  }
  return out;
}

export function buildLootApplication(
  source: LenderApiSource,
  picks: Picks,
  _ctx: { referenceId: string }
): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d, analysis, openPositions } = source;

  const effectivePicks: Record<string, string | null> = { ...suggestLootPicks(source) };
  for (const def of LOOT_PICKS) {
    const chosen = nonEmpty(picks[def.key]);
    if (chosen) effectivePicks[def.key] = chosen;
  }
  for (const def of LOOT_PICKS) {
    const value = effectivePicks[def.key];
    if (!value) {
      if (def.required) gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "missing" });
    } else if (!def.options.includes(value)) {
      gaps.push({ field: `pick:${def.key}`, label: def.label, kind: "invalid" });
    }
  }

  // ── Owner (also the applicant: Loot opens the customer account on this email) ──
  const name = splitName(r.owner_1_name);
  if (!name.first || !name.last) {
    gaps.push({ field: "owner_1_name", label: "Owner first and last name", kind: "missing" });
  }
  const email = nonEmpty(v.client_email);
  if (!email) gaps.push({ field: "client_email", label: "Client email (edit the client profile)", kind: "missing" });
  const phone = toLootPhone(r.client_phone);
  if (!phone) {
    gaps.push({ field: "client_phone", label: "Phone (10-digit US number)", kind: r.client_phone ? "invalid" : "missing" });
  }
  const ssn = digitsOnly(r.ssn);
  if (ssn.length !== 9) gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: r.ssn ? "invalid" : "missing" });
  const dob = toIsoDate(r.owner_1_dob);
  if (!dob) gaps.push({ field: "owner_1_dob", label: VAULT_FIELD_LABELS.owner_1_dob, kind: "missing" });
  for (const field of ["owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  // Required, max 100. 100 is the honest default for the single-owner files this maps.
  const ownership = toInt(v.owner_1_ownership_pct);
  const ownershipPct = ownership && ownership > 0 && ownership <= 100 ? ownership : 100;

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
  const incorporated = toIsoDate(b?.business_start_date) ?? toIsoDate(v.business_start_date);
  if (!incorporated) {
    gaps.push({ field: "business_start_date", label: "Business start date (edit the client profile)", kind: "missing" });
  }
  const industryText = nonEmpty(b?.industry ?? v.industry);
  // businessDescription is required free text; the industry on file is the
  // honest description we hold.
  if (!industryText) {
    gaps.push({ field: "industry", label: "Industry / business description (edit the client profile)", kind: "missing" });
  }

  // ── Financials ───────────────────────────────────────────────────────────
  const requested = toInt(d?.capital_requested ?? v.capital_requested);
  if (!requested || requested <= LOOT_MIN_REQUEST) {
    gaps.push({
      field: "capital_requested",
      label: `Requested amount over $${LOOT_MIN_REQUEST.toLocaleString("en-US")} (edit the funding deal)`,
      kind: requested ? "invalid" : "missing",
    });
  }
  const monthly = toInt(
    analysis?.avg_revenue ?? analysis?.avg_monthly_deposits ?? b?.avg_monthly_deposits ?? v.avg_monthly_deposits
  );
  const annual = monthly && monthly > 0 ? monthly * 12 : null;
  if (!annual || annual <= LOOT_MIN_ANNUAL_REVENUE) {
    gaps.push({
      field: "average_revenue",
      label: `Annual revenue over $${LOOT_MIN_ANNUAL_REVENUE.toLocaleString("en-US")} (run the bank analysis or set deposits on the client profile)`,
      kind: annual ? "invalid" : "missing",
    });
  }

  const industry = effectivePicks.industry;
  const form: LootApplicationForm = {
    email: email ?? "",
    firstName: name.first ?? "",
    lastName: name.last ?? "",
    phone: phone ?? "",
    requestingAmount: String(requested ?? 0),
    estimatedAnnualRevenue: String(annual ?? 0),
    businessDescription: industryText ?? "",
    businessName: legalName ?? "",
    entityType: effectivePicks.entityType ?? "",
    ein,
    // "optional string (put N/A if not available)" — the vault carries no website.
    website: "N/A",
    "address[addressLine1]": r.business_street ?? "",
    "address[city]": r.company_city ?? "",
    "address[state]": r.company_state ?? "",
    "address[zip]": r.company_zip_code ?? "",
    incorporationDate: incorporated ?? "",
    "owners[0][first_name]": name.first ?? "",
    "owners[0][last_name]": name.last ?? "",
    "owners[0][email]": email ?? "",
    "owners[0][phone]": phone ?? "",
    "owners[0][dob]": dob ?? "",
    "owners[0][ssn]": ssn.length === 9 ? ssn : "",
    "owners[0][address][addressLine1]": r.owner_1_street ?? "",
    "owners[0][address][city]": r.owner_1_city ?? "",
    "owners[0][address][state]": r.owner_1_state ?? "",
    "owners[0][address][zip]": r.owner_1_zip ?? "",
    "owners[0][ownership]": String(ownershipPct),
  };

  if (dba && dba !== legalName) form.dba = dba;
  if (industry) form.industry = industry;
  if (industry === "other" && industryText) form.industryOther = industryText;
  const purpose = nonEmpty(d?.loan_purpose ?? v.loan_purpose);
  if (purpose) form.purposeExplanation = purpose;
  const overview = nonEmpty(d?.file_synopsis);
  if (overview) form.customerOverview = overview;

  openPositions.forEach((p, i) => {
    const balance = toInt(p.current_balance);
    if (!nonEmpty(p.lender_name)) return;
    form[`debtBalanceDetails[${i}][lenderName]`] = p.lender_name;
    if (balance !== null && balance >= 0) form[`debtBalanceDetails[${i}][balance]`] = String(balance);
  });

  return { payload: form, redacted: redactLootApplication(form), gaps, effectivePicks };
}

/** Loot's tags are just the doc code — their upload endpoint has no type field. */
export function lootTagsForDocCode(_code: string | null): string[] {
  return [];
}

// ── Webhook + status ───────────────────────────────────────────────────────

interface LootWebhook {
  eventType?: string;
  nonce?: string;
  createdAt?: string;
  data?: { deal?: LootDeal };
}

export interface LootDeal {
  deal_id?: string | number;
  deal_stage?: string;
  offer_type?: string;
  description?: string;
  decline_reason?: string;
  factor_rate?: number;
  buy_rate?: number;
  commission?: number;
  processing_fee?: number;
  repayment_frequency?: string;
  repayment_term?: number;
  advance_amount?: number;
  credit_limit?: number;
  draw_fee_in_percentage?: number;
  accept_link?: string;
  term_options?: Array<{ plan?: string; factor_rate?: number; repayment_term?: number; repayment_frequency?: string }>;
}

export function lootDealId(body: unknown): string | null {
  const id = (body as LootWebhook | null)?.data?.deal?.deal_id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return nonEmpty(id);
}

/** The deal object of a DEAL_DECISION webhook — the only status Loot ever sends. */
export function lootStatusFromWebhook(body: unknown): LootDeal | null {
  const b = body as LootWebhook | null;
  if (!b || b.eventType !== LOOT_DEAL_DECISION) return null;
  const deal = b.data?.deal;
  return deal && typeof deal === "object" ? deal : null;
}

function money(n: unknown): string | null {
  return typeof n === "number" && Number.isFinite(n) ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : null;
}

function offerSummary(d: LootDeal): string | null {
  const parts: string[] = [];
  if (d.offer_type) parts.push(d.offer_type);
  const amount = money(d.advance_amount);
  const limit = money(d.credit_limit);
  if (amount) parts.push(`${amount} advance`);
  if (limit) parts.push(`${limit} credit limit`);
  if (typeof d.factor_rate === "number") parts.push(`factor ${d.factor_rate}`);
  if (typeof d.buy_rate === "number" && d.buy_rate !== d.factor_rate) parts.push(`buy rate ${d.buy_rate}`);
  if (d.repayment_term) parts.push(`${d.repayment_term} ${d.repayment_frequency ?? ""} payments`.replace(/\s+/g, " "));
  else if (d.repayment_frequency) parts.push(`${d.repayment_frequency} payments`);
  const fee = money(d.processing_fee);
  if (fee) parts.push(`processing fee ${fee}`);
  if (typeof d.draw_fee_in_percentage === "number") parts.push(`draw fee ${d.draw_fee_in_percentage}%`);
  if (typeof d.commission === "number" && d.commission > 0) parts.push(`commission ${d.commission}`);
  return parts.length > 1 || (parts.length === 1 && !d.offer_type) ? parts.join(", ") : null;
}

function termOptions(d: LootDeal): string | null {
  const opts = Array.isArray(d.term_options) ? d.term_options : [];
  if (!opts.length) return null;
  return `Term options: ${opts
    .map((o) => `${o.plan ?? "?"} ${o.repayment_term ?? "?"} ${o.repayment_frequency ?? ""} @ ${o.factor_rate ?? "?"}`.replace(/\s+/g, " "))
    .join("; ")}`;
}

export function interpretLootStatus(raw: unknown): NormalizedStatus {
  const d = (raw && typeof raw === "object" ? raw : {}) as LootDeal;
  const stage = nonEmpty(d.deal_stage) ?? "Submitted";

  if (LOOT_DECLINED_STAGES.includes(stage)) {
    return {
      kind: "declined",
      stage,
      note: nonEmpty(d.decline_reason) ? `Decline reason: ${d.decline_reason}` : "Declined by Loot (no reason given)",
    };
  }

  const lines = [`Loot: ${stage}`];
  const offer = offerSummary(d);
  if (offer) lines.push(`Offer: ${offer}`);
  const terms = termOptions(d);
  if (terms) lines.push(terms);
  if (nonEmpty(d.description)) lines.push(d.description!);

  if (LOOT_APPROVED_STAGES.includes(stage)) {
    if (nonEmpty(d.accept_link)) lines.push(`Offer link: ${d.accept_link}`);
    return { kind: "approved", stage, note: lines.join("\n") };
  }
  if (LOOT_CUSTOMER_DECLINED_STAGES.includes(stage)) {
    lines.push("The customer declined Loot's offer.");
    return { kind: "needs_info", stage, note: lines.join("\n") };
  }
  return { kind: "in_progress", stage };
}
