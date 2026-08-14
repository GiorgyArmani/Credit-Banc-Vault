/**
 * Document groups — the grouping axis for any document field.
 *
 * THE PROBLEM, RESTATED GENERALLY. A funded file carries four bank accounts ×
 * twelve months of statements. Rendered flat that is one category card with 48+
 * identical-looking rows (the O'Rourke file has 124), unreadable for
 * underwriting and useless to the lender receiving the packet. Nothing about
 * that is specific to banking — the same file carries several years of tax
 * returns, a licence for each owner, a policy per insurance line. Every
 * multi-file field accumulates the same wall, and every one has an obvious axis
 * to cut it on.
 *
 * So a "bank account" is not a concept this module knows about. It knows about
 * a GROUP: a named subdivision of one document field on one file. Bank accounts
 * are that concept configured with a bank name, a required last-four and an
 * account type; tax years are the same concept configured with a year and
 * nothing else. The configuration lives in GROUP_FIELD_CONFIGS below and is the
 * only place a new field's vocabulary is spelled out — no schema change, no new
 * component, no new endpoint.
 *
 * `document_groups` (migration 20260814, generalizing 20260813's bank_accounts)
 * holds the rows; `user_documents.document_group_id` points each file at one.
 * Everything here is the read side of that FK: how a group is spelled on
 * screen, how a document list is cut into sections, and what a grouped file is
 * named when it is downloaded.
 *
 * Server + client both import this — single source of truth, same contract as
 * @/lib/document-scope, which owns the business / funding-round axes. The three
 * axes compose: a document belongs to a business, to a funding round, and (once
 * organised) to a group within its own field.
 */

import { BANK_STATEMENTS_DOC_CODE } from "./document-scope";

/* ========================================================================== *
 * The row
 * ========================================================================== */

export interface DocumentGroup {
  id: string;
  client_vault_id: string;
  /** NULL for client-scoped fields (DL / PFS / MyScoreIQ) — see the migration. */
  business_profile_id: string | null;
  /** Which document field this group subdivides. Groups never cross fields. */
  doc_code: string;
  /** `Chase` · `2024` · `John Smith`. */
  name: string;
  /** Optional discriminator: the last four, a policy number. Never a full account number. */
  identifier: string | null;
  /** Optional per-field kind: `checking`, `business`, `GL`. */
  subtype: string | null;
  /** Optional human tag: `Payroll`, `Operating`. */
  nickname: string | null;
  is_active: boolean;
  created_at?: string;
  created_by_role?: string | null;
}

/* ========================================================================== *
 * Per-field configuration
 * ========================================================================== */

export interface GroupIdentifierConfig {
  label: string;
  placeholder: string;
  /** Strip everything but digits as the user types. */
  digitsOnly?: boolean;
  maxLength?: number;
  /** Render as `••4821` — a masked account number, not a plain suffix. */
  mask?: boolean;
  required?: boolean;
  /**
   * Anchored regex source, enforced identically in the picker and in the API.
   * Kept as a string so both sides build their own RegExp rather than sharing a
   * stateful one.
   */
  pattern?: string;
  /** Shown when `pattern` rejects the input. */
  patternError?: string;
}

export interface GroupFieldConfig {
  /** One group, in this field's language: `Bank account`, `Tax year`, `Person`. */
  noun: string;
  /** Several of them, for headings and empty states. */
  nounPlural: string;
  /** The `name` column, in this field's language. */
  nameLabel: string;
  namePlaceholder: string;
  identifier?: GroupIdentifierConfig;
  subtypeLabel?: string;
  subtypes?: { value: string; label: string }[];
  nicknameLabel?: string;
  nicknamePlaceholder?: string;
  /**
   * Sort newest-first. Right for anything named after a period — 2025 is what a
   * reviewer opens first — wrong for anything named after a thing, where
   * alphabetical is what makes a list scannable.
   */
  newestFirst?: boolean;
  /** Prompt on the picker. Falls back to a generic line built from `noun`. */
  helpText?: string;
}

/**
 * The vocabulary each field uses for its groups.
 *
 * A field absent from this map gets DEFAULT_GROUP_CONFIG and still groups
 * perfectly well — the map exists to make the common fields read naturally
 * ("Tax year", not "Group name"), not to gate the feature. Adding a field here
 * is a pure content change.
 */
