/**
 * Underwriter lead groups — criteria vocabulary, validation, and resolution.
 *
 * A group is BOTH a saved filter and a hand-picked list:
 *
 *     members = matches(criteria) ∪ pins − excludes
 *
 * Underwriters use both models ("everything over $200k with unreviewed docs"
 * and "these four files I'm chasing today"), and supporting only one would have
 * forced a second feature later.
 *
 * WHY THIS RUNS IN THE BROWSER. The UW dashboard already loads every vault
 * unfiltered (~181 rows in prod) and computes doc counts and pipeline stage in
 * memory. Two of the most useful criteria — doc completeness and stage — live
 * in other tables, so pushing this into SQL would mean a view or an RPC to buy
 * nothing at this size. Everything below is pure and synchronous. If the vault
 * count ever makes that untrue, the criteria shape translates to SQL directly:
 * every field is a column or a count, none is a computed expression over the
 * whole set.
 *
 * The zod schema is the only writer-side guard — the `criteria` column is jsonb
 * with no CHECK constraint, deliberately, so growing the vocabulary is a code
 * change rather than a migration. See supabase/migrations/20260909_2_uw_lead_groups.sql.
 */

import { z } from "zod";
import type { LoanStatus } from "@/app/actions/pipeline";

/** The four tabs the UW dashboard buckets every file into. */
export const LEAD_BUCKETS = ["ready", "active", "funded", "declined"] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];

/**
 * The shape the dashboard reduces each vault to before any group logic runs.
 * Everything here is either already on client_data_vault or already computed
 * by the page's existing fetch — adding a field to this interface must not add
 * a query.
 */
export interface GroupableLead {
  id: string;
  bucket: LeadBucket;
  pipeline_status?: LoanStatus;
  advisor_id: string | null;
  capital_requested: number;
  /** Document codes approved in document_category_approvals. */
  docs_approved: number;
  /** Document codes required, i.e. rows in client_dynamic_documents. */
  docs_total: number;
  /** Uploaded but not yet approved. The queue's real backlog. */
  docs_awaiting_review: number;
  age_days: number;
  company_state?: string | null;
  credit_score?: string | null;
  client_name: string;
  client_email: string;
  company_name: string;
  advisor_name: string;
}

export interface GroupCriteria {
  buckets?: LeadBucket[];
  stages?: LoanStatus[];
  advisorIds?: string[];
  askMin?: number;
  askMax?: number;
  docsApprovedPctMin?: number;
  docsApprovedPctMax?: number;
  awaitingReviewMin?: number;
  ageDaysMin?: number;
  ageDaysMax?: number;
  states?: string[];
  creditScore?: string[];
  search?: string;
}

export type MembershipMode = "pin" | "exclude";

export interface GroupMembership {
  client_vault_id: string;
  mode: MembershipMode;
}

