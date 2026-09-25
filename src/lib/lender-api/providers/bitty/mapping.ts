// src/lib/lender-api/providers/bitty/mapping.ts
//
// Pure: our deal → Bitty POST /api/submit body, plus their dropdowns, file
// types, response reading and status reading. No I/O, no env — fully unit
// tested. `apikey`, `development` and `files` are added by client.ts.

import type {
  BuiltApplication,
  CreateApplicationResult,
  Gap,
  LenderApiSource,
  NormalizedStatus,
  PickDefinition,
  Picks,
} from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { digitsOnly, nonEmpty, splitName, toInt, toIsoDate } from "../../normalize";
import {
  BITTY_ADVANCE_COUNTS,
  BITTY_ADVANCE_FREQ,
  BITTY_FILE_EXTENSIONS,
  BITTY_FILE_TYPES,
  BITTY_MESSAGES,
  BITTY_NEGATIVE_DAY_OPTIONS,
  BITTY_YES_NO,
} from "./constants";

export interface BittyOwner {
  first_name: string;
  last_name: string;
  address: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  email: string;
  cell_phone: string;
  home_phone?: string;
  dob: string;
  ssn: string;
  fico_score?: string;
  ownership_percentage?: number;
}

export interface BittyFile {
  file: string;
  type?: number;
  file_name: string;
}

/** Everything except apikey / development / files — client.ts adds those. */
export interface BittySubmission {
  leadid: string;
  legal_name: string;
  dba_name?: string;
  address: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  email?: string;
  phone?: string;
  legal_entity_str?: string;
  industry_str?: string;
  ein: string;
  start_date: string;
  owners: BittyOwner[];
  requested_amount: number;
  bankruptcy_current: boolean;
  advance_default: boolean;
  recent_negative_days: number;
  advance_current: number;
  advance_provider1?: string;
  advance_freq1?: number;
  advance_payment1?: number;
  advance_provider2?: string;
  advance_freq2?: number;
  advance_payment2?: number;
  bank_deposits1?: number;
  bank_deposits2?: number;
  bank_deposits3?: number;
  average_revenue?: number;
}

export const BITTY_PICKS: readonly PickDefinition[] = [
  { key: "bankruptcy_current", label: "Currently in bankruptcy?", options: BITTY_YES_NO, required: true },
  { key: "advance_default", label: "Ever defaulted on an advance?", options: BITTY_YES_NO, required: true },
  { key: "advance_current", label: "Current advances (count)", options: BITTY_ADVANCE_COUNTS, required: true },
  {
    key: "recent_negative_days",
    label: "Negative days, most recent month",
    options: BITTY_NEGATIVE_DAY_OPTIONS,
    required: true,
  },
];

export const BITTY_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
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

/** Bitty's phone fields are string(10): US digits, no country code. */
export function toPhone10(v: unknown): string | null {
  const d = digitsOnly(v);
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length === 10 ? d : null;
}

