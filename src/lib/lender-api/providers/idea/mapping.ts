// src/lib/lender-api/providers/idea/mapping.ts
//
// Pure: our deal → Idea Financial POST /v1/applications body, plus Idea's
// dropdowns, document types and status reading. No I/O, no env.

import type {
  BuiltApplication,
  Gap,
  LenderApiSource,
  NormalizedStatus,
  OutboundDocument,
  PickDefinition,
  Picks,
} from "../../types";
import { VAULT_FIELD_LABELS, type VaultField } from "../../vault-fields";
import { digitsOnly, nonEmpty, splitName, toInt, toIsoDate } from "../../normalize";
import { resolveNaics } from "@/data/naics";
import {
  IDEA_DOCUMENT_TYPES,
  IDEA_DRAFT_FILE_LIMITS,
  IDEA_ENTITY_TYPES,
  IDEA_MIME_BY_EXTENSION,
  IDEA_TIME_IN_BUSINESS,
} from "./constants";

export interface IdeaAddress {
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface IdeaOwner {
  firstName: string;
  lastName: string;
  email: string;
  homeAddress: IdeaAddress;
  dateOfBirth: string;
  homePhone?: string;
  mobilePhone: string;
  ssn: string;
  fico?: number;
  ownershipPercentage?: number;
}

export interface IdeaApplication {
  /** Filled in by the client from IDEA_AGENT_ID — config, not deal data. */
  agentId?: number;
  business: {
    name: string;
    dba?: string;
    description: string;
    entityType: string;
    physicalAddress: IdeaAddress;
    ein: string;
    phone: string;
    naics?: string;
    timeInBusiness: string;
    monthlySales?: number;
  };
  owners: IdeaOwner[];
  requestedAmount?: number;
}

export const IDEA_PICKS: readonly PickDefinition[] = [
  { key: "entity_type", label: "Entity type", options: IDEA_ENTITY_TYPES, required: true },
  { key: "time_in_business", label: "Time in business", options: IDEA_TIME_IN_BUSINESS, required: true },
];

export const IDEA_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [
  "owner_1_name",
  "ssn",
  "ein",
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

/** Co-owners at or above this share must be sent complete; below it they're sent only when complete. */
const IDEA_FULL_OWNER_PCT = 20;

function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")) as T;
}

function phone10(v: unknown): string | null {
  const d = digitsOnly(v);
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length === 10 ? d : null;
}

export function mapIdeaEntityType(v: string | null | undefined): string | null {
  const s = (v ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s === "llc" || s === "limitedliabilitycompany" || s === "pllc") return "limited-liability-company";
  if (["soleprop", "soleproprietor", "soleproprietorship"].includes(s)) return "sole-proprietorship";
  if (["corp", "corporation", "inc", "scorp", "ccorp", "scorporation", "ccorporation"].includes(s)) return "corporation";
  if (s === "lp" || s === "limitedpartnership") return "limited-partnership";
  if (s === "partnership" || s === "generalpartnership" || s === "gp") return "general-partnership";
  if (s.includes("nonprofit") || s.includes("notforprofit")) return "not-for-profit";
  // LLP and anything else has no Idea equivalent — UW picks (maybe "other").
  return null;
}

function yearsSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

export function ideaTimeInBusiness(startIso: string | null, now = new Date()): string | null {
  const years = yearsSince(startIso, now);
  if (years === null || years < 0) return null;
  if (years < 1) return "zero-one-years";
  if (years < 2) return "one-two-years";
  return "over-two-years";
}

function startDate(source: LenderApiSource): string | null {
  return toIsoDate(source.business?.business_start_date) ?? toIsoDate(source.vault.business_start_date);
}

export function suggestIdeaPicks(source: LenderApiSource): Record<string, string | null> {
  const { vault, business } = source;
  return {
    entity_type: mapIdeaEntityType(business?.legal_entity_type ?? vault.legal_entity_type),
    time_in_business: ideaTimeInBusiness(startDate(source)),
  };
}

export function redactIdeaApplication(app: IdeaApplication): IdeaApplication {
  const clone: IdeaApplication = JSON.parse(JSON.stringify(app));
  for (const o of clone.owners) {
    const d = digitsOnly(o.ssn);
    o.ssn = d ? `***-**-${d.slice(-4)}` : "";
  }
  return clone;
}

function ficoFrom(source: LenderApiSource): number | undefined {
  const fromAnalysis = toInt(source.analysis?.fico);
  const fico = fromAnalysis ?? (/^\s*\d{3}\s*$/.test(source.vault.credit_score ?? "") ? toInt(source.vault.credit_score) : null);
  return fico !== null && fico >= 300 && fico <= 850 ? fico : undefined;
}

export function buildIdeaApplication(source: LenderApiSource, picks: Picks, _ctx: { referenceId: string }): BuiltApplication {
  const gaps: Gap[] = [];
  const r = source.resolved.values;
  const { vault: v, business: b, deal: d, analysis: a } = source;

  // ── Picks ────────────────────────────────────────────────────────────────
  const effectivePicks: Record<string, string | null> = { ...suggestIdeaPicks(source) };
  for (const def of IDEA_PICKS) {
    const chosen = nonEmpty(picks[def.key]);
    if (chosen) effectivePicks[def.key] = chosen;
  }
  for (const def of IDEA_PICKS) {
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
  if (ssn.length !== 9) gaps.push({ field: "ssn", label: "Owner SSN (9 digits)", kind: r.ssn ? "invalid" : "missing" });
  const dob = toIsoDate(r.owner_1_dob);
  if (!dob) gaps.push({ field: "owner_1_dob", label: VAULT_FIELD_LABELS.owner_1_dob, kind: "missing" });
  for (const field of ["owner_1_street", "owner_1_city", "owner_1_state", "owner_1_zip"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const email = nonEmpty(v.client_email);
  if (!email) gaps.push({ field: "client_email", label: "Client email (edit the client profile)", kind: "missing" });
  const mobile = phone10(r.client_phone);
  if (!mobile) gaps.push({ field: "client_phone", label: "Owner phone (10 digits)", kind: r.client_phone ? "invalid" : "missing" });
  const homePhone = phone10(v.owner_1_home_phone);
  // Never invent a share: a missing/0% owner 1 is a gap, not 100%.
  const pct1 = toInt(v.owner_1_ownership_pct);
  if (pct1 === null || pct1 === 0) {
    gaps.push({ field: "owner:1", label: "Owner 1 ownership %", kind: "missing" });
  } else if (!(pct1 > 0 && pct1 <= 100)) {
    gaps.push({ field: "owner:1", label: `Owner 1 ownership % (${pct1}%)`, kind: "invalid" });
  }

  const owner1: IdeaOwner = compact({
    firstName: name.first ?? "",
    lastName: name.last ?? "",
    email: email ?? "",
    homeAddress: compact({
      address1: r.owner_1_street ?? "",
      city: r.owner_1_city ?? "",
      state: r.owner_1_state ?? "",
      zip: r.owner_1_zip ?? "",
    }) as IdeaAddress,
    dateOfBirth: dob ?? "",
    homePhone: homePhone && homePhone !== mobile ? homePhone : undefined,
    mobilePhone: mobile ?? "",
    ssn,
    fico: ficoFrom(source),
    ownershipPercentage: pct1 ?? undefined,
  }) as IdeaOwner;

  // ── Owners 2–5 ───────────────────────────────────────────────────────────
  const coOwners: IdeaOwner[] = [];
  if (!source.ownersAvailable) {
    // Co-owners unknown, not absent: never silently send a single-owner file.
    const vv = v as unknown as Record<string, unknown>;
    for (const n of [2, 3, 4, 5] as const) {
      const pct = toInt(vv[`owner_${n}_ownership_pct`]);
      if (pct !== null && pct >= IDEA_FULL_OWNER_PCT) {
        gaps.push({
          field: `owner:${n}`,
          label: `Owner ${n} (${nonEmpty(vv[`owner_${n}_name`]) ?? "unnamed"}, ${pct}%): owner details can't be loaded yet`,
          kind: "missing",
        });
      }
    }
  } else {
    for (const o of [...source.owners].sort((x, y) => x.position - y.position)) {
      if (o.ownership_pct === 0 && nonEmpty(o.full_name)) {
        gaps.push({ field: `owner:${o.position}`, label: `Owner ${o.position} (${o.full_name}, 0%): confirm the ownership %`, kind: "invalid" });
        continue;
      }
      if (!(o.ownership_pct > 0)) continue;
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
        // A minority owner with partial details is left off rather than blocking the file.
        if (o.ownership_pct >= IDEA_FULL_OWNER_PCT) {
          gaps.push({
            field: `owner:${o.position}`,
            label: `Owner ${o.position} (${o.full_name}, ${o.ownership_pct}%): missing ${missing.join(", ")}`,
            kind: "missing",
          });
        }
        continue;
      }
      coOwners.push({
        firstName: on.first as string,
        lastName: on.last as string,
        email: oEmail as string,
        homeAddress: { address1: o.street as string, city: o.city as string, state: o.state as string, zip: o.zip as string },
        dateOfBirth: oDob as string,
        mobilePhone: oPhone as string,
        ssn: oSsn,
        ownershipPercentage: o.ownership_pct,
      });
    }
  }
  const shareTotal = (pct1 ?? 0) + coOwners.reduce((sum, o) => sum + (o.ownershipPercentage ?? 0), 0);
  if (shareTotal > 100) {
    gaps.push({ field: "owner:shares", label: `Ownership adds up to ${shareTotal}% — it can't pass 100%`, kind: "invalid" });
  }

  // ── Business ─────────────────────────────────────────────────────────────
  // The vault's legal name, DBA and EIN belong to the primary business only.
  const isPrimaryBusiness = !b || b.is_primary;
  const legalName = isPrimaryBusiness
    ? nonEmpty(v.company_name) ?? nonEmpty(b?.company_name) ?? nonEmpty(b?.business_name)
    : nonEmpty(b?.company_name) ?? nonEmpty(b?.business_name);
  if (!legalName) gaps.push({ field: "business_name", label: "Business legal name (edit the client profile)", kind: "missing" });
  const dbaCandidate = isPrimaryBusiness ? nonEmpty(v.dba) ?? nonEmpty(b?.business_name) : nonEmpty(b?.business_name);
  const dba = dbaCandidate && dbaCandidate !== legalName ? dbaCandidate : undefined;

  // r.ein is already null for a non-primary business (scopeResolvedToBusiness).
  const ein = digitsOnly(r.ein);
  if (ein.length !== 9) {
    gaps.push(
      isPrimaryBusiness
        ? { field: "ein", label: "EIN (9 digits)", kind: r.ein ? "invalid" : "missing" }
        : { field: "business:ein", label: "EIN — the vault only holds the primary business's EIN", kind: "missing" }
    );
  }
  for (const field of ["business_street", "company_city", "company_state", "company_zip_code"] as const) {
    if (!r[field]) gaps.push({ field, label: VAULT_FIELD_LABELS[field], kind: "missing" });
  }
  const businessPhone = phone10(b?.phone) ?? mobile;
  if (!businessPhone) gaps.push({ field: "client_phone", label: "Business phone (10 digits)", kind: "missing" });

  const rawIndustry = nonEmpty(b?.industry) ?? nonEmpty(v.industry);
  const naics = resolveNaics(rawIndustry);
  const description = naics?.title ?? rawIndustry;
  if (!description) {
    gaps.push({ field: "business:industry", label: "Business description / industry (edit the business profile)", kind: "missing" });
  }

  const monthly = a?.avg_revenue ?? a?.avg_monthly_deposits ?? b?.avg_monthly_deposits ?? v.avg_monthly_deposits;
  const capital = d?.capital_requested ?? v.capital_requested;

  const payload: IdeaApplication = compact({
    business: compact({
      name: legalName ?? "",
      dba,
      description: description ?? "",
      entityType: effectivePicks.entity_type ?? "",
      physicalAddress: compact({
        address1: r.business_street ?? "",
        city: r.company_city ?? "",
        state: r.company_state ?? "",
        zip: r.company_zip_code ?? "",
      }) as IdeaAddress,
      ein,
      phone: businessPhone ?? "",
      naics: naics?.code,
      timeInBusiness: effectivePicks.time_in_business ?? "",
      monthlySales: monthly && monthly > 0 ? Math.round(monthly) : undefined,
    }) as IdeaApplication["business"],
    owners: [owner1, ...coOwners],
    requestedAmount: capital && capital > 0 ? Math.round(capital) : undefined,
  }) as IdeaApplication;

  return { payload, redacted: redactIdeaApplication(payload), gaps, effectivePicks };
}

// ── Documents ──────────────────────────────────────────────────────────────

export function ideaDocumentType(docCode: string | null): string | null {
  if (!docCode) return null;
  return IDEA_DOCUMENT_TYPES.find((t) => t.docCodes.includes(docCode))?.type ?? null;
}

export function ideaTagsForDocCode(docCode: string | null): string[] {
  const type = ideaDocumentType(docCode);
  return type ? [type] : [];
}

export interface IdeaFilePlan {
  documentType: string;
  fileName: string;
  fileExtension: string;
  mimeType: string;
}

/**
 * What each file goes up as, or why it can't go: no Idea type, a format Idea
 * refuses, or past the Draft per-type cap. Pure, in send order.
 */
export function planIdeaUploads(docs: OutboundDocument[]): Array<IdeaFilePlan | { error: string }> {
  const counts: Record<string, number> = {};
  return docs.map((d) => {
    const documentType = ideaDocumentType(d.docCode);
    if (!documentType) {
      return { error: "Idea takes only the signed application and bank statements at submission" };
    }
    const ext = /\.([a-z0-9]+)$/i.exec(d.filename.trim())?.[1]?.toLowerCase() ?? "";
    const mimeType = IDEA_MIME_BY_EXTENSION[ext];
    if (!mimeType) return { error: "Idea accepts PDF, PNG, JPG, GIF or TIFF files only" };
    counts[documentType] = (counts[documentType] ?? 0) + 1;
    const limit = IDEA_DRAFT_FILE_LIMITS[documentType];
    if (limit !== undefined && counts[documentType] > limit) {
      return { error: `Idea takes at most ${limit} ${documentType} files per submission` };
    }
    return { documentType, fileName: d.filename.trim(), fileExtension: `.${ext}`, mimeType };
  });
}

// ── Status ─────────────────────────────────────────────────────────────────

/** Statuses from which a push moves the file into Idea's review. */
export const IDEA_PUSHABLE_FROM_DRAFT = "draft";

/**
 * What we store as last_status: the GET body minus everything personal.
 * GET /v1/applications/{id} echoes owners with full SSN and DOB.
 */
export function sanitizeIdeaStatus(raw: unknown, extra?: { pushError?: string | null }): Record<string, unknown> {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const keep = [
    "id",
    "status",
    "offerPageUrl",
    "offers",
    "checkoutRequirements",
    "applicationFiles",
    "declinedReason",
    "incompleteInfo",
    "advisor",
    "loanNumber",
    "notInterestedReason",
    "notInterestedReasonAdditionalComment",
    "competitorName",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (k in s) out[k] = s[k];
  if (extra?.pushError) out.pushError = extra.pushError;
  return out;
}

function money(n: unknown): string {
  const num = Number(n);
  return n === null || n === undefined || n === "" || !Number.isFinite(num) ? "?" : `$${num.toLocaleString("en-US")}`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** "term-loan" → "Term loan". */
function productLabel(v: unknown): string | null {
  const s = str(v);
  return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ") : null;
}

function range(lo: unknown, hi: unknown, fmt: (n: unknown) => string): string | null {
  if (lo === undefined && hi === undefined) return null;
  return lo !== undefined && hi !== undefined && Number(lo) !== Number(hi) ? `${fmt(lo)}–${fmt(hi)}` : fmt(hi ?? lo);
}

/**
 * Open checkout requirements (stips). Seen statuses: "required" and
 * "not-required-for-offer-selected"; anything approved or not-required-* is
 * settled. A "text" requirement is a question, carried in `notes`.
 */
function requirementNames(reqs: unknown): string[] {
  if (!Array.isArray(reqs)) return [];
  return (reqs as Array<Record<string, unknown>>)
    .filter((q) => !/^(approved|not-required)/i.test(String(q.status ?? "")))
    .map((q) => {
      const name = str(q.name) ?? str(q.requiredDocument);
      const question = q.requiredDocumentType === "text" ? str(q.notes) : null;
      return name && question ? `${name} (${question})` : name ?? question;
    })
    .filter((n): n is string => !!n);
}

/** Offer terms live under offer.details (sandbox 2026-10-07); an offer without details is read flat. */
function describeOffers(s: Record<string, unknown>): string[] {
  const offers = Array.isArray(s.offers) ? (s.offers as Array<Record<string, unknown>>) : [];
  const lines = offers.map((o, i) => {
    const d = (o.details && typeof o.details === "object" ? o.details : o) as Record<string, unknown>;
    const parts = [
      productLabel(d.productType) ?? `Offer ${i + 1}`,
      range(d.minAmount, d.maxAmount ?? d.amount, money),
      d.term !== undefined ? `${String(d.term)} months` : null,
      str(d.paymentFrequency),
      range(d.minInterestRate, d.maxInterestRate ?? d.interestRate, (n) => `${String(n)}%`),
      Number(d.originationFee) > 0 ? `origination ${String(d.originationFee)}%` : null,
      Number(d.maintenanceFee) > 0 ? `maintenance ${String(d.maintenanceFee)}%` : null,
      Number(d.drawFee) > 0 ? `draw fee ${String(d.drawFee)}%` : null,
      str(o.status) && o.status !== "pending" ? `(${str(o.status)})` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  });
  const open = [
    ...requirementNames(s.checkoutRequirements),
    ...offers.flatMap((o) => requirementNames(o.checkoutRequirements)),
  ];
  if (open.length) lines.push(`Stips: ${Array.from(new Set(open)).join(", ")}`);
  const url = str(s.offerPageUrl);
  if (url) lines.push(`Offer page: ${url}`);
  return lines;
}

export function interpretIdeaStatus(raw: unknown): NormalizedStatus {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const stage = str(s.status) ?? "unknown";
  // Sandbox fills incompleteInfo (not declinedReason) even on a decline; read both.
  const reason = str(s.declinedReason) ?? str(s.incompleteInfo);

  switch (stage) {
    case "draft":
      // Created, but Idea isn't reviewing it until a push succeeds.
      return {
        kind: "needs_info",
        stage,
        note:
          "Not submitted to Idea's review yet — it needs a signed application and bank statements uploaded. " +
          (str(s.pushError) ? `Idea said: ${str(s.pushError)}. ` : "") +
          "Refresh submits it once the files are there.",
      };
    case "submission-incomplete":
      return { kind: "needs_info", stage, note: reason ?? "Idea marked the submission incomplete — check the Idea broker portal" };
    case "declined":
      return { kind: "declined", stage, note: reason ?? "Declined by Idea Financial (no reason given)" };
    case "offer":
    case "conditional-offer":
    case "closing":
    case "closing-incomplete":
    case "contract-ready":
    case "contract-out":
    case "open":
    case "funded":
    case "closed": {
      // Idea flips the status to offer a moment BEFORE attaching the offers.
      // The verdict is written once, so wait for them rather than record an
      // approval with no terms.
      const hasOffers = Array.isArray(s.offers) && s.offers.length > 0;
      if (!hasOffers && (stage === "offer" || stage === "conditional-offer")) return { kind: "in_progress", stage };
      const lines = describeOffers(s);
      if (stage === "closing-incomplete" && reason) lines.push(`Closing incomplete: ${reason}`);
      return { kind: "approved", stage, note: lines.join("\n") || `Idea Financial: ${stage}` };
    }
    default:
      return { kind: "in_progress", stage };
  }
}
