// src/lib/lender-api/providers/pirs/mapping.ts
//
// Pure: our deal → PIRS POST /api/Application/Create body, plus the company
// type dropdown, attachment descriptions and status reading. No I/O, no env.

import type { BuiltApplication, Gap, LenderApiSource, NormalizedStatus, PickDefinition, Picks } from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { digitsOnly, nonEmpty, splitName, toInt, toIsoDate, toZip5 } from "../../normalize";
import {
  PIRS_APPROVED_STATUSES,
  PIRS_COMPANY_TYPES,
  PIRS_DECLINED_STATUSES,
  PIRS_MAX_OWNERS,
  PIRS_MERCHANT_REJECTED_STATUS,
  PIRS_MISSING_INFO_STATUSES,
  PIRS_STAGE_LABELS,
} from "./constants";

/** Street only: PIRS derives city and state from the zip. */
export interface PirsAddress {
  address: string;
  zip: string;
}

export interface PirsOwner {
  address: PirsAddress;
  ownerInfo: {
    ownerInfoRequired: boolean;
    firstName: string;
    lastName: string;
    /** yyyy-MM-dd */
    dateOfBirth: string;
    /** XXX-XX-XXXX — the validator refuses bare digits. */
    ssn: string;
  };
}

export interface PirsApplication {
  legalName: string;
  /** Required by PIRS: the legal name when there is no DBA. */
  dba: string;
  address: PirsAddress;
  /** (XXX) XXX-XXXX */
  phone: string;
  cell: string;
  /** XX-XXXXXXX — the validator refuses bare digits. */
  taxID: string;
  type: string;
  owner1: PirsOwner;
  owner2?: PirsOwner;
  owner3?: PirsOwner;
  owner4?: PirsOwner;
  /** yyyy-MM-dd, the business start date. */
  timeInBusiness?: string;
  email: string;
  /** Posted as the first comment on the deal: the ask, which the API has no field for. */
  comments?: string;
  /** Added by the client from env, never by mapping. */
  callbackUrl?: string;
}

export const PIRS_PICKS: readonly PickDefinition[] = [
  { key: "company_type", label: "Company type", options: PIRS_COMPANY_TYPES, required: true },
];

export const PIRS_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
  "owner_1_name",
  "ssn",
  "ein",
  "owner_1_dob",
  "owner_1_street",
  "owner_1_zip",
  "client_phone",
  "business_street",
  "company_zip_code",
];

/** Co-owners at or above this share must be sent complete; below it they're sent only when complete. */
const PIRS_FULL_OWNER_PCT = 20;

export function formatPirsPhone(v: unknown): string | null {
  let d = digitsOnly(v);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null;
}

export function formatPirsSsn(v: unknown): string | null {
  const d = digitsOnly(v);
  return d.length === 9 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : null;
}

export function formatPirsTaxId(v: unknown): string | null {
  const d = digitsOnly(v);
  return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : null;
}

export function mapPirsCompanyType(v: string | null | undefined): string | null {
  const s = (v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s === "llc" || s === "limitedliabilitycompany" || s === "pllc") return "LLC";
  if (["corp", "corporation", "inc", "scorp", "ccorp", "scorporation", "ccorporation"].includes(s)) return "Corp";
  if (["soleprop", "soleproprietor", "soleproprietorship"].includes(s)) return "SoleProp";
  if (s === "llp" || s === "limitedliabilitypartnership") return "LLP";
  if (s === "lp" || s === "limitedpartnership") return "LP";
  if (s === "partnership" || s === "generalpartnership" || s === "gp") return "Partnership";
  return null;
}

function startDate(source: LenderApiSource): string | null {
  return toIsoDate(source.business?.business_start_date) ?? toIsoDate(source.vault.business_start_date);
}

export function suggestPirsPicks(source: LenderApiSource): Record<string, string | null> {
  return { company_type: mapPirsCompanyType(source.business?.legal_entity_type ?? source.vault.legal_entity_type) };
}

