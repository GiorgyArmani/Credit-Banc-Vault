// src/lib/lender-api/providers/vital/mapping.ts
//
// Pure: our deal → Vital Cap's POST /deal-submission JSON, plus their document
// categories and status reading. No I/O, no env.

import type { BuiltApplication, Gap, LenderApiSource, NormalizedStatus, PickDefinition, Picks } from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { digitsOnly, nonEmpty, splitName, toInt, toIsoDate, toStateCode, toZip5 } from "../../normalize";
import { resolveNaics } from "@/data/naics";
import {
  VITAL_APPROVED_PATTERN,
  VITAL_DECLINED_PATTERN,
  VITAL_DOCUMENT_CATEGORIES,
  VITAL_NEEDS_INFO_PATTERN,
} from "./constants";

export interface VitalOwner {
  firstName: string;
  lastName: string;
  socialSecurityNumber?: string;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  emailAddress?: string;
  mobilePhone?: string;
  ownershipPercentage?: number;
}

export interface VitalBusiness {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  telephone: string;
  owners: VitalOwner[];
  refNumber: string;
  dba?: string;
  email?: string;
  fein?: string;
  amountRequested?: number;
  avgMonthlyRevenue?: number;
  numPositions?: number;
  getUseOfFunds?: string;
  entityType?: string;
  startDate?: string;
  industryTypeMoreInfo?: string;
  naicsCode?: string;
}

export interface VitalSubmission {
  business: VitalBusiness;
}

export interface VitalDocument {
  name: string;
  filename: string;
  category: string;
  content: string;
}

/** Their spec has no enum we must choose from, so there is nothing for UW to pick. */
export const VITAL_PICKS: readonly PickDefinition[] = [];

export const VITAL_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
  "owner_1_name",
  "client_phone",
  "business_street",
  "company_city",
  "company_state",
  "company_zip_code",
];

export function suggestVitalPicks(): Record<string, string | null> {
  return {};
}