export const GROUP_FIELD_CONFIGS: Record<string, GroupFieldConfig> = {
  /**
   * Bank statements — the original, reproduced EXACTLY. The label this config
   * produces is byte-identical to what formatBankAccountLabel produced before
   * the generalization (`Chase ••4821 · Payroll`), which is what keeps already
   * organised statements, their file names and their lender packets stable.
   */
  [BANK_STATEMENTS_DOC_CODE]: {
    noun: "Bank account",
    nounPlural: "Bank accounts",
    nameLabel: "Bank name",
    namePlaceholder: "Bank name (e.g. Chase)",
    identifier: {
      label: "Last 4 digits",
      placeholder: "Last 4 digits",
      digitsOnly: true,
      maxLength: 4,
      mask: true,
      required: true,
      pattern: "^\\d{4}$",
      patternError: "Enter exactly the last 4 digits of the account number",
    },
    subtypeLabel: "Account type",
    subtypes: [
      { value: "checking", label: "Checking" },
      { value: "savings", label: "Savings" },
      { value: "merchant", label: "Merchant" },
      { value: "other", label: "Other" },
    ],
    nicknameLabel: "Nickname",
    nicknamePlaceholder: "Nickname (optional)",
    helpText: "Group each statement under the account it came from.",
  },

  credit_card_statements: {
    noun: "Card",
    nounPlural: "Cards",
    nameLabel: "Issuer",
    namePlaceholder: "Issuer (e.g. Amex)",
    identifier: {
      label: "Last 4 digits",
      placeholder: "Last 4 digits",
      digitsOnly: true,
      maxLength: 4,
      mask: true,
      required: true,
      pattern: "^\\d{4}$",
      patternError: "Enter exactly the last 4 digits of the card number",
    },
    nicknameLabel: "Nickname",
    nicknamePlaceholder: "Nickname (optional)",
    helpText: "Group each statement under the card it came from.",
  },

  tax_returns: {
    noun: "Tax year",
    nounPlural: "Tax years",
    nameLabel: "Year",
    namePlaceholder: "Year (e.g. 2024)",
    subtypeLabel: "Return type",
    subtypes: [
      { value: "business", label: "Business" },
      { value: "personal", label: "Personal" },
    ],
    nicknameLabel: "Entity or person",
    nicknamePlaceholder: "Entity or person (optional)",
    newestFirst: true,
    helpText: "Group each return under its tax year.",
  },

  /**
   * Front and back are two files for one person, and a file with two owners
   * lands four. The person is the only axis that makes that legible.
   */
  drivers_license: {
    noun: "Person",
    nounPlural: "People",
    nameLabel: "Full name",
    namePlaceholder: "Full name",
    nicknameLabel: "Role",
    nicknamePlaceholder: "Role (e.g. Owner, Guarantor)",
    helpText: "Group each licence under the person it belongs to.",
  },

  pfs: {
    noun: "Person",
    nounPlural: "People",
    nameLabel: "Full name",
    namePlaceholder: "Full name",
    nicknameLabel: "Role",
    nicknamePlaceholder: "Role (e.g. Owner, Guarantor)",
    helpText: "Group each statement under the person it describes.",
  },

  insurance_documents: {
    noun: "Policy",
    nounPlural: "Policies",
    nameLabel: "Carrier",
    namePlaceholder: "Carrier (e.g. Hartford)",
    identifier: {
      label: "Policy number",
      placeholder: "Policy number (optional)",
      maxLength: 40,
    },
    subtypeLabel: "Coverage",
    subtypes: [
      { value: "gl", label: "General Liability" },
      { value: "wc", label: "Workers' Comp" },
      { value: "auto", label: "Auto" },
      { value: "bop", label: "BOP" },
      { value: "other", label: "Other" },
    ],
    helpText: "Group each document under the policy it belongs to.",
  },

  loan_agreements: {
    noun: "Lender",
    nounPlural: "Lenders",
    nameLabel: "Lender",
    namePlaceholder: "Lender name",
    nicknameLabel: "Product",
    nicknamePlaceholder: "Product (optional)",
    helpText: "Group each agreement under its lender.",
  },

  payoff_letters: {
    noun: "Lender",
    nounPlural: "Lenders",
    nameLabel: "Lender",
    namePlaceholder: "Lender name",
    helpText: "Group each letter under its lender.",
  },

  /** Periodic financials — the axis is the period they cover. */
  profit_loss: {
    noun: "Period",
    nounPlural: "Periods",
    nameLabel: "Period",
    namePlaceholder: "Period (e.g. 2025 or FY2024)",
    newestFirst: true,
    helpText: "Group each statement under the period it covers.",
  },

  balance_sheets: {
    noun: "Period",
    nounPlural: "Periods",
    nameLabel: "Period",
    namePlaceholder: "Period (e.g. 2025 or FY2024)",
    newestFirst: true,
    helpText: "Group each sheet under the period it covers.",
  },

  mortgage_statement: {
    noun: "Property",
    nounPlural: "Properties",
    nameLabel: "Property",
    namePlaceholder: "Property (e.g. 120 Main St)",
    helpText: "Group each statement under its property.",
  },

  lease_agreement: {
    noun: "Property",
    nounPlural: "Properties",
    nameLabel: "Property",
    namePlaceholder: "Property (e.g. 120 Main St)",
    helpText: "Group each lease under its property.",
  },

  re_schedule: {
    noun: "Property",
    nounPlural: "Properties",
    nameLabel: "Property",
    namePlaceholder: "Property (e.g. 120 Main St)",
    helpText: "Group each schedule under its property.",
  },

  equipment_invoice: {
    noun: "Vendor",
    nounPlural: "Vendors",
    nameLabel: "Vendor",
    namePlaceholder: "Vendor name",
    helpText: "Group each invoice under its vendor.",
  },

  misc_files: {
    noun: "Folder",
    nounPlural: "Folders",
    nameLabel: "Folder name",
    namePlaceholder: "Folder name",
    helpText: "Group loose files into folders.",
  },
};

