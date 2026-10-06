// src/lib/lender-api/providers/onewest/mapping.ts
//
// Pure: our deal → 1West's POST /packages JSON, plus their dropdowns, the
// per-file document type (bank statements ranked newest-first into slots
// 1/2/3), webhook reading and status reading. No I/O, no env.

import type { BuiltApplication, Gap, LenderApiSource, NormalizedStatus, PickDefinition, Picks } from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { digitsOnly, nonEmpty, splitName, toInt, toIsoDate, toStateCode, toZip5 } from "../../normalize";
import { resolveNaics } from "@/data/naics";
import {
  ONEWEST_APPROVED_STATUSES,
  ONEWEST_BANK_STATEMENT_SLOTS,
  ONEWEST_CLOSED_STATUSES,
  ONEWEST_CREDIT_SCORES,
  ONEWEST_DECLINED_STATUSES,
  ONEWEST_DOCUMENT_TYPES,
  ONEWEST_ENTITY_TYPES,
  ONEWEST_FILE_EXTENSIONS,
  ONEWEST_US_CITIZEN,
} from "./constants";

export interface OneWestContact {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip_code: string;
  /** The base Contact schema calls it postal_code; the package example uses zip_code. Both are sent. */
  postal_code: string;
  ssn: string;
  ownership_percent: number;
  birth_date?: string;
  credit_score?: string;
  us_citizen?: string;
}

export interface OneWestPackage {
  company: string;
  dba: string;
  phone: string;
  fein: string;
  legal_entity_type: string;
  annual_revenue: number;
  business_start_date: string;
  street: string;
  city: string;
  state: string;
  zip_code: string;
  contacts: OneWestContact[];
  industry?: string;
  naics?: string;
  employees?: number;
  desired_funding?: number;
  purpose?: string;
  partner_tracking_id?: string;
}

export interface OneWestDocument {
  type: string;
  filename: string;
  file: string;
}

export const ONEWEST_PICKS: readonly PickDefinition[] = [
  { key: "legal_entity_type", label: "Entity type", options: ONEWEST_ENTITY_TYPES, required: true },
  { key: "credit_score", label: "Owner credit score", options: ONEWEST_CREDIT_SCORES, required: false },
  { key: "us_citizen", label: "Owner is a US citizen?", options: ONEWEST_US_CITIZEN, required: false },
];

export const ONEWEST_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
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

/** NNN-NNN-NNNN, the only phone shape their schema accepts. */
export function toOneWestPhone(v: unknown): string | null {
  let d = digitsOnly(v);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : null;
}

/** YYYY-MM-DD → mm/dd/yyyy. */
export function toUsDate(iso: string | null): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : null;
}

export function mapOneWestEntityType(v: string | null | undefined): string | null {
  const s = (v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s === "llc" || s === "limitedliabilitycompany") return "Limited Liability Company (LLC)";
  if (["scorp", "ccorp", "corp", "corporation", "inc", "incorporated"].includes(s)) return "Corporation";
  if (["soleprop", "soleproprietor", "soleproprietorship"].includes(s)) return "Sole Proprietor";
  if (s === "lp" || s === "limitedpartnership") return "Limited Partnership (LP)";
  if (s === "llp" || s === "limitedliabilitypartnership") return "Limited Liability Partnership (LLP)";
  if (["partnership", "generalpartnership", "gp"].includes(s)) return "General Partnership";
  return null;
}

export function oneWestCreditBand(fico: number | null): string | null {
  if (fico === null || !Number.isFinite(fico) || fico < 300 || fico > 850) return null;
  if (fico >= 720) return "Excellent (720+)";
  if (fico >= 680) return "Great (680 - 719)";
  if (fico >= 650) return "Average (650 - 679)";
  if (fico >= 600) return "Fair (600 - 649)";
  return "Not so Great (599 or less)";
}

function ficoOf(source: LenderApiSource): number | null {
  const v = source.vault;
  return source.analysis?.fico ?? toInt(/^\s*\d{3}\s*$/.test(v.credit_score ?? "") ? v.credit_score : null);
}

export function suggestOneWestPicks(source: LenderApiSource): Record<string, string | null> {
  const { vault, business } = source;
  return {
    legal_entity_type: mapOneWestEntityType(business?.legal_entity_type ?? vault.legal_entity_type),
    credit_score: oneWestCreditBand(ficoOf(source)),
    // Nothing on file answers this one.
    us_citizen: null,
  };
}

