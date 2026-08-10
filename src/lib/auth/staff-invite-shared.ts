// Client-safe half of the staff-invitation module: role names, labels, routes
// and the state derivation. No crypto, no service-role client, no secrets.
//
// This split exists because the admin UI is a client component and needs the
// role list and labels. Importing them from staff-invite.ts would drag
// node:crypto and createAdminClient() into the browser bundle — which is either
// a build error or, worse, not one.

export const INVITABLE_ROLES = ["advisor", "underwriting", "setter"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(v: unknown): v is InvitableRole {
  return typeof v === "string" && (INVITABLE_ROLES as readonly string[]).includes(v);
}

/** Where each role's onboarding form lives. */
export const SIGNUP_PATH_BY_ROLE: Record<InvitableRole, string> = {
  advisor: "/auth/advisor-signup",
  underwriting: "/auth/underwriting-signup",
  setter: "/auth/setter-signup",
};

export const ROLE_LABEL: Record<InvitableRole, string> = {
  advisor: "Advisor",
  underwriting: "Underwriting",
  setter: "Appointment Setter",
};

/** Default lifetime of an invitation link. Long enough for a new hire to get to
 *  it, short enough that a link forwarded to the wrong inbox goes dead fast.
 *  Resending is one click and mints a fresh token. */
export const INVITE_TTL_DAYS = 7;

export type InviteState = "pending" | "accepted" | "revoked" | "expired";

export function inviteState(row: {
  accepted_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}): InviteState {
  if (row.accepted_at) return "accepted";
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= Date.now()) return "expired";
  return "pending";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && EMAIL_RE.test(v.trim());
}