/**
 * What an unconfigured field gets. Deliberately plain: a name and nothing else
 * is enough to cut a list into sections, which is the whole job.
 */
export const DEFAULT_GROUP_CONFIG: GroupFieldConfig = {
  noun: "Group",
  nounPlural: "Groups",
  nameLabel: "Group name",
  namePlaceholder: "Group name",
  nicknameLabel: "Note",
  nicknamePlaceholder: "Note (optional)",
};

export function getGroupConfig(code: string | null | undefined): GroupFieldConfig {
  if (!code) return DEFAULT_GROUP_CONFIG;
  return GROUP_FIELD_CONFIGS[code] ?? DEFAULT_GROUP_CONFIG;
}

/* ========================================================================== *
 * Which fields offer grouping
 * ========================================================================== */

/**
 * Mirrors `required_documents.is_multiple` as of 2026-08-14.
 *
 * A FALLBACK, not the authority — `offersGrouping` prefers the real value
 * whenever the caller has it. This exists so surfaces that never load
 * is_multiple (the underwriting file reads its doc types from a different
 * query) still show the picker on the fields that need it.
 *
 * Drift here is benign in both directions: the picker appears or doesn't, and
 * the "groups already exist" clause below always wins, so a field someone has
 * actually organised never loses its picker regardless of what this says.
 */
export const MULTI_FILE_DOC_CODES = new Set<string>([
  "8821_4506",
  "balance_sheets",
  BANK_STATEMENTS_DOC_CODE,
  "credit_card_statements",
  "drivers_license",
  "equipment_invoice",
  "insurance_documents",
  "loan_agreements",
  "misc_files",
  "payoff_letters",
  "profit_loss",
  "tax_returns",
  "voided_check",
]);

/**
 * Should this field show the group picker?
 *
 * Grouping is available on EVERY field — nothing here refuses it — but the
 * control only earns its place where files actually pile up. A voided check is
 * one file; putting a "which group?" select above it is friction bought for
 * nothing.
 *
 * Three inputs, in priority order:
 *   1. `groupCount` > 0 — someone has already organised this field. Always show,
 *      whatever the other two say, or their groups become unreachable.
 *   2. `isMultiple` — the authoritative required_documents flag, when the caller
 *      has it.
 *   3. MULTI_FILE_DOC_CODES — the static mirror, for callers that don't.
 */
export function offersGrouping(
  code: string | null | undefined,
  opts?: { isMultiple?: boolean | null; groupCount?: number },
): boolean {
  if (!code) return false;
  if ((opts?.groupCount ?? 0) > 0) return true;
  if (typeof opts?.isMultiple === "boolean") return opts.isMultiple;
  return MULTI_FILE_DOC_CODES.has(code);
}

/* ========================================================================== *
 * Display
 * ========================================================================== */