function toSsn(d: string): string {
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

export function redactOneWestPackage(pkg: OneWestPackage): OneWestPackage {
  return {
    ...pkg,
    contacts: pkg.contacts.map((c) => {
      const d = digitsOnly(c.ssn);
      return { ...c, ssn: d ? `***-**-${d.slice(-4)}` : "" };
    }),
  };
}

/**
 * Annual revenue, best source first. The vault's own deposits describe the
 * primary business only, so a second business never borrows them.
 */
function annualRevenueOf(source: LenderApiSource, isPrimaryBusiness: boolean): number | null {
  const { business: b, analysis, vault: v } = source;
  const annual = toInt(b?.avg_annual_revenue);
  if (annual && annual > 0) return annual;
  for (const monthly of [
    analysis?.avg_revenue,
    analysis?.avg_monthly_deposits,
    b?.avg_monthly_deposits,
    isPrimaryBusiness ? v.avg_monthly_deposits : null,
  ]) {
    const m = toInt(monthly);
    if (m && m > 0) return m * 12;
  }
  return null;
}

export function buildOneWestApplication(
  source: LenderApiSource,
  picks: Picks,
  ctx: { referenceId: string }
): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d } = source;

  const effectivePicks: Record<string, string | null> = { ...suggestOneWestPicks(source) };
  for (const def of ONEWEST_PICKS) {
    const chosen = nonEmpty(picks[def.key]);
    if (chosen) effectivePicks[def.key] = chosen;
  }
  for (const def of ONEWEST_PICKS) {
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
  const email = nonEmpty(v.client_email);
  if (!email) gaps.push({ field: "client_email", label: "Client email (edit the client profile)", kind: "missing" });
  const phone = toOneWestPhone(r.client_phone);
  if (!phone) gaps.push({ field: "client_phone", label: "Phone (10-digit US number)", kind: r.client_phone ? "invalid" : "missing" });
  const ssn = digitsOnly(r.ssn);
  if (ssn.length !== 9) gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: r.ssn ? "invalid" : "missing" });
  const dob = toUsDate(toIsoDate(r.owner_1_dob));
  if (!dob) gaps.push({ field: "owner_1_dob", label: VAULT_FIELD_LABELS.owner_1_dob, kind: "missing" });
  for (const field of ["owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  // Never invent a share: a missing/0% owner 1 is a gap, not 100%.
  const pct1 = toInt(v.owner_1_ownership_pct);
  if (pct1 === null || pct1 === 0) {
    gaps.push({ field: "owner:1", label: "Owner 1 ownership %", kind: "missing" });
  } else if (!(pct1 > 0 && pct1 <= 100)) {
    gaps.push({ field: "owner:1", label: `Owner 1 ownership % (${pct1}%)`, kind: "invalid" });
  }

  const contacts: OneWestContact[] = [
    {
      first_name: name.first ?? "",
      last_name: name.last ?? "",
      phone: phone ?? "",
      email: email ?? "",
      street: r.owner_1_street ?? "",
      city: r.owner_1_city ?? "",
      state: toStateCode(r.owner_1_state) ?? "",
      zip_code: toZip5(r.owner_1_zip) ?? "",
      postal_code: toZip5(r.owner_1_zip) ?? "",
      ssn: ssn.length === 9 ? toSsn(ssn) : "",
      ownership_percent: pct1 ?? 0,
      ...(dob ? { birth_date: dob } : {}),
      ...(effectivePicks.credit_score ? { credit_score: effectivePicks.credit_score } : {}),
      ...(effectivePicks.us_citizen ? { us_citizen: effectivePicks.us_citizen } : {}),
    },
  ];

  // ── Owners 2–5 ───────────────────────────────────────────────────────────
  // Every co-owner with a share is sent complete or flagged — never dropped.
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
      if (!(o.ownership_pct > 0)) {
        if (nonEmpty(o.full_name)) {
          gaps.push({
            field: `owner:${o.position}`,
            label: `Owner ${o.position} (${o.full_name}, 0%): confirm the ownership %`,
            kind: "invalid",
          });
        }
        continue;
      }
      const on = splitName(o.full_name);
      const oSsn = digitsOnly(o.ssn);
      const oPhone = toOneWestPhone(o.phone);
      const oEmail = nonEmpty(o.email);
      const oState = toStateCode(o.state);
      const oZip = toZip5(o.zip);
      const missing: string[] = [];
      if (!on.first || !on.last) missing.push("full name");
      if (oSsn.length !== 9) missing.push("SSN");
      if (!nonEmpty(o.street) || !nonEmpty(o.city) || !oState || !oZip) missing.push("home address");
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
      const oDob = toUsDate(toIsoDate(o.dob));
      contacts.push({
        first_name: on.first as string,
        last_name: on.last as string,
        phone: oPhone as string,
        email: oEmail as string,
        street: o.street as string,
        city: o.city as string,
        state: oState as string,
        zip_code: oZip as string,
        postal_code: oZip as string,
        ssn: toSsn(oSsn),
        ownership_percent: o.ownership_pct,
        ...(oDob ? { birth_date: oDob } : {}),
      });
    }
  }
  const shareTotal = contacts.reduce((sum, c) => sum + c.ownership_percent, 0);
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
  // DBA is required: a business trading under its legal name sends that name.
  const dba = (isPrimaryBusiness ? nonEmpty(v.dba) ?? nonEmpty(b?.business_name) : nonEmpty(b?.business_name)) ?? legalName;
  const ein = isPrimaryBusiness ? digitsOnly(r.ein) : "";
  if (ein.length !== 9) {
    gaps.push({
      field: "ein",
      label: isPrimaryBusiness ? "EIN (9 digits)" : "EIN for this business (edit the client profile)",
      kind: r.ein ? "invalid" : "missing",
    });
  }
  const bizPhone = toOneWestPhone(b?.phone) ?? phone;
  for (const field of ["business_street", "company_city", "company_state", "company_zip_code"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const started = toUsDate(toIsoDate(b?.business_start_date) ?? toIsoDate(v.business_start_date));
  if (!started) gaps.push({ field: "business_start_date", label: "Business start date (edit the client profile)", kind: "missing" });

  const annualRevenue = annualRevenueOf(source, isPrimaryBusiness);
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
  }

  const rawIndustry = nonEmpty(b?.industry) ?? (isPrimaryBusiness ? nonEmpty(v.industry) : null);
  const naics = resolveNaics(rawIndustry);
  const employees = toInt(b?.employees_count);

  const pkg: OneWestPackage = {
    company: legalName ?? "",
    dba: dba ?? "",
    phone: bizPhone ?? "",
    fein: ein.length === 9 ? `${ein.slice(0, 2)}-${ein.slice(2)}` : "",
    legal_entity_type: effectivePicks.legal_entity_type ?? "",
    annual_revenue: annualRevenue ?? 0,
    business_start_date: started ?? "",
    street: r.business_street ?? "",
    city: r.company_city ?? "",
    state: toStateCode(r.company_state) ?? "",
    zip_code: toZip5(r.company_zip_code) ?? "",
    contacts,
    partner_tracking_id: ctx.referenceId,
  };
  if (naics) {
    pkg.naics = naics.code;
    pkg.industry = naics.title;
  } else if (rawIndustry) {
    pkg.industry = rawIndustry;
  }
  // "minimum: 1" — 0 is the fast form's placeholder, so leave it out.
  if (employees && employees > 0) pkg.employees = employees;
  if (requested && requested > 0) pkg.desired_funding = requested;
  const purpose = nonEmpty(d?.loan_purpose ?? v.loan_purpose);
  if (purpose) pkg.purpose = purpose;

  return { payload: pkg, redacted: redactOneWestPackage(pkg), gaps, effectivePicks };
}

