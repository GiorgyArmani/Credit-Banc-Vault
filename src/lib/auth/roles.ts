// The role model, in one place. Client-safe: no crypto, no service-role client,
// no secrets — this is imported by browser components as well as server code.
//
// Eight roles. See [[role_model]]. Never reference a role string that isn't here;
// the database CHECK constraint on users.role rejects anything else, and a typo'd
// role in a comparison fails SILENTLY (the user simply never matches).
//
//   admin            full access
//   underwriting     the UW desk
//   advisor          internal staff working deals
//   setter           appointment setters, create-only fast funding
//   partner_advisor  an EXTERNAL referral partner working their own deals
//   referral_partner an external partner, read-only referral portal
//   affiliate        public affiliate program
//   free             clients
//
// partner_advisor is the one that needs care. They are external people — CPAs and
// bankers — who do the advisor JOB on files they own or follow. They count as
// staff for the deal-working surfaces and NOT as staff for anything internal.
// That distinction is the STAFF_ROLES / INTERNAL_STAFF_ROLES split below; it is
// the only mechanism, so use it rather than adding a second one.

export const ALL_ROLES = [
  "admin",
  "underwriting",
  "advisor",
  "setter",
  "partner_advisor",
  "referral_partner",
  "affiliate",
  "free",
] as const;

export type UserRole = (typeof ALL_ROLES)[number];

export function isUserRole(v: unknown): v is UserRole {
  return typeof v === "string" && (ALL_ROLES as readonly string[]).includes(v);
}

/**
 * May use the advisor workspace — the dashboard, pipeline, prospects, client
 * list and client file. Mirrors the database: these are exactly the roles for
 * which `is_advisor_user()` is true, plus admin (who passes via
 * `is_admin_user()`).
 *
 * Access is still bounded per-file by `is_assigned_advisor_for()` in RLS, so
 * membership here grants the SURFACE, never the data.
 */
export const ADVISOR_WORKSPACE_ROLES = ["advisor", "partner_advisor", "admin"] as const;

/**
 * Allowed to act on a deal: move the pipeline, write status history, generate
 * notifications. Includes partner_advisor — they do the advisor job.
 *
 * Kept in sync with the database's `is_staff_user()`, with one known difference:
 * the SQL helper excludes 'setter' (pre-existing, out of scope). If you change
 * one, check the other.
 */
export const STAFF_ROLES = [
  "admin",
  "underwriting",
  "advisor",
  "setter",
  "partner_advisor",
] as const;

/**
 * Allowed to record the `funded` pipeline transition. Narrower than STAFF_ROLES
 * because this transition pays real money downstream — it queues the affiliate's
 * gift card and writes a partner commission row — so setters are excluded.
 *
 * partner_advisor IS included, for parity with an advisor. Know what that means:
 * a partner marking their own deal funded self-initiates their own commission.
 * That row lands `status: 'pending'` and releasing it stays an admin action, so
 * the approval gate is downstream rather than here.
 *
 * THIS LIST IS LOAD-BEARING IN TWO PLACES AND THEY MUST NOT DRIFT: the pipeline
 * gate that decides who may record `funded`, and the affiliate payout path that
 * re-verifies "a staff member recorded this" before spending. When those two
 * disagreed, a partner_advisor could fund a deal that then silently never paid
 * the affiliate — no payout row, no admin surface, just a console warning. Use
 * canRecordFunded() in both rather than re-listing the roles.
 */
export const FUNDED_ROLES = ["admin", "underwriting", "advisor", "partner_advisor"] as const;

export function canRecordFunded(role: string | null | undefined): boolean {
  return !!role && (FUNDED_ROLES as readonly string[]).includes(role);
}

/**
 * Internal employees only. The complement of STAFF_ROLES that keeps external
 * partners out of surfaces that expose OTHER people's business: the affiliate
 * lead queue, the staff directory, lender guidelines, admin leaderboards,
 * cross-client reporting.
 *
 * When you reach for a role check, ask which of these two lists you mean. "Can
 * they work this deal?" is STAFF_ROLES. "Should they see how the company runs?"
 * is INTERNAL_STAFF_ROLES.
 */
export const INTERNAL_STAFF_ROLES = ["admin", "underwriting", "advisor", "setter"] as const;

/**
 * Admitted by the per-client API routes under /api/advisor/clients/**. Wider than
 * ADVISOR_WORKSPACE_ROLES because underwriting works every file through the same
 * endpoints.
 *
 * Passing this list is NOT authorization — admin and underwriting work every
 * file, while advisor and partner_advisor must additionally clear the
 * owner/follower check. Use isScopedAdvisorRole() for that second half.
 */
export const CLIENT_API_ROLES = [
  "admin",
  "advisor",
  "underwriting",
  "partner_advisor",
] as const;

/**
 * Advisor-shaped callers: bounded to the files they own or follow. Both the
 * staff advisor and the external partner advisor are scoped this way — admin and
 * underwriting are not.
 *
 * Anywhere you find a bare `role === "advisor"` guarding an ownership check,
 * this is what it should have been.
 */
export function isScopedAdvisorRole(role: string | null | undefined): boolean {
  return role === "advisor" || role === "partner_advisor";
}

export function canUseAdvisorWorkspace(role: string | null | undefined): boolean {
  return !!role && (ADVISOR_WORKSPACE_ROLES as readonly string[]).includes(role);
}

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

export function isInternalStaffRole(role: string | null | undefined): boolean {
  return !!role && (INTERNAL_STAFF_ROLES as readonly string[]).includes(role);
}

/**
 * An advisor who is not one of ours. Drives which portal they land in, which
 * pickers hide them, and whether the stale-file cron may take their deal.
 *
 * Note this is the ROLE test. The durable marker is
 * `advisors.referral_partner_id IS NOT NULL` — prefer that when you are already
 * querying the advisors table, because it survives a role flip and is what the
 * SQL-side exclusions filter on.
 */
export function isExternalAdvisor(role: string | null | undefined): boolean {
  return role === "partner_advisor";
}

/** Human-readable role names for staff-facing lists (/admin/team). */
export const ROLE_DISPLAY_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  underwriting: "Underwriting",
  advisor: "Advisor",
  setter: "Appointment Setter",
  partner_advisor: "Partner Advisor",
  referral_partner: "Referral Partner",
  affiliate: "Affiliate",
  free: "Client",
};