/** Ten digits, no punctuation (their examples are bare digits). */
export function toVitalPhone(v: unknown): string | null {
  let d = digitsOnly(v);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

export function redactVitalSubmission(s: VitalSubmission): VitalSubmission {
  return {
    business: {
      ...s.business,
      owners: s.business.owners.map((o) =>
        o.socialSecurityNumber ? { ...o, socialSecurityNumber: `*****${o.socialSecurityNumber.slice(-4)}` } : o
      ),
    },
  };
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

function share(v: unknown): number | null {
  const pct = toInt(v);
  return pct !== null && pct > 0 && pct <= 100 ? pct : null;
}

export function buildVitalApplication(source: LenderApiSource, _picks: Picks, ctx: { referenceId: string }): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d } = source;

  // ── Owner 1 ──────────────────────────────────────────────────────────────
  // Only the name is required by Vital; everything else is sent when we have it.
  const name = splitName(r.owner_1_name);
  if (!name.first || !name.last) gaps.push({ field: "owner_1_name", label: "Owner first and last name", kind: "missing" });
  const phone = toVitalPhone(r.client_phone);
  const ssn = digitsOnly(r.ssn);
  if (r.ssn && ssn.length !== 9) gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: "invalid" });
  const dob = toIsoDate(r.owner_1_dob);
  const pct1 = share(v.owner_1_ownership_pct);

  const owners: VitalOwner[] = [
    {
      firstName: name.first ?? "",
      lastName: name.last ?? "",
      ...(ssn.length === 9 ? { socialSecurityNumber: ssn } : {}),
      ...(dob ? { dateOfBirth: dob } : {}),
      ...(r.owner_1_street ? { address: r.owner_1_street } : {}),
      ...(r.owner_1_city ? { city: r.owner_1_city } : {}),
      ...(toStateCode(r.owner_1_state) ? { state: toStateCode(r.owner_1_state) as string } : {}),
      ...(toZip5(r.owner_1_zip) ? { zip: toZip5(r.owner_1_zip) as string } : {}),
      ...(nonEmpty(v.client_email) ? { emailAddress: nonEmpty(v.client_email) as string } : {}),
      ...(phone ? { mobilePhone: phone } : {}),
      ...(pct1 ? { ownershipPercentage: pct1 } : {}),
    },
  ];

  // ── Owners 2–5 ───────────────────────────────────────────────────────────
  // Every co-owner with a share is sent or flagged — never dropped.
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
      const on = splitName(o.full_name);
      if (!on.first || !on.last) {
        gaps.push({
          field: `owner:${o.position}`,
          label: `Owner ${o.position} (${nonEmpty(o.full_name) ?? "unnamed"}, ${o.ownership_pct}%): missing full name`,
          kind: "missing",
        });
        continue;
      }
      const oSsn = digitsOnly(o.ssn);
      const oDob = toIsoDate(o.dob);
      const oState = toStateCode(o.state);
      const oZip = toZip5(o.zip);
      const oPhone = toVitalPhone(o.phone);
      owners.push({
        firstName: on.first,
        lastName: on.last,
        ...(oSsn.length === 9 ? { socialSecurityNumber: oSsn } : {}),
        ...(oDob ? { dateOfBirth: oDob } : {}),
        ...(nonEmpty(o.street) ? { address: nonEmpty(o.street) as string } : {}),
        ...(nonEmpty(o.city) ? { city: nonEmpty(o.city) as string } : {}),
        ...(oState ? { state: oState } : {}),
        ...(oZip ? { zip: oZip } : {}),
        ...(nonEmpty(o.email) ? { emailAddress: nonEmpty(o.email) as string } : {}),
        ...(oPhone ? { mobilePhone: oPhone } : {}),
        ...(share(o.ownership_pct) ? { ownershipPercentage: share(o.ownership_pct) as number } : {}),
      });
    }
  }
  const shareTotal = owners.reduce((sum, o) => sum + (o.ownershipPercentage ?? 0), 0);
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
  const ein = isPrimaryBusiness ? digitsOnly(r.ein) : "";
  if (isPrimaryBusiness && r.ein && ein.length !== 9) gaps.push({ field: "ein", label: "EIN (9 digits)", kind: "invalid" });

  for (const field of ["business_street", "company_city", "company_state", "company_zip_code"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const telephone = toVitalPhone(b?.phone) ?? phone;
  if (!telephone) {
    gaps.push({ field: "client_phone", label: "Phone (10-digit US number)", kind: r.client_phone ? "invalid" : "missing" });
  }

  const requested = toInt(d?.capital_requested ?? v.capital_requested);
  const monthly = monthlyRevenueOf(source, isPrimaryBusiness);
  const started = toIsoDate(b?.business_start_date) ?? toIsoDate(v.business_start_date);
  const entityType = nonEmpty(b?.legal_entity_type) ?? (isPrimaryBusiness ? nonEmpty(v.legal_entity_type) : null);
  const rawIndustry = nonEmpty(b?.industry) ?? (isPrimaryBusiness ? nonEmpty(v.industry) : null);
  const naics = resolveNaics(rawIndustry);
  const purpose = nonEmpty(d?.loan_purpose ?? v.loan_purpose);

  const business: VitalBusiness = {
    name: legalName ?? "",
    address: r.business_street ?? "",
    city: r.company_city ?? "",
    state: toStateCode(r.company_state) ?? "",
    zip: toZip5(r.company_zip_code) ?? "",
    telephone: telephone ?? "",
    owners,
    refNumber: ctx.referenceId,
  };
  if (dba && dba !== legalName) business.dba = dba;
  if (nonEmpty(v.client_email)) business.email = nonEmpty(v.client_email) as string;
  if (ein.length === 9) business.fein = ein;
  if (requested && requested > 0) business.amountRequested = requested;
  if (monthly) business.avgMonthlyRevenue = monthly;
  // "Omit the key to leave the deal's position count untouched" — so only a known count is sent.
  if (source.openPositions.length > 0) business.numPositions = source.openPositions.length;
  if (purpose) business.getUseOfFunds = purpose;
  if (entityType) business.entityType = entityType;
  if (started) business.startDate = started;
  if (naics) {
    business.naicsCode = naics.code;
    business.industryTypeMoreInfo = naics.title;
  } else if (rawIndustry) {
    business.industryTypeMoreInfo = rawIndustry;
  }

  const payload: VitalSubmission = { business };
  return { payload, redacted: redactVitalSubmission(payload), gaps, effectivePicks: {} };
}

// ── Documents ──────────────────────────────────────────────────────────────

export function vitalDocumentCategory(docCode: string | null): string | null {
  if (!docCode) return null;
  return VITAL_DOCUMENT_CATEGORIES.find((c) => c.docCodes.includes(docCode))?.category ?? null;
}

export function vitalTagsForDocCode(docCode: string | null): string[] {
  const category = vitalDocumentCategory(docCode);
  return category ? [category] : [];
}

/** Document.name: the filename without its extension. */
export function vitalDocumentName(filename: string): string {
  return filename.replace(/\.[A-Za-z0-9]+$/, "").trim() || filename;
}

// ── Status ─────────────────────────────────────────────────────────────────

/** What we keep of a GET /deal-submission/{id} response. */
export interface VitalStatus {
  id?: string;
  /** business.id — Vital's deal ("lead") id, a different number from the submission id. */
  dealId?: string;
  /** Every status-like scalar the response carried, by its own key. */
  statuses: Record<string, string>;
}

const STATUS_KEY = /status|stage|declin/i;

function scalar(v: unknown): string | null {
  return typeof v === "string" || typeof v === "number" ? nonEmpty(v) : null;
}

/**
 * The GET echoes the whole submission, owners and SSNs included, so only a
 * whitelist is ever stored as last_status: the two ids and status-like scalars.
 */
export function sanitizeVitalStatus(raw: unknown): VitalStatus {
  const top = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const biz = (top.business && typeof top.business === "object" ? top.business : {}) as Record<string, unknown>;
  const statuses: Record<string, string> = {};
  for (const obj of [biz, top]) {
    for (const [k, val] of Object.entries(obj)) {
      const s = scalar(val);
      if (s && STATUS_KEY.test(k)) statuses[k] = s.slice(0, 300);
    }
  }
  const out: VitalStatus = { statuses };
  const id = scalar(top.id);
  const dealId = scalar(biz.id);
  if (id) out.id = id;
  if (dealId) out.dealId = dealId;
  return out;
}

export function interpretVitalStatus(raw: unknown): NormalizedStatus {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<VitalStatus>;
  const statuses = s.statuses && typeof s.statuses === "object" ? s.statuses : {};
  const keys = Object.keys(statuses);
  // The most specific status wins: a sub-status over a status over anything else.
  const stageKey =
    keys.find((k) => /sub/i.test(k) && /status/i.test(k)) ??
    keys.find((k) => /status|stage/i.test(k) && !/declin/i.test(k)) ??
    null;
  const stage = stageKey ? statuses[stageKey] : null;
  const reason = keys.filter((k) => /declin/i.test(k)).map((k) => statuses[k])[0] ?? null;
  if (!stage) return { kind: "in_progress", stage: "Submitted" };

  const lines = [`Vital Cap: ${stage}`];
  if (reason) lines.push(`Reason: ${reason}`);
  if (s.dealId) lines.push(`Vital deal id: ${s.dealId}`);
  const note = lines.join("\n");

  if (VITAL_DECLINED_PATTERN.test(stage)) return { kind: "declined", stage, note };
  if (VITAL_APPROVED_PATTERN.test(stage)) return { kind: "approved", stage, note };
  if (VITAL_NEEDS_INFO_PATTERN.test(stage)) return { kind: "needs_info", stage, note };
  return { kind: "in_progress", stage };
}

/**
 * The submission id a callback names. Vital's deal id is a DIFFERENT integer
 * from the submission id we store, so a bare `id` is never read: it could be
 * a deal id that happens to equal another client's submission id. The
 * callback we register must carry the submission id under one of these keys.
 */
export function vitalSubmissionId(body: unknown): string | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const nested = (b.submission && typeof b.submission === "object" ? b.submission : {}) as Record<string, unknown>;
  return scalar(b.submissionId) ?? scalar(b.dealSubmissionId) ?? scalar(b.submission_id) ?? scalar(nested.id);
}