/**
 * How a group reads on screen: `Chase ••4821 · Payroll`, `2024 · Business`,
 * `John Smith`.
 *
 * The identifier is never dropped when set — it is the discriminator a reviewer
 * scans for, and two accounts at the same bank are otherwise indistinguishable.
 * The nickname is appended, never substituted: two groups nicknamed "Operating"
 * at different banks have to stay tellable apart.
 *
 * `mask` decides `••4821` vs `4821`. Masking reads as "the tail of a number
 * we're not showing you", which is right for an account and wrong for a policy
 * number we're showing in full.
 */
export function formatGroupLabel(group: DocumentGroup): string {
  return `${formatGroupShort(group)}${group.nickname?.trim() ? ` · ${group.nickname.trim()}` : ""}`;
}

/** Short form for tight spaces (badges, file names): `Chase ••4821`. */
export function formatGroupShort(group: DocumentGroup): string {
  const config = getGroupConfig(group.doc_code);
  const name = group.name.trim();
  const identifier = group.identifier?.trim();
  if (!identifier) return name;
  return config.identifier?.mask ? `${name} ••${identifier}` : `${name} ${identifier}`;
}

/**
 * Stable ordering within a field.
 *
 * Deliberately NOT by created_at — the order groups happened to be entered in
 * is meaningless to the reader, and a stable order means the same file looks
 * the same to the advisor who organised it and the underwriter who opens it
 * next week.
 *
 * `numeric` collation so "2024" and "2025" order as numbers rather than
 * strings, and so `••4821` sorts sensibly against `••912`. Period-named fields
 * flip to newest-first via their config.
 */