export interface LeadGroup {
  id: string;
  owner_id: string;
  name: string;
  criteria: GroupCriteria;
  is_shared: boolean;
  updated_at?: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const percent = z.number().int().min(0).max(100);
const money = z.number().min(0);
const days = z.number().int().min(0);

/**
 * `.strip()` (zod's default for objects) rather than `.passthrough()`: whatever
 * this accepts is stored verbatim in jsonb and read back by the predicate, so
 * an unknown key would be dead weight that looks like a rule.
 */
const baseCriteria = z.object({
  buckets: z.array(z.enum(LEAD_BUCKETS)).optional(),
  stages: z.array(z.string()).optional(),
  advisorIds: z.array(z.string().uuid()).optional(),
  askMin: money.optional(),
  askMax: money.optional(),
  docsApprovedPctMin: percent.optional(),
  docsApprovedPctMax: percent.optional(),
  awaitingReviewMin: z.number().int().min(0).optional(),
  ageDaysMin: days.optional(),
  ageDaysMax: days.optional(),
  states: z.array(z.string()).optional(),
  creditScore: z.array(z.string()).optional(),
  search: z.string().max(200).optional(),
});

/**
 * Inverted bounds are rejected rather than normalized. A group whose rule can
 * never match renders as a chip with a permanent zero and no explanation; far
 * better to refuse it at the point someone typed it.
 */
function rangeIsOrdered(min: number | undefined, max: number | undefined): boolean {
  return min === undefined || max === undefined || min <= max;
}

export const groupCriteriaSchema = baseCriteria
  .refine(c => rangeIsOrdered(c.askMin, c.askMax), {
    message: "Minimum ask cannot exceed maximum ask",
    path: ["askMin"],
  })
  .refine(c => rangeIsOrdered(c.docsApprovedPctMin, c.docsApprovedPctMax), {
    message: "Minimum approved percentage cannot exceed maximum",
    path: ["docsApprovedPctMin"],
  })
  .refine(c => rangeIsOrdered(c.ageDaysMin, c.ageDaysMax), {
    message: "Minimum age cannot exceed maximum age",
    path: ["ageDaysMin"],
  }) as unknown as z.ZodType<GroupCriteria, z.ZodTypeDef, unknown>;

// ─── Emptiness ───────────────────────────────────────────────────────────────

/**
 * THE LOAD-BEARING RULE: empty criteria match NOTHING.
 *
 * An empty rule set means "no rule", not "everything". That is what lets a
 * hand-picked list be `{}` plus its pins. Get this backwards and every new
 * group silently contains the entire book on the first render.
 *
 * Empty arrays and whitespace-only search count as absent, because that is what
 * the editor emits when every control is cleared — clearing the form must not
 * flip a group from "no auto members" to "all of them".
 *
 * Numbers are checked with `!== undefined`, never truthiness: 0 is a real bound,
 * and `docsApprovedPctMax: 0` ("nothing approved yet") is the single most useful
 * group on the board.
 */
export function isEmptyCriteria(criteria: GroupCriteria | null | undefined): boolean {
  if (!criteria) return true;
  const {
    buckets, stages, advisorIds, states, creditScore,
    askMin, askMax, docsApprovedPctMin, docsApprovedPctMax,
    awaitingReviewMin, ageDaysMin, ageDaysMax, search,
  } = criteria;

  const hasList = [buckets, stages, advisorIds, states, creditScore].some(
    list => Array.isArray(list) && list.length > 0
  );
  const hasBound = [
    askMin, askMax, docsApprovedPctMin, docsApprovedPctMax,
    awaitingReviewMin, ageDaysMin, ageDaysMax,
  ].some(n => n !== undefined && n !== null);
  const hasSearch = typeof search === "string" && search.trim() !== "";

  return !hasList && !hasBound && !hasSearch;
}

// ─── Matching ────────────────────────────────────────────────────────────────

function inList(value: string | null | undefined, list: string[] | undefined): boolean {
  if (!list || list.length === 0) return true;
  if (!value) return false;
  const needle = value.trim().toLowerCase();
  return list.some(entry => entry.trim().toLowerCase() === needle);
}

function withinRange(value: number, min?: number, max?: number): boolean {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/**
 * Every present clause is ANDed. Absent clauses do not constrain.
 *
 * Returns false for empty criteria — see isEmptyCriteria.
 */
export function matchesCriteria(lead: GroupableLead, criteria: GroupCriteria): boolean {
  if (isEmptyCriteria(criteria)) return false;

  if (criteria.buckets?.length && !criteria.buckets.includes(lead.bucket)) return false;

  if (criteria.stages?.length) {
    if (!lead.pipeline_status) return false;
    if (!criteria.stages.includes(lead.pipeline_status)) return false;
  }

  if (criteria.advisorIds?.length) {
    if (!lead.advisor_id) return false;
    if (!criteria.advisorIds.includes(lead.advisor_id)) return false;
  }

  if (!withinRange(lead.capital_requested ?? 0, criteria.askMin, criteria.askMax)) return false;
  if (!withinRange(lead.age_days ?? 0, criteria.ageDaysMin, criteria.ageDaysMax)) return false;

  if (criteria.docsApprovedPctMin !== undefined || criteria.docsApprovedPctMax !== undefined) {
    // A vault whose documents were never seeded is 0-of-0. Calling that 0%
    // would flood "under 50% approved" with files nobody has asked anything of
    // yet, burying the ones actually stalled. No requirements, no doc rule.
    if (!lead.docs_total) return false;
    const pct = (lead.docs_approved / lead.docs_total) * 100;
    if (!withinRange(pct, criteria.docsApprovedPctMin, criteria.docsApprovedPctMax)) return false;
  }

  if (criteria.awaitingReviewMin !== undefined) {
    if ((lead.docs_awaiting_review ?? 0) < criteria.awaitingReviewMin) return false;
  }

  if (!inList(lead.company_state, criteria.states)) return false;
  if (!inList(lead.credit_score, criteria.creditScore)) return false;

  const search = criteria.search?.trim().toLowerCase();
  if (search) {
    const haystack = [
      lead.company_name, lead.client_name, lead.client_email, lead.advisor_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(search)) return false;
  }

  return true;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * `matches(criteria) ∪ pins − excludes`, preserving the caller's ordering.
 *
 * Order is preserved because the caller hands in whatever the active sort
 * produced; re-sorting here would quietly override the column the user clicked.
 *
 * Memberships naming a vault that is not in `leads` are ignored — a pinned file
 * can fall out of the dashboard's own fetch, and it must not materialize as a
 * phantom row.
 */
export function resolveGroupMembers(
  leads: GroupableLead[],
  criteria: GroupCriteria,
  memberships: GroupMembership[]
): GroupableLead[] {
  const pinned = new Set<string>();
  const excluded = new Set<string>();

  for (const m of memberships) {
    if (m.mode === "exclude") excluded.add(m.client_vault_id);
    else pinned.add(m.client_vault_id);
  }

  return leads.filter(lead => {
    // Exclude wins. The composite primary key makes a pin+exclude pair
    // unreachable through the app, but resolution stays total rather than
    // depending on which row was read first.
    if (excluded.has(lead.id)) return false;
    if (pinned.has(lead.id)) return true;
    return matchesCriteria(lead, criteria);
  });
}

/** Chip counts. Same resolution, without materializing the rows. */
export function countGroupMembers(
  leads: GroupableLead[],
  criteria: GroupCriteria,
  memberships: GroupMembership[]
): number {
  return resolveGroupMembers(leads, criteria, memberships).length;
}
