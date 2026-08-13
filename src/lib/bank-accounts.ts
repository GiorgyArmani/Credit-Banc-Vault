/**
 * Bank accounts — the grouping axis for bank statements.
 *
 * A funded file routinely carries four accounts × twelve months of statements.
 * Rendered flat, that is one category card with 48+ identical-looking rows
 * (the O'Rourke file has 124), which is unreadable for underwriting and
 * useless to the lender receiving the packet.
 *
 * `bank_accounts` (migration 20260813) gives each business a small set of named
 * accounts, and `user_documents.bank_account_id` points each statement at one.
 * Everything in this module is the read side of that FK: how an account is
 * spelled on screen, how a document list is cut into per-account sections, and
 * what an organised statement is named when it is downloaded.
 *
 * Server + client both import this — single source of truth, same contract as
 * @/lib/document-scope, which owns the business / funding-round axes. The three
 * axes compose: a document belongs to a business, to a funding round, and
 * (if it is a statement) to an account.
 */

import { BANK_STATEMENTS_DOC_CODE } from "./document-scope";

/** Account kinds UW distinguishes. Mirrors the CHECK on bank_accounts.account_type. */
export const BANK_ACCOUNT_TYPES = ["checking", "savings", "merchant", "other"] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const BANK_ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  merchant: "Merchant",
  other: "Other",
};

export interface BankAccount {
  id: string;
  business_profile_id: string;
  bank_name: string;
  /** Exactly four digits. The full number is never stored — see the migration. */
  account_last4: string;
  account_type: BankAccountType;
  nickname: string | null;
  is_active: boolean;
  created_at?: string;
  created_by_role?: string | null;
}

/**
 * Document codes that carry an account.
 *
 * Only bank statements today. The column is not restricted at the database
 * level, so adding `credit_card_statements` here is the entire change needed to
 * extend grouping to card statements later — no migration.
 */
export const ACCOUNT_SCOPED_DOC_CODES = [BANK_STATEMENTS_DOC_CODE] as const;

const _account_scoped: Set<string> = new Set(ACCOUNT_SCOPED_DOC_CODES);

/** True when this document type is organised by bank account. */
export function isAccountScopedDoc(code: string | null | undefined): boolean {
  if (!code) return false;
  return _account_scoped.has(code);
}

/**
 * How an account reads on screen: `Chase ••4821 · Payroll`.
 *
 * The bullet-prefixed last four is the discriminator UW scans for, so it is
 * never dropped. The nickname is appended only when set, and never replaces the
 * bank + digits — two accounts nicknamed "Operating" at different banks have to
 * stay distinguishable.
 */
export function formatBankAccountLabel(account: BankAccount): string {
  const base = `${account.bank_name.trim()} ••${account.account_last4}`;
  const nickname = account.nickname?.trim();
  return nickname ? `${base} · ${nickname}` : base;
}

/** Short form for tight spaces (badges, file names): `Chase ••4821`. */
export function formatBankAccountShort(account: BankAccount): string {
  return `${account.bank_name.trim()} ••${account.account_last4}`;
}

/**
 * Stable ordering: bank name, then last four. Deliberately NOT by created_at —
 * the order accounts happened to be entered in is meaningless to the reader,
 * and a stable alphabetical order means the same file looks the same to the
 * advisor who organised it and the underwriter who opens it next week.
 */
export function compareBankAccounts(a: BankAccount, b: BankAccount): number {
  return (
    a.bank_name.localeCompare(b.bank_name, undefined, { sensitivity: "base" }) ||
    a.account_last4.localeCompare(b.account_last4)
  );
}

/** Minimal document shape this module needs. Every caller's row is a superset. */
export interface AccountGroupableDocument {
  id: string;
  bank_account_id?: string | null;
  name?: string | null;
  custom_label?: string | null;
  upload_date?: string | null;
  metadata?: any;
}

export interface BankAccountGroup<T extends AccountGroupableDocument> {
  /** React key. The account id, or the sentinel below for the catch-all group. */
  key: string;
  /** null on the unassigned group. */
  account: BankAccount | null;
  label: string;
  documents: T[];
}

/** Group key for statements that have no account yet. */
export const UNASSIGNED_ACCOUNT_KEY = "__unassigned__";
export const UNASSIGNED_ACCOUNT_LABEL = "Unassigned";

/**
 * Cut a document list into per-account sections.
 *
 * Contract, in order of importance:
 *
 *   1. NOTHING IS EVER DROPPED. Every input document comes out in exactly one
 *      group. A statement with no account — which is every statement that
 *      predates this feature, including the 124 already on the O'Rourke file —
 *      lands in the unassigned group rather than vanishing. Same for a document
 *      pointing at an account that isn't in `accounts` (deactivated, or from a
 *      business tab that isn't the active one).
 *   2. The unassigned group is LAST, and is omitted entirely when empty, so an
 *      already-organised file shows no empty catch-all.
 *   3. Accounts with no documents are omitted BY DEFAULT. An account exists to
 *      hold files; an empty one is noise in a review or lender view.
 *
 *      `includeEmptyAccounts` flips that for the management surface
 *      (underwriting), where an invisible account is also an UNDELETABLE one —
 *      a mistyped or test account with nothing filed under it has to be
 *      reachable. Only ACTIVE accounts are surfaced when empty; an empty
 *      retired one is genuinely finished with.
 */