export function compareGroups(a: DocumentGroup, b: DocumentGroup): number {
  const direction = getGroupConfig(a.doc_code).newestFirst ? -1 : 1;
  const by_name = a.name.localeCompare(b.name, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  if (by_name !== 0) return by_name * direction;
  return (a.identifier ?? "").localeCompare(b.identifier ?? "", undefined, { numeric: true });
}

/** The groups belonging to one field, in display order. */
export function groupsForDocCode(
  groups: DocumentGroup[],
  code: string | null | undefined,
): DocumentGroup[] {
  if (!code) return [];
  return groups.filter((g) => g.doc_code === code).sort(compareGroups);
}

/* ========================================================================== *
 * Cutting a document list into sections
 * ========================================================================== */

/** Minimal document shape this module needs. Every caller's row is a superset. */
export interface GroupableDocument {
  id: string;
  document_group_id?: string | null;
  name?: string | null;
  custom_label?: string | null;
  upload_date?: string | null;
  metadata?: any;
}

export interface DocumentGroupSection<T extends GroupableDocument> {
  /** React key. The group id, or the sentinel below for the catch-all. */
  key: string;
  /** null on the ungrouped section. */
  group: DocumentGroup | null;
  label: string;
  documents: T[];
}

/** Section key for files not filed under any group yet. */
export const UNGROUPED_KEY = "__ungrouped__";
export const UNGROUPED_LABEL = "Ungrouped";

/**
 * Cut a document list into per-group sections.
 *
 * Contract, in order of importance:
 *
 *   1. NOTHING IS EVER DROPPED. Every input document comes out in exactly one
 *      section. A file with no group — which is every file that predates this
 *      feature, including the 124 statements on the O'Rourke file — lands in
 *      the ungrouped section rather than vanishing. Same for a document
 *      pointing at a group that isn't in `groups` (deactivated, or from a
 *      business tab that isn't the active one).
 *   2. The ungrouped section is LAST, and is omitted entirely when empty, so an
 *      already-organised field shows no empty catch-all.
 *   3. Groups with no documents are omitted BY DEFAULT. A group exists to hold
 *      files; an empty one is noise in a review or a lender view.
 *
 *      `includeEmptyGroups` flips that for the management surface
 *      (underwriting), where an invisible group is also an UNDELETABLE one — a
 *      mistyped or test group with nothing filed under it has to be reachable.
 *      Only ACTIVE groups are surfaced when empty; an empty retired one is
 *      genuinely finished with.
 *
 * `groups` must already be filtered to this field (see groupsForDocCode);
 * passing another field's groups would render sections a document can never
 * join.
 */
export function groupDocuments<T extends GroupableDocument>(
  documents: T[],
  groups: DocumentGroup[],
  options?: { includeEmptyGroups?: boolean },
): DocumentGroupSection<T>[] {
  const include_empty = options?.includeEmptyGroups ?? false;
  const by_id = new Map<string, DocumentGroup>(groups.map((g) => [g.id, g]));

  const buckets = new Map<string, T[]>();
  const ungrouped: T[] = [];

  for (const doc of documents) {
    const group_id = doc.document_group_id ?? null;
    // An id we can't resolve is treated as ungrouped rather than as its own
    // orphan section — the reader has no way to act on a group they can't see.
    if (!group_id || !by_id.has(group_id)) {
      ungrouped.push(doc);
      continue;
    }
    const bucket = buckets.get(group_id);
    if (bucket) bucket.push(doc);
    else buckets.set(group_id, [doc]);
  }

  const sections: DocumentGroupSection<T>[] = [];

  for (const group of [...groups].sort(compareGroups)) {
    const docs = buckets.get(group.id) ?? [];
    if (docs.length === 0 && !(include_empty && group.is_active)) continue;
    sections.push({
      key: group.id,
      group,
      label: formatGroupLabel(group),
      documents: sortDocumentsInGroup(docs),
    });
  }

  if (ungrouped.length > 0) {
    sections.push({
      key: UNGROUPED_KEY,
      group: null,
      label: UNGROUPED_LABEL,
      documents: sortDocumentsInGroup(ungrouped),
    });
  }

  return sections;
}

/**
 * Order files inside a section: newest parsed period first, falling back to
 * upload date. See parseDocumentPeriod for why the period is often unknown.
 */
export function sortDocumentsInGroup<T extends GroupableDocument>(documents: T[]): T[] {
  return [...documents].sort((a, b) => {
    const pa = getDocumentPeriod(a);
    const pb = getDocumentPeriod(b);
    if (pa && pb) return pb.sort_key - pa.sort_key;
    // A dated file always outranks an undated one — otherwise a single
    // unparseable name scatters the run it belongs to.
    if (pa) return -1;
    if (pb) return 1;
    const ua = a.upload_date ? Date.parse(a.upload_date) : 0;
    const ub = b.upload_date ? Date.parse(b.upload_date) : 0;
    return ub - ua;
  });
}

/* ========================================================================== *
 * Period parsing — a filename hint, nothing more
 * ========================================================================== */

export interface DocumentPeriod {
  year: number;
  /** 1-12. */
  month: number;
  /** year * 12 + month — comparable, and cheaper than building Dates to sort. */
  sort_key: number;
  /** `Mar 2026`. */
  label: string;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function makePeriod(year: number, month: number): DocumentPeriod | null {
  // Anything outside this window is a false positive — an account number, a
  // dollar amount, a random id suffix — not a document date.
  if (month < 1 || month > 12) return null;
  if (year < 2000 || year > 2100) return null;
  return {
    year,
    month,
    sort_key: year * 12 + month,
    label: `${MONTH_ABBR[month - 1]} ${year}`,
  };
}

/**
 * Best-effort period from the ORIGINAL upload filename.
 *
 * Banks and accounting exports name their files predictably enough to be worth
 * parsing ("20260131-statements-4821.pdf", "Statement_Jan2026.pdf",
 * "P&L 03-2026.pdf"), and the payoff is that a twelve-month run reads in
 * calendar order instead of upload order. It is a display and sort HINT only —
 * nothing is stored, nothing is gated on it, and an unparseable name costs the
 * reader nothing but the date badge.
 *
 * Returns null cheaply and often. That is fine.
 */
export function parseDocumentPeriod(file_name: string | null | undefined): DocumentPeriod | null {
  if (!file_name) return null;
  // Drop the extension so ".pdf" / ".2026" can't be read as a number.
  const stem = file_name.replace(/\.[A-Za-z0-9]{1,5}$/, "");

  // "January 2026", "Jan-2026", "Jan 26" — the named-month forms. Checked first
  // because a spelled month is unambiguous, unlike two bare numbers.
  const named = stem.match(/\b([A-Za-z]{3,9})[\s._-]*(\d{4}|\d{2})\b/);
  if (named) {
    const month = MONTH_NAMES[named[1].toLowerCase()];
    if (month) {
      const raw = named[2];
      const year = raw.length === 2 ? 2000 + Number(raw) : Number(raw);
      const period = makePeriod(year, month);
      if (period) return period;
    }
  }

  // "20260131" / "202601" — leading ISO-ish run. Anchored to a boundary so it
  // can't match the middle of a longer digit blob (a random id suffix).
  const compact = stem.match(/(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])(?:[0-3]\d)?(?:[^0-9]|$)/);
  if (compact) {
    const period = makePeriod(Number(compact[1]), Number(compact[2]));
    if (period) return period;
  }

  // "2026-01", "2026_01"
  const iso = stem.match(/\b(20\d{2})[._-](0[1-9]|1[0-2])\b/);
  if (iso) {
    const period = makePeriod(Number(iso[1]), Number(iso[2]));
    if (period) return period;
  }

  // "01-2026", "1.2026" — month first. Last because it is the most collision-
  // prone shape, and requires a four-digit year to fire at all.
  const month_first = stem.match(/\b(0?[1-9]|1[0-2])[._\/-](20\d{2})\b/);
  if (month_first) {
    const period = makePeriod(Number(month_first[2]), Number(month_first[1]));
    if (period) return period;
  }

  return null;
}

/**
 * The period for an already-stored document.
 *
 * Reads metadata.original_file_name, which the upload paths started recording
 * alongside the bank-statement feature. Rows uploaded BEFORE that kept only the
 * standardized label, so their original name is gone and this returns null for
 * them. That is why the sort falls back to upload_date and why nothing displays
 * the period as authoritative.
 */
export function getDocumentPeriod(doc: GroupableDocument): DocumentPeriod | null {
  const original = doc.metadata?.original_file_name;
  return parseDocumentPeriod(typeof original === "string" ? original : null);
}

/* ========================================================================== *
 * File naming
 * ========================================================================== */

/**
 * The name an organised file is stored and downloaded under.
 *
 * WHY THIS EXISTS: both upload paths write `${doc_label} - ${client_name}` for
 * every file in a category, so 124 statements share one name. Downloading them
 * produces `file.pdf`, `file (1).pdf` … and neither underwriting nor the lender
 * can tell which account or month any of them is. Threading the group (and the
 * period when we can read it) into the label fixes the packet without touching
 * how anything is stored.
 *
 * `Business Bank Statements - Chase ••4821 - Mar 2026 - O'Rourke LLC`
 * `Tax Returns - 2024 - O'Rourke LLC`
 *
 * Falls back cleanly: no group → today's label, unchanged, so ungrouped
 * uploads and single-file fields are completely unaffected.
 */
export function buildGroupedDisplayLabel(params: {
  doc_label: string;
  client_name?: string | null;
  group?: DocumentGroup | null;
  period?: DocumentPeriod | null;
}): string {
  const parts: string[] = [params.doc_label];
  if (params.group) parts.push(formatGroupShort(params.group));
  if (params.period) parts.push(params.period.label);
  if (params.client_name) parts.push(params.client_name);
  // Slashes would be read as path separators by the browser's download handler
  // and by any lender who drops the packet into a folder.
  return parts.join(" - ").replace(/[\\/]+/g, "-");
}

/* ========================================================================== *
 * Validation — shared by the picker and the API
 * ========================================================================== */

export interface GroupInput {
  name?: string | null;
  identifier?: string | null;
  subtype?: string | null;
  nickname?: string | null;
}

/**
 * Validate a group against its field's config. Returns null when valid, or a
 * message written for the person typing.
 *
 * Shared so the picker and the endpoint cannot disagree — a rule enforced only
 * client-side is a rule the API doesn't have, and one enforced only server-side
 * surfaces as a raw constraint string.
 */
export function validateGroupInput(
  code: string | null | undefined,
  input: GroupInput,
): string | null {
  const config = getGroupConfig(code);

  if (!input.name?.trim()) return `${config.nameLabel} is required`;

  const identifier = input.identifier?.trim() ?? "";
  if (config.identifier) {
    if (config.identifier.required && !identifier) {
      return `${config.identifier.label} is required`;
    }
    if (identifier && config.identifier.pattern) {
      if (!new RegExp(config.identifier.pattern).test(identifier)) {
        return config.identifier.patternError ?? `${config.identifier.label} is not valid`;
      }
    }
    if (identifier && config.identifier.maxLength && identifier.length > config.identifier.maxLength) {
      return `${config.identifier.label} is too long`;
    }
  } else if (identifier) {
    // A field with no identifier configured must not quietly store one — it
    // would render in labels the config has no vocabulary to explain.
    return `${config.noun} does not take an identifier`;
  }

  const subtype = input.subtype?.trim();
  if (subtype) {
    if (!config.subtypes?.some((s) => s.value === subtype)) {
      return `Invalid ${config.subtypeLabel?.toLowerCase() ?? "type"}`;
    }
  }

  return null;
}
