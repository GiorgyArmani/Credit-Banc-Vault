/**
 * Document scope — distinguishes "personal-identity" docs (one per human,
 * shared across every business the client owns) from "business-scoped" docs
 * (collected per business).
 *
 * Why: a prospect with two businesses still has one driver's license, one
 * credit report, one personal financial statement. Forcing them to re-upload
 * those for each business creates duplicate work and confuses the advisor's
 * view (the same physical doc shows as missing on one tab and present on
 * another). Codes listed here render on every business tab and the
 * requirements API surfaces them regardless of which business is active.
 *
 * Server + client both import this — single source of truth.
 */
export const CLIENT_SCOPED_DOC_CODES = [
  "drivers_license",
  "pfs",
  "myscoreiq",
] as const;

export type ClientScopedDocCode = (typeof CLIENT_SCOPED_DOC_CODES)[number];

/**
 * Documents that survive a new funding round.
 *
 * When a client comes back for a second or third financing, the paperwork
 * splits in two: things that describe who they are and what the entity is
 * (unchanged since last time), and things that describe how the business is
 * doing right now (stale the moment the last deal closed — a lender will not
 * accept 14-month-old bank statements).
 *
 * Codes listed here carry forward: their files and approvals stay unscoped
 * (funding_deal_id NULL = "belongs to every round"). Everything else is stamped
 * with the closing round's id when the next round opens, which retires it from
 * the active view and puts the category back on the request list.
 *
 * The client-scoped codes (DL / PFS / MyScoreIQ) are already global to the
 * person; they're repeated here so the intent reads in one place.
 */
export const DEAL_CARRY_OVER_DOC_CODES = [
  "drivers_license",
  "drivers_license_front",
  "drivers_license_back",
  "pfs",
  "myscoreiq",
  "voided_check",
  "articles_of_incorporation",
  "operating_agreement_bylaws",
] as const;

const _carry_over: Set<string> = new Set(DEAL_CARRY_OVER_DOC_CODES);

/** True when this document type carries forward into a new funding round. */
export function isCarryOverDoc(code: string | null | undefined): boolean {
  if (!code) return false;
  return _carry_over.has(code);
}

/**
 * Bank-statement period configuration.
 *
 * Bank statements are the one document whose required quantity changes per deal
 * (most products need 12 months; some 6 or 24). The month count lives on each
 * client_dynamic_documents row (statement_months) rather than the shared
 * required_documents.label, so two deals can ask the same client for different
 * periods. Advisors pick from a fixed set; 12 is the default since most products
 * require it.
 */
export const BANK_STATEMENTS_DOC_CODE = "business_bank_statements";
export const BANK_STATEMENT_MONTH_OPTIONS = [3, 6, 12, 24] as const;
export const DEFAULT_BANK_STATEMENT_MONTHS = 12;

/**
 * formatRequirementLabel — single source of truth for the label a client sees.
 * For bank statements with a per-request month count, strips any "(last N
 * months)" baked into the static label and appends the precise requested
 * period. Every other doc (or a null month count) returns the base label
 * unchanged, so existing requests are unaffected.
 */
export function formatRequirementLabel(
  code: string | null | undefined,
  baseLabel: string,
  statementMonths?: number | null,
): string {
  if (
    code === BANK_STATEMENTS_DOC_CODE &&
    typeof statementMonths === "number" &&
    statementMonths > 0
  ) {
    const stripped = baseLabel.replace(/\s*\((?:last\s+)?\d+\s*months?\)\s*$/i, "").trim();
    return `${stripped} (last ${statementMonths} months)`;
  }
  return baseLabel;
}

const _set: Set<string> = new Set(CLIENT_SCOPED_DOC_CODES);

/** True when the given doc code identifies the client/owner, not a business. */
export function isClientScopedDoc(code: string | null | undefined): boolean {
  if (!code) return false;
  return _set.has(code);
}

/**
 * matchesActiveBusiness — single shared predicate for "does this row belong
 * to the active business tab?". A row belongs when:
 *   • its doc code is client-scoped (DL / MyScoreIQ / PFS) — those describe
 *     the human and surface on every business tab regardless of where they
 *     were uploaded, OR
 *   • its business_profile_id exactly matches the active tab's id.
 *
 * Pass `null` for activeBusinessId during initial load — nothing non-client-
 * scoped matches, which renders an empty list briefly until the active tab
 * resolves.
 *
 * Previously duplicated as matchesActiveBusiness / matchesActiveBusinessUW
 * in the advisor & UW client-detail pages, and inlined in vault.tsx. One
 * implementation prevents drift (the kind of drift that caused docs to be
 * filtered out on one dashboard but not another).
 */
export function matchesActiveBusiness(
  rowBusinessProfileId: string | null | undefined,
  activeBusinessId: string | null | undefined,
  docCode?: string | null,
): boolean {
  if (isClientScopedDoc(docCode)) return true;
  if (!activeBusinessId) return false;
  return rowBusinessProfileId === activeBusinessId;
}

/**
 * matchesActiveDeal — the funding-round half of row scoping, and the companion
 * to matchesActiveBusiness above. A row belongs to the round on screen when:
 *   • it carries no funding_deal_id — either legacy data (every row predates
 *     rounds) or a document deliberately left unscoped because it carries
 *     across rounds, OR
 *   • its funding_deal_id is the active round.
 *
 * A row stamped with an OLDER round's id is retired: it stays in the database
 * as that round's record but drops out of the working view, which is what makes
 * "re-request the stale documents" mean something on a repeat deal.
 *
 * Pass `null` for activeDealId when the caller has no round context — nothing
 * is hidden in that case, so a surface that hasn't been taught about rounds
 * behaves exactly as it did before.
 */
export function matchesActiveDeal(
  rowFundingDealId: string | null | undefined,
  activeDealId: string | null | undefined,
): boolean {
  if (!rowFundingDealId) return true;
  if (!activeDealId) return true;
  return rowFundingDealId === activeDealId;
}

/**
 * normalizeSupabaseJoin — Supabase's PostgREST client returns embedded
 * relations as either a single object or a single-element array depending
 * on the SDK version, the typegen output, and how the FK is declared.
 * Spreading `...row.required_documents` on an array gives `{0: {…}}`
 * instead of `{code, label}` — every downstream filter then fails silently.
 *
 * Use this helper anywhere a `*_documents (col, col)` or similar embed is
 * read. The shape is single-row in every codepath we use, so collapsing the
 * array form to its first element is always correct.
 */
export function normalizeSupabaseJoin<T = any>(raw: T | T[] | null | undefined): T | null {
  if (raw == null) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}