export function redactPirsApplication(app: PirsApplication): PirsApplication {
  const clone: PirsApplication = JSON.parse(JSON.stringify(app));
  for (const key of ["owner1", "owner2", "owner3", "owner4"] as const) {
    const o = clone[key];
    if (o) o.ownerInfo.ssn = o.ownerInfo.ssn ? `***-**-${digitsOnly(o.ownerInfo.ssn).slice(-4)}` : "";
  }
  return clone;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function buildPirsApplication(source: LenderApiSource, picks: Picks, ctx: { referenceId: string }): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d, analysis: a } = source;

  // ── Picks ────────────────────────────────────────────────────────────────
  const effectivePicks: Record<string, string | null> = { ...suggestPirsPicks(source) };
  for (const def of PIRS_PICKS) {
    const chosen = nonEmpty(picks[def.key]);
    if (chosen) effectivePicks[def.key] = chosen;
  }
  for (const def of PIRS_PICKS) {
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
  const ssn = formatPirsSsn(r.ssn);
  if (!ssn) gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: r.ssn ? "invalid" : "missing" });
  const dob = toIsoDate(r.owner_1_dob);
  if (!dob) gaps.push({ field: "owner_1_dob", label: VAULT_FIELD_LABELS.owner_1_dob, kind: "missing" });
  if (!r.owner_1_street) gaps.push({ field: "owner_1_street", label: VAULT_FIELD_LABELS.owner_1_street, kind: "missing" });
  const ownerZip = toZip5(r.owner_1_zip);
  if (!ownerZip) gaps.push({ field: "owner_1_zip", label: VAULT_FIELD_LABELS.owner_1_zip, kind: r.owner_1_zip ? "invalid" : "missing" });
  const email = nonEmpty(v.client_email);
  if (!email) gaps.push({ field: "client_email", label: "Client email (edit the client profile)", kind: "missing" });
  const cell = formatPirsPhone(r.client_phone);
  if (!cell) gaps.push({ field: "client_phone", label: "Owner cell phone (10 digits)", kind: r.client_phone ? "invalid" : "missing" });

  const owner1: PirsOwner = {
    address: { address: r.owner_1_street ?? "", zip: ownerZip ?? "" },
    ownerInfo: {
      ownerInfoRequired: true,
      firstName: name.first ?? "",
      lastName: name.last ?? "",
      dateOfBirth: dob ?? "",
      ssn: ssn ?? "",
    },
  };

  // ── Owners 2–4 ───────────────────────────────────────────────────────────
  const coOwners: PirsOwner[] = [];
  if (!source.ownersAvailable) {
    // Co-owners unknown, not absent: never silently send a single-owner file.
    const vv = v as unknown as Record<string, unknown>;
    for (const n of [2, 3, 4, 5] as const) {
      const pct = toInt(vv[`owner_${n}_ownership_pct`]);
      if (pct !== null && pct >= PIRS_FULL_OWNER_PCT) {
        gaps.push({
          field: `owner:${n}`,
          label: `Owner ${n} (${nonEmpty(vv[`owner_${n}_name`]) ?? "unnamed"}, ${pct}%): owner details can't be loaded yet`,
          kind: "missing",
        });
      }
    }
  } else {
    const ranked = [...source.owners].sort((x, y) => y.ownership_pct - x.ownership_pct || x.position - y.position);
    for (const o of ranked) {
      if (o.ownership_pct === 0 && nonEmpty(o.full_name)) {
        gaps.push({ field: `owner:${o.position}`, label: `Owner ${o.position} (${o.full_name}, 0%): confirm the ownership %`, kind: "invalid" });
        continue;
      }
      if (!(o.ownership_pct > 0)) continue;
      const on = splitName(o.full_name);
      const oDob = toIsoDate(o.dob);
      const oSsn = formatPirsSsn(o.ssn);
      const oZip = toZip5(o.zip);
      const missing: string[] = [];
      if (!on.first || !on.last) missing.push("full name");
      if (!oDob) missing.push("DOB");
      if (!oSsn) missing.push("SSN");
      if (!nonEmpty(o.street) || !oZip) missing.push("home address");
      if (missing.length) {
        // A minority owner with partial details is left off rather than blocking the file.
        if (o.ownership_pct >= PIRS_FULL_OWNER_PCT) {
          gaps.push({
            field: `owner:${o.position}`,
            label: `Owner ${o.position} (${o.full_name}, ${o.ownership_pct}%): missing ${missing.join(", ")}`,
            kind: "missing",
          });
        }
        continue;
      }
      if (coOwners.length >= PIRS_MAX_OWNERS - 1) {
        if (o.ownership_pct >= PIRS_FULL_OWNER_PCT) {
          gaps.push({
            field: `owner:${o.position}`,
            label: `Owner ${o.position} (${o.full_name}, ${o.ownership_pct}%): PIRS takes at most ${PIRS_MAX_OWNERS} owners`,
            kind: "invalid",
          });
        }
        continue;
      }
      coOwners.push({
        address: { address: (o.street as string).trim(), zip: oZip as string },
        ownerInfo: {
          ownerInfoRequired: true,
          firstName: on.first as string,
          lastName: on.last as string,
          dateOfBirth: oDob as string,
          ssn: oSsn as string,
        },
      });
    }
  }

  // ── Business ─────────────────────────────────────────────────────────────
  // The vault's legal name, DBA and EIN belong to the primary business only.
  const isPrimaryBusiness = !b || b.is_primary;
  const legalName = isPrimaryBusiness
    ? nonEmpty(v.company_name) ?? nonEmpty(b?.company_name) ?? nonEmpty(b?.business_name)
    : nonEmpty(b?.company_name) ?? nonEmpty(b?.business_name);
  if (!legalName) gaps.push({ field: "business_name", label: "Business legal name (edit the client profile)", kind: "missing" });
  const dba = (isPrimaryBusiness ? nonEmpty(v.dba) ?? nonEmpty(b?.business_name) : nonEmpty(b?.business_name)) ?? legalName;

  // r.ein is already null for a non-primary business (scopeResolvedToBusiness).
  const taxID = formatPirsTaxId(r.ein);
  if (!taxID) {
    gaps.push(
      isPrimaryBusiness
        ? { field: "ein", label: "EIN (9 digits)", kind: r.ein ? "invalid" : "missing" }
        : { field: "business:ein", label: "EIN — the vault only holds the primary business's EIN", kind: "missing" }
    );
  }
  if (!r.business_street) gaps.push({ field: "business_street", label: VAULT_FIELD_LABELS.business_street, kind: "missing" });
  const businessZip = toZip5(r.company_zip_code);
  if (!businessZip) {
    gaps.push({ field: "company_zip_code", label: VAULT_FIELD_LABELS.company_zip_code, kind: r.company_zip_code ? "invalid" : "missing" });
  }
  const phone = formatPirsPhone(b?.phone) ?? cell;

  const tib = startDate(source);
  if (!tib) gaps.push({ field: "business:start_date", label: "Business start date (edit the business profile)", kind: "missing" });

  // The API has no amount field; the ask travels as the deal's first comment.
  const capital = d?.capital_requested ?? v.capital_requested;
  const monthly = a?.avg_revenue ?? a?.avg_monthly_deposits ?? b?.avg_monthly_deposits ?? v.avg_monthly_deposits;
  const purpose = nonEmpty(d?.loan_purpose) ?? nonEmpty(v.loan_purpose);
  const comments = [
    capital && capital > 0 ? `Requested amount: ${money(capital)}` : null,
    monthly && monthly > 0 ? `Avg monthly revenue: ${money(monthly)}` : null,
    purpose ? `Use of funds: ${purpose}` : null,
    `Reference: ${ctx.referenceId}`,
  ]
    .filter(Boolean)
    .join("\n");

  const payload: PirsApplication = {
    legalName: legalName ?? "",
    dba: dba ?? "",
    address: { address: r.business_street ?? "", zip: businessZip ?? "" },
    phone: phone ?? "",
    cell: cell ?? "",
    taxID: taxID ?? "",
    type: effectivePicks.company_type ?? "",
    owner1,
    ...Object.fromEntries(coOwners.map((o, i) => [`owner${i + 2}`, o])),
    ...(tib ? { timeInBusiness: tib } : {}),
    email: email ?? "",
    comments,
  };

  return { payload, redacted: redactPirsApplication(payload), gaps, effectivePicks };
}