// ── Documents ──────────────────────────────────────────────────────────────

export function oneWestDocumentType(docCode: string | null): string | null {
  if (!docCode) return null;
  return ONEWEST_DOCUMENT_TYPES.find((t) => t.docCodes.includes(docCode))?.type ?? null;
}

export function oneWestTagsForDocCode(docCode: string | null): string[] {
  const type = oneWestDocumentType(docCode);
  return type ? [type] : [];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The statement month a filename names, as year*12 + month index, or null.
 * Reads 2026-08 / 2026_08 / 08-2026 / 08.2026 and month names ("Aug 2026",
 * "august_26"). A month name with no year is the latest such month up to now.
 */
export function statementMonthFromFilename(filename: string, now: Date): number | null {
  const s = filename.toLowerCase();
  let m = s.match(/(?:^|\D)(20\d{2})[-_. /](0?[1-9]|1[0-2])(?:\D|$)/);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  m = s.match(/(?:^|\D)(0?[1-9]|1[0-2])[-_. /](20\d{2})(?:\D|$)/);
  if (m) return Number(m[2]) * 12 + Number(m[1]) - 1;
  const named = s.match(/(?:^|[^a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[^a-z0-9]*((?:20)?\d{2})?(?:\D|$)/);
  if (named) {
    const month = MONTHS.indexOf(named[1]);
    if (named[2]) {
      const y = named[2].length === 2 ? 2000 + Number(named[2]) : Number(named[2]);
      return y * 12 + month;
    }
    const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
    const thisYear = now.getUTCFullYear() * 12 + month;
    return thisYear <= nowIdx ? thisYear : thisYear - 12;
  }
  return null;
}

/**
 * 1West's type for each file, in input order. Bank statements are ranked by
 * the month their filename names, newest first: month 1 → "Bank Statement 1",
 * month 2 → "2", every older month → "3" (several accounts share a month's
 * slot). A statement with no readable month takes the first slot still empty,
 * then "3". Anything 1West has no slot for is null.
 */
export function oneWestDocumentTypes(docs: Array<{ docCode: string | null; filename: string }>, now: Date): Array<string | null> {
  const types = docs.map((d) => oneWestDocumentType(d.docCode));
  const statementIdx = types.flatMap((t, i) => (t === "Bank Statement" ? [i] : []));
  const months = new Map<number, number | null>(statementIdx.map((i) => [i, statementMonthFromFilename(docs[i].filename, now)]));
  const distinct = [...new Set([...months.values()].filter((m): m is number => m !== null))].sort((a, b) => b - a);

  const used = new Set<number>();
  for (const i of statementIdx) {
    const month = months.get(i);
    if (month === null || month === undefined) continue;
    const slot = Math.min(distinct.indexOf(month), 2);
    used.add(slot);
    types[i] = ONEWEST_BANK_STATEMENT_SLOTS[slot];
  }
  for (const i of statementIdx) {
    if (months.get(i) !== null && months.get(i) !== undefined) continue;
    const slot = [0, 1, 2].find((s) => !used.has(s)) ?? 2;
    used.add(slot);
    types[i] = ONEWEST_BANK_STATEMENT_SLOTS[slot];
  }
  return types;
}

/**
 * Their filename rule is `^[\w,\s-]+\.(pdf|jpg|jpeg|png)$` (any case), so
 * every other character becomes "-". null when the extension isn't accepted.
 */
export function oneWestFilename(filename: string): string | null {
  const m = filename.match(/^(.*)\.([A-Za-z0-9]+)$/);
  if (!m) return null;
  const ext = m[2].toLowerCase();
  if (!(ONEWEST_FILE_EXTENSIONS as readonly string[]).includes(ext)) return null;
  const base = m[1].replace(/[^\w,\s-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[\s-]+|[\s-]+$/g, "") || "document";
  return `${base}.${ext}`;
}

// ── Webhook + status ───────────────────────────────────────────────────────

export interface OneWestStatus {
  uuid?: string;
  status?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  funding_details?: {
    amount?: number;
    number_of_payments?: number;
    payment_frequency?: string;
    factor?: number;
  } | null;
}

export function oneWestDealId(body: unknown): string | null {
  return nonEmpty((body as OneWestStatus | null)?.uuid);
}

/** The whole callback is the status: uuid + status + funding_details. */
export function oneWestStatusFromWebhook(body: unknown): OneWestStatus | null {
  const b = body as OneWestStatus | null;
  return b && typeof b === "object" && nonEmpty(b.status) ? b : null;
}

function fundingSummary(f: OneWestStatus["funding_details"]): string | null {
  if (!f || typeof f !== "object") return null;
  const parts: string[] = [];
  if (typeof f.amount === "number") parts.push(`$${f.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  if (typeof f.factor === "number") parts.push(`factor ${f.factor}`);
  if (typeof f.number_of_payments === "number") {
    parts.push(`${f.number_of_payments} ${(f.payment_frequency ?? "").toLowerCase()} payments`.replace(/\s+/g, " "));
  } else if (f.payment_frequency) {
    parts.push(`${f.payment_frequency.toLowerCase()} payments`);
  }
  return parts.length ? parts.join(", ") : null;
}

export function interpretOneWestStatus(raw: unknown): NormalizedStatus {
  const s = (raw && typeof raw === "object" ? raw : {}) as OneWestStatus;
  const stage = nonEmpty(s.status) ?? "Submitted";
  const lines = [`1West: ${stage}`];
  const funding = fundingSummary(s.funding_details);
  if (funding) lines.push(`Offer: ${funding}`);

  if (ONEWEST_DECLINED_STATUSES.includes(stage)) return { kind: "declined", stage, note: lines.join("\n") };
  if (ONEWEST_APPROVED_STATUSES.includes(stage)) return { kind: "approved", stage, note: lines.join("\n") };
  if (ONEWEST_CLOSED_STATUSES.includes(stage)) {
    lines.push(
      stage.endsWith("Timed Out")
        ? "1West closed the deal after it sat too long at this stage."
        : "The customer stopped the application or turned down the offer."
    );
    return { kind: "needs_info", stage, note: lines.join("\n") };
  }
  return { kind: "in_progress", stage };
}