function toMoney(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

interface AnalysisMonth {
  totalDeposits?: string;
  beginningBalance?: string;
  endingBalance?: string;
  avgDailyBalance?: string;
  numDeposits?: string;
  negativeDays?: string;
}

/** Same rule as the bank-analysis screen: negativeDays defaults to "0", so it isn't data on its own. */
function monthHasData(m: AnalysisMonth | undefined): boolean {
  if (!m) return false;
  return [m.totalDeposits, m.beginningBalance, m.endingBalance, m.avgDailyBalance, m.numDeposits].some(
    (v) => typeof v === "string" && v.trim() !== ""
  );
}

export interface RecentMonth {
  deposits: number;
  negativeDays: number;
}

/**
 * The most recent months of the bank analysis, newest first. The grid stores
 * 12 calendar-month slots (index 0 = January) with no year, so the walk starts
 * at the month before the analysis was created and goes back at most 12 slots
 * — the created month's own slot, if reached, is last year's. Deposits sum
 * across accounts; negative days take the worst account.
 */
export function recentAnalysisMonths(accountsData: unknown, createdAt: string | null | undefined): RecentMonth[] {
  if (!Array.isArray(accountsData) || !createdAt) return [];
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return [];

  const accounts = accountsData.filter(
    (a): a is { months: AnalysisMonth[] } => !!a && typeof a === "object" && Array.isArray((a as { months?: unknown }).months)
  );
  const out: RecentMonth[] = [];
  for (let back = 1; back <= 12; back++) {
    const idx = (created.getUTCMonth() - back + 24) % 12;
    const withData = accounts.map((a) => a.months[idx]).filter(monthHasData);
    if (!withData.length) continue;
    out.push({
      deposits: withData.reduce((sum, m) => sum + (toMoney(m.totalDeposits) ?? 0), 0),
      negativeDays: Math.min(31, Math.max(0, ...withData.map((m) => toInt(m.negativeDays) ?? 0))),
    });
  }
  return out;
}

export function suggestBittyPicks(source: LenderApiSource): Record<string, string | null> {
  const { analysis, openPositions } = source;
  const recent = recentAnalysisMonths(analysis?.accounts_data, analysis?.created_at);
  const count = openPositions.length;
  return {
    bankruptcy_current: analysis?.has_bankruptcy === true ? "Yes" : analysis?.has_bankruptcy === false ? "No" : null,
    // Nothing on file says whether the owner ever defaulted — UW answers it.
    advance_default: null,
    advance_current: count >= 3 ? "3+" : String(count),
    recent_negative_days: recent.length ? String(recent[0].negativeDays) : null,
  };
}

export function redactBittySubmission(payload: BittySubmission): BittySubmission {
  const clone: BittySubmission = JSON.parse(JSON.stringify(payload));
  for (const o of clone.owners) {
    const d = digitsOnly(o.ssn);
    o.ssn = d ? `*****${d.slice(-4)}` : "";
  }
  return clone;
}

export function buildBittySubmission(
  source: LenderApiSource,
  picks: Picks,
  ctx: { referenceId: string }
): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d, analysis, openPositions } = source;

  const effectivePicks: Record<string, string | null> = { ...suggestBittyPicks(source) };
  for (const def of BITTY_PICKS) {
    const chosen = nonEmpty(picks[def.key]);
    if (chosen) effectivePicks[def.key] = chosen;
  }
  for (const def of BITTY_PICKS) {
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
  if (ssn.length !== 9) {
    gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: r.ssn ? "invalid" : "missing" });
  }
  const dob = toIsoDate(r.owner_1_dob);
  if (!dob) gaps.push({ field: "owner_1_dob", label: VAULT_FIELD_LABELS.owner_1_dob, kind: "missing" });
  for (const field of ["owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  // Bitty rejects the whole submission unless the owner's cell is a real mobile.
  const cell = toPhone10(r.client_phone);
  if (!cell) {
    gaps.push({ field: "client_phone", label: "Owner cell phone (10 digits, mobile)", kind: r.client_phone ? "invalid" : "missing" });
  }
  const email = nonEmpty(v.client_email);
  if (!email) {
    gaps.push({ field: "client_email", label: "Client email (edit the client profile)", kind: "missing" });
  }
  const homePhone = toPhone10(v.owner_1_home_phone);
  const fico = analysis?.fico ?? toInt(/^\s*\d{3}\s*$/.test(v.credit_score ?? "") ? v.credit_score : null);
  const ownership = toInt(v.owner_1_ownership_pct);

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
  const businessPhone = toPhone10(b?.phone) ?? cell;
  const entity = nonEmpty(b?.legal_entity_type ?? v.legal_entity_type);
  const industry = nonEmpty(b?.industry ?? v.industry);
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
  const startedOn = toIsoDate(b?.business_start_date) ?? toIsoDate(v.business_start_date);
  if (!startedOn) {
    gaps.push({ field: "business_start_date", label: "Business start date (edit the client profile)", kind: "missing" });
  }

  // ── Financials ───────────────────────────────────────────────────────────
  const requested = toInt(d?.capital_requested ?? v.capital_requested);
  if (!requested || requested <= 0) {
    gaps.push({ field: "capital_requested", label: "Requested amount (edit the funding deal)", kind: "missing" });
  }

  // Three complete months of deposits give Bitty its most accurate answer;
  // the average is the documented alternative when we don't have three.
  const recent = recentAnalysisMonths(analysis?.accounts_data, analysis?.created_at);
  const lastThree = recent.length >= 3 ? recent.slice(0, 3) : null;
  const average = toInt(
    analysis?.avg_revenue ?? analysis?.avg_monthly_deposits ?? b?.avg_monthly_deposits ?? v.avg_monthly_deposits
  );
  if (!lastThree && !(average && average > 0)) {
    gaps.push({
      field: "average_revenue",
      label: "Monthly revenue (run the bank analysis or set deposits on the client profile)",
      kind: "missing",
    });
  }

  // ── Current advances ─────────────────────────────────────────────────────
  const countPick = effectivePicks.advance_current;
  const advanceCount = countPick === "3+" ? 3 : Number(countPick ?? 0);
  const advances: Partial<BittySubmission> = {};
  const detailed = advanceCount === 1 || advanceCount === 2 ? advanceCount : 0;
  if (detailed > openPositions.length) {
    gaps.push({
      field: "open_positions",
      label: `${detailed} current advance(s) picked but ${openPositions.length} open position(s) on file — add them to the client file`,
      kind: "missing",
    });
  }
  for (let i = 0; i < Math.min(detailed, openPositions.length); i++) {
    const p = openPositions[i];
    const n = i + 1;
    const freq = p.payment_frequency ? BITTY_ADVANCE_FREQ[p.payment_frequency] : undefined;
    const payment = toMoney(p.payment_amount);
    if (!freq) {
      gaps.push({
        field: "open_positions",
        label: `Open position ${n} (${p.lender_name}): Bitty takes Daily or Weekly payments only`,
        kind: p.payment_frequency ? "invalid" : "missing",
      });
    }
    if (!payment || payment <= 0) {
      gaps.push({ field: "open_positions", label: `Open position ${n} (${p.lender_name}): payment amount`, kind: "missing" });
    }
    Object.assign(advances, {
      [`advance_provider${n}`]: p.lender_name,
      [`advance_freq${n}`]: freq,
      [`advance_payment${n}`]: payment ?? undefined,
    });
  }

  const payload: BittySubmission = {
    leadid: ctx.referenceId,
    legal_name: legalName ?? "",
    ...(dba && dba !== legalName ? { dba_name: dba } : {}),
    address: r.business_street ?? "",
    // Required by their spec, but nothing on file splits out a second line.
    address2: "",
    city: r.company_city ?? "",
    state: r.company_state ?? "",
    zip: r.company_zip_code ?? "",
    ...(email ? { email } : {}),
    ...(businessPhone ? { phone: businessPhone } : {}),
    ...(entity ? { legal_entity_str: entity } : {}),
    ...(industry ? { industry_str: industry } : {}),
    ein: ein.length === 9 ? ein : "",
    start_date: startedOn ?? "",
    owners: [
      {
        first_name: name.first ?? "",
        last_name: name.last ?? "",
        address: r.owner_1_street ?? "",
        address2: "",
        city: r.owner_1_city ?? "",
        state: r.owner_1_state ?? "",
        zip: r.owner_1_zip ?? "",
        email: email ?? "",
        cell_phone: cell ?? "",
        ...(homePhone ? { home_phone: homePhone } : {}),
        dob: dob ?? "",
        ssn: ssn.length === 9 ? ssn : "",
        ...(fico && fico > 0 ? { fico_score: String(fico) } : {}),
        ...(ownership && ownership > 0 ? { ownership_percentage: ownership } : {}),
      },
    ],
    requested_amount: requested ?? 0,
    bankruptcy_current: effectivePicks.bankruptcy_current === "Yes",
    advance_default: effectivePicks.advance_default === "Yes",
    recent_negative_days: toInt(effectivePicks.recent_negative_days) ?? 0,
    advance_current: Number.isFinite(advanceCount) ? advanceCount : 0,
    ...compact(advances),
    ...(lastThree
      ? {
          // 1 = three months prior … 3 = most recent complete month.
          bank_deposits1: round2(lastThree[2].deposits),
          bank_deposits2: round2(lastThree[1].deposits),
          bank_deposits3: round2(lastThree[0].deposits),
        }
      : {}),
    ...(average && average > 0 ? { average_revenue: average } : {}),
  };

  return { payload, redacted: redactBittySubmission(payload), gaps, effectivePicks };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")) as Partial<T>;
}

// ── Files ──────────────────────────────────────────────────────────────────

export function bittyFileType(docCode: string | null): number | undefined {
  if (!docCode) return undefined;
  return BITTY_FILE_TYPES.find((t) => t.docCodes.includes(docCode))?.type;
}

export function bittyTagsForDocCode(docCode: string | null): string[] {
  if (!docCode) return [];
  const hit = BITTY_FILE_TYPES.find((t) => t.docCodes.includes(docCode));
  return hit ? [hit.tag] : [];
}

/** Why Bitty can't take this file, or null when it can. */
export function bittyFileRejection(filename: string): string | null {
  const ext = filename.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  if (!ext) return "Bitty needs a file extension to accept a file";
  return BITTY_FILE_EXTENSIONS.includes(ext) ? null : `Bitty does not accept .${ext} files`;
}

// ── Responses ──────────────────────────────────────────────────────────────

interface BittyResponse {
  success?: boolean;
  message?: string;
  id?: number | string | null;
  duplicate_id?: number | string | null;
  duplicate?: string;
  reason?: string[] | string;
  validation?: Record<string, Record<string, string[]> | string[]>;
  pre_offer?: Record<string, unknown>;
}

function messageOf(body: unknown): string {
  return String((body as BittyResponse | null)?.message ?? "").trim().toLowerCase();
}

function reasonsOf(body: BittyResponse): string[] {
  if (Array.isArray(body.reason)) return body.reason.map(String).filter(Boolean);
  return typeof body.reason === "string" && body.reason ? [body.reason] : [];
}

function idOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return nonEmpty(v);
}