export function groupDocumentsByBankAccount<T extends AccountGroupableDocument>(
  documents: T[],
  accounts: BankAccount[],
  options?: { includeEmptyAccounts?: boolean },
): BankAccountGroup<T>[] {
  const include_empty = options?.includeEmptyAccounts ?? false;
  const by_id = new Map<string, BankAccount>(accounts.map((a) => [a.id, a]));

  const buckets = new Map<string, T[]>();
  const unassigned: T[] = [];

  for (const doc of documents) {
    const account_id = doc.bank_account_id ?? null;
    // An id we can't resolve is treated as unassigned rather than as its own
    // orphan group — the reader has no way to act on an account they can't see.
    if (!account_id || !by_id.has(account_id)) {
      unassigned.push(doc);
      continue;
    }
    const bucket = buckets.get(account_id);
    if (bucket) bucket.push(doc);
    else buckets.set(account_id, [doc]);
  }

  const groups: BankAccountGroup<T>[] = [];

  for (const account of [...accounts].sort(compareBankAccounts)) {
    const docs = buckets.get(account.id) ?? [];
    if (docs.length === 0 && !(include_empty && account.is_active)) continue;
    groups.push({
      key: account.id,
      account,
      label: formatBankAccountLabel(account),
      documents: sortStatements(docs),
    });
  }

  if (unassigned.length > 0) {
    groups.push({
      key: UNASSIGNED_ACCOUNT_KEY,
      account: null,
      label: UNASSIGNED_ACCOUNT_LABEL,
      documents: sortStatements(unassigned),
    });
  }

  return groups;
}

/**
 * Order statements inside a group: newest statement period first, falling back
 * to upload date. See parseStatementPeriod for why the period is often unknown.
 */
export function sortStatements<T extends AccountGroupableDocument>(documents: T[]): T[] {
  return [...documents].sort((a, b) => {
    const pa = getDocumentStatementPeriod(a);
    const pb = getDocumentStatementPeriod(b);
    if (pa && pb) return pb.sort_key - pa.sort_key;
    // A dated statement always outranks an undated one — otherwise a single
    // unparseable file scatters the run it belongs to.
    if (pa) return -1;
    if (pb) return 1;
    const ua = a.upload_date ? Date.parse(a.upload_date) : 0;
    const ub = b.upload_date ? Date.parse(b.upload_date) : 0;
    return ub - ua;
  });
}

export interface StatementPeriod {
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

function makePeriod(year: number, month: number): StatementPeriod | null {
  // Anything outside this window is a false positive — an account number, a
  // dollar amount, a random id suffix — not a statement date.
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
 * Best-effort statement period from the ORIGINAL upload filename.
 *
 * Banks name their exports predictably enough to be worth parsing
 * ("20260131-statements-4821.pdf", "Statement_Jan2026.pdf", "03-2026.pdf"), and
 * the payoff is that a 12-month run reads in calendar order instead of upload
 * order. It is a display and sort HINT only — nothing is stored, nothing is
 * gated on it, and an unparseable name costs the reader nothing but the date
 * badge.
 *
 * Returns null cheaply and often. That is fine.
 */
export function parseStatementPeriod(file_name: string | null | undefined): StatementPeriod | null {
  if (!file_name) return null;
  // Drop the extension so ".pdf" / ".2026" can't be read as a number.
  const stem = file_name.replace(/\.[A-Za-z0-9]{1,5}$/, "");

  // "January 2026", "Jan-2026", "Jan 26" — the named-month forms. Checked first
  // because a spelled month is unambiguous, unlike two bare numbers.
  const named = stem.match(
    /\b([A-Za-z]{3,9})[\s._-]*(\d{4}|\d{2})\b/,
  );
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
 * alongside this feature. Rows uploaded BEFORE that — every statement currently
 * on file — kept only the standardized label, so their original name is gone
 * and this returns null for them. That is why the sort falls back to
 * upload_date and why nothing displays the period as authoritative.
 */
export function getDocumentStatementPeriod(
  doc: AccountGroupableDocument,
): StatementPeriod | null {
  const original = doc.metadata?.original_file_name;
  return parseStatementPeriod(typeof original === "string" ? original : null);
}

/**
 * The name an organised statement is stored and downloaded under.
 *
 * WHY THIS EXISTS: both upload paths write `${doc_label} - ${client_name}` for
 * every file in a category, so 124 statements share one name. Downloading them
 * produces `file.pdf`, `file (1).pdf` … and neither UW nor the lender can tell
 * which account or month any of them is. Threading the account (and the period
 * when we can read it) into the label fixes the packet without touching how
 * anything is stored.
 *
 * `Business Bank Statements - Chase ••4821 - Mar 2026 - O'Rourke LLC`
 *
 * Falls back cleanly: no account → today's label, unchanged, so non-statement
 * documents and unorganised uploads are completely unaffected.
 */
export function buildStatementDisplayLabel(params: {
  doc_label: string;
  client_name?: string | null;
  account?: BankAccount | null;
  period?: StatementPeriod | null;
}): string {
  const parts: string[] = [params.doc_label];
  if (params.account) parts.push(formatBankAccountShort(params.account));
  if (params.period) parts.push(params.period.label);
  if (params.client_name) parts.push(params.client_name);
  // Slashes would be read as path separators by the browser's download handler
  // and by any lender who drops the packet into a folder.
  return parts.join(" - ").replace(/[\\/]+/g, "-");
}