// ── Documents ──────────────────────────────────────────────────────────────

/** PIRS has no document vocabulary: every file is a free-text-described attachment. */
export function pirsTagsForDocCode(_docCode: string | null): string[] {
  return [];
}

/** "business_bank_statements" → "Business bank statements". */
export function pirsAttachmentDescription(docCode: string | null): string {
  const s = (docCode ?? "").trim().replace(/[_-]+/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Document";
}

// ── Status ─────────────────────────────────────────────────────────────────

/**
 * What we store as last_status: the GET body minus everything personal (it
 * echoes owners with full SSN and DOB), plus the approved options when fetched.
 */
export function sanitizePirsStatus(raw: unknown, options?: unknown): Record<string, unknown> {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["fundId", "status", "rejectReasons", "missingInfoDetails", "isWeeklyPaymentSelected"]) {
    if (k in s) out[k] = s[k];
  }
  if (options && typeof options === "object") out.options = options;
  return out;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
}

/** One line per approved option, then the fees. */
export function describePirsOptions(raw: unknown): string[] {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const options = Array.isArray(o.options) ? (o.options as Array<Record<string, unknown>>) : [];
  const lines = options.map((opt, i) => {
    const adv = num(opt.maxAdvanceAmount);
    const factor = num(opt.factor);
    const pay = num(opt.maxDailyPayment);
    const term = num(opt.estTerm);
    const parts = [
      str(opt.tier) ? `Tier ${str(opt.tier)}` : `Option ${i + 1}`,
      adv !== null ? `up to ${money(adv)}` : null,
      factor !== null ? `factor ${factor}` : null,
      term !== null ? `~${term} ${str(opt.estTermUnit)?.toLowerCase() ?? "months"}` : null,
      pay !== null ? `max daily payment ${money(pay)}` : null,
      str(opt.position) ? `position ${str(opt.position)}` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  });
  const fees = [
    num(o.originationFee) ? `origination ${num(o.originationFee)}%` : null,
    num(o.applicationFee) ? `application fee ${money(num(o.applicationFee) as number)}` : null,
    num(o.professionalFee) ? `professional fee ${money(num(o.professionalFee) as number)}` : null,
  ].filter(Boolean);
  if (lines.length && fees.length) lines.push(`Fees: ${fees.join(", ")}`);
  return lines;
}

export function isPirsApprovedStatus(status: unknown): boolean {
  return typeof status === "string" && PIRS_APPROVED_STATUSES.includes(status.trim());
}

export function interpretPirsStatus(raw: unknown): NormalizedStatus {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const stage = str(s.status) ?? "Unknown";

  if (PIRS_DECLINED_STATUSES.includes(stage)) {
    return { kind: "declined", stage, note: str(s.rejectReasons) ?? "Declined by PIRS Capital (no reason given)" };
  }
  if (PIRS_MISSING_INFO_STATUSES.includes(stage)) {
    return {
      kind: "needs_info",
      stage,
      note: str(s.missingInfoDetails) ?? "PIRS needs more information — check the deal in the Pirs Portal",
    };
  }
  if (PIRS_APPROVED_STATUSES.includes(stage)) {
    const lines = describePirsOptions(s.options);
    if (stage === "MissingStips") lines.push("PIRS is waiting on stips before funding — check the Pirs Portal");
    return { kind: "approved", stage, note: lines.join("\n") || `PIRS Capital: ${stage} (terms in the Pirs Portal)` };
  }
  if (stage === PIRS_MERCHANT_REJECTED_STATUS) return { kind: "in_progress", stage: "Merchant turned down PIRS's offer" };
  return { kind: "in_progress", stage: PIRS_STAGE_LABELS[stage] ?? stage };
}