/** `validation: { owners_1: { cell_phone: [...] }, ein: [...] }` → `{ "owners_1.cell_phone": [...], ein: [...] }`. */
export function flattenBittyValidation(validation: BittyResponse["validation"]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(validation ?? {})) {
    if (Array.isArray(value)) out[key] = value.map(String);
    else if (value && typeof value === "object") {
      for (const [sub, msgs] of Object.entries(value)) out[`${key}.${sub}`] = Array.isArray(msgs) ? msgs.map(String) : [String(msgs)];
    }
  }
  return out;
}

/**
 * Bitty's answer to POST /api/submit, read by `message` — never `success`,
 * which is true for Declined and Duplicate too.
 *
 * Approved / Declined / Duplicate mean the application now exists at Bitty:
 * they return an external id and carry the body as the initial status. The
 * leadid is the fallback id because "in some declined scenarios, id may be
 * blank" and the engine needs one to record the send.
 *
 * Error / Duplicate Request are clean rejections (nothing was created) unless
 * the HTTP status itself says the server failed — then we can't be sure.
 */
export function readBittySubmitResponse(httpStatus: number, body: unknown, leadid: string): CreateApplicationResult {
  const b = (body && typeof body === "object" ? body : {}) as BittyResponse;
  const message = messageOf(b);

  if (message === BITTY_MESSAGES.approved || message === BITTY_MESSAGES.declined || message === BITTY_MESSAGES.duplicate) {
    const externalId = idOf(b.id) ?? idOf(b.duplicate_id) ?? leadid;
    return { ok: true, externalId, initialStatus: body, status: httpStatus };
  }

  const serverFailed = httpStatus === 0 || httpStatus >= 500;

  if (message === BITTY_MESSAGES.error && b.validation) {
    const fieldErrors = flattenBittyValidation(b.validation);
    const first = Object.entries(fieldErrors)
      .slice(0, 3)
      .map(([k, msgs]) => `${k}: ${msgs[0] ?? "invalid"}`);
    return {
      ok: false,
      fieldErrors,
      error: first.length ? `Bitty rejected the application — ${first.join("; ")}` : "Bitty rejected the application.",
      status: 422,
    };
  }

  if (message === BITTY_MESSAGES.duplicateRequest) {
    return {
      ok: false,
      error: "Bitty is still processing an earlier request for this lead — wait a minute, then check before resending.",
      status: 409,
    };
  }

  if (message === BITTY_MESSAGES.error) {
    const reasons = reasonsOf(b);
    return {
      ok: false,
      error: reasons.length ? `Bitty: ${reasons.join(", ")}` : "Bitty returned an error.",
      // Their documented "System Error, Please Resubmit" means nothing was
      // created — unless the HTTP layer itself failed.
      status: serverFailed ? httpStatus : httpStatus >= 400 ? httpStatus : 400,
    };
  }

  // A rejected key is 401 { message: "Invalid access key, contact info@bitty.com" }.
  const said = nonEmpty(b.message);
  if (httpStatus >= 400 && httpStatus < 500 && said) {
    return { ok: false, error: `Bitty: ${said}`, status: httpStatus };
  }

  // Unknown or unreadable body: a 2xx here may still have created the deal.
  return {
    ok: false,
    error: httpStatus ? `Bitty returned an unexpected response (HTTP ${httpStatus})` : "Could not reach Bitty",
    status: httpStatus >= 400 && httpStatus < 500 ? httpStatus : httpStatus || 0,
  };
}

function money(v: unknown): string | null {
  const n = toMoney(v);
  return n === null ? null : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function offerSummary(offer: Record<string, unknown> | undefined): string | null {
  if (!offer || typeof offer !== "object") return null;
  const parts: string[] = [];
  const gross = money(offer.funding_gross);
  const net = money(offer.funding_net);
  if (gross) parts.push(`${gross} gross${net ? ` / ${net} net` : ""}`);
  const factor = toMoney(offer.funding_factor);
  if (factor) parts.push(`factor ${factor}`);
  const payment = money(offer.funding_payment);
  const term = nonEmpty(offer.funding_term);
  const freq = nonEmpty(offer.funding_freq);
  if (payment && term) parts.push(`${term} ${freq ?? ""} payments of ${payment}`.replace(/\s+/g, " "));
  const rtr = money(offer.funding_rtr);
  if (rtr) parts.push(`RTR ${rtr}`);
  const position = nonEmpty(offer.funding_lein_pos);
  if (position) parts.push(`position ${position}`);
  const fee = money(offer.funding_origination_fee);
  if (fee) parts.push(`origination ${fee}`);
  // Our commission. Bitty sends ".00" when there is none, which is left out.
  const pct = toMoney(offer.commission_percentage);
  const commission = toMoney(offer.commission_amount);
  if ((pct && pct > 0) || (commission && commission > 0)) {
    const amount = commission && commission > 0 ? money(commission) : null;
    parts.push(`commission ${pct && pct > 0 ? `${pct}%` : ""}${amount ? `${pct && pct > 0 ? " " : ""}(${amount})` : ""}`);
  }
  return parts.length ? parts.join(", ") : null;
}

export function interpretBittyStatus(raw: unknown): NormalizedStatus {
  const b = (raw && typeof raw === "object" ? raw : {}) as BittyResponse;
  const message = messageOf(b);
  const portalId = idOf(b.id);

  if (message === BITTY_MESSAGES.approved) {
    const lines = [`Bitty: Approved${portalId ? ` (portal ID ${portalId})` : ""}`];
    const offer = offerSummary(b.pre_offer);
    if (offer) lines.push(`Pre-offer: ${offer}`);
    return { kind: "approved", stage: "Approved", note: lines.join("\n") };
  }

  if (message === BITTY_MESSAGES.declined) {
    const reasons = reasonsOf(b);
    return {
      kind: "declined",
      stage: "Declined",
      note: reasons.length ? `Decline reasons: ${reasons.join(", ")}` : "Declined by Bitty (no reason given)",
    };
  }

  if (message === BITTY_MESSAGES.duplicate) {
    const dupId = idOf(b.duplicate_id);
    return {
      kind: "needs_info",
      stage: "Duplicate review",
      note:
        nonEmpty(b.duplicate) ??
        `Bitty flagged this as a possible duplicate${dupId ? ` (ID ${dupId})` : ""} and will email an Approved or Declined decision. Record it here when it arrives.`,
    };
  }

  return { kind: "in_progress", stage: nonEmpty(b.message) ?? "Unknown" };
}
