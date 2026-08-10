// Staff invitations — per-person, single-use, expiring tokens.
//
// Replaces the shared STAFF_SIGNUP_INVITE_CODE env secret that used to gate
// advisor / underwriting / setter self-signup. That code never expired, wasn't
// tied to anyone, and left no trace of who admitted whom; this does all three.
//
// The raw token exists in exactly two places: the URL in the invitation email,
// and the query string of the page the invitee lands on. What we STORE is its
// SHA-256. That's why "resend" mints a new token instead of re-sending the old
// one — we genuinely cannot reproduce it.
//
// The gate stays SERVER-SIDE for the same reason it always was: /api/post-signup-*
// can be POSTed directly, so a form field alone is not a gate. See
// [[staff_signup_invite_gate]] and migration 20260810_staff_invitations.sql.

// SERVER ONLY. The role list, labels and state helper live in
// ./staff-invite-shared so the admin UI can import them without dragging
// node:crypto and the service-role client into the browser bundle.
import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  INVITE_TTL_DAYS,
  ROLE_LABEL,
  inviteState,
  type InvitableRole,
  type InviteState,
} from "./staff-invite-shared";

// Re-exported so server callers have one import to reach for.
export * from "./staff-invite-shared";

// ============================================================================
// Tokens
// ============================================================================

/** 32 random bytes, base64url. ~256 bits — not guessable, and short enough to
 *  survive being pasted out of an email client that wraps long lines. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ============================================================================
// Shapes
// ============================================================================

export type StaffInvitation = {
  id: string;
  email: string;
  role: InvitableRole;
  first_name: string | null;
  last_name: string | null;
  expires_at: string;
  invited_by_email: string | null;
  send_count: number;
  last_sent_at: string | null;
  accepted_at: string | null;
  accepted_user_id: string | null;
  revoked_at: string | null;
  created_at: string;
  note: string | null;
};

const SELECT_COLUMNS =
  "id, email, role, first_name, last_name, expires_at, invited_by_email, send_count, last_sent_at, accepted_at, accepted_user_id, revoked_at, created_at, note";

/** Why a token can't be used, phrased for the person holding the link. */
const REJECTION: Record<Exclude<InviteState, "pending"> | "unknown", string> = {
  unknown: "This invitation link isn't valid. Ask your administrator to send a new one.",
  accepted: "This invitation has already been used. Sign in instead, or ask for a new invitation.",
  revoked: "This invitation was cancelled. Contact your administrator if that's unexpected.",
  expired: "This invitation has expired. Ask your administrator to resend it.",
};

export type ResolveResult =
  | { ok: true; invite: StaffInvitation }
  | { ok: false; reason: string; state: InviteState | "unknown" };

/**
 * Look an invitation up by raw token WITHOUT consuming it.
 *
 * Used by the landing page and by each signup page to decide whether to render
 * the onboarding form at all. Read-only on purpose: a page render must never
 * burn a single-use token, or a refresh would lock the invitee out of their own
 * onboarding.
 */
export async function resolveStaffInvite(rawToken: unknown): Promise<ResolveResult> {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!token) return { ok: false, reason: REJECTION.unknown, state: "unknown" };

  const db = createAdminClient();
  const { data, error } = await db
    .from("staff_invitations")
    .select(SELECT_COLUMNS)
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (error) {
    console.error("[staff-invite] resolve failed:", error);
    return { ok: false, reason: "We couldn't check that invitation. Try again.", state: "unknown" };
  }
  if (!data) return { ok: false, reason: REJECTION.unknown, state: "unknown" };

  const state = inviteState(data as StaffInvitation);
  if (state !== "pending") return { ok: false, reason: REJECTION[state], state };

  return { ok: true, invite: data as StaffInvitation };
}

export type ConsumeResult =
  | { ok: true; invite: StaffInvitation }
  | { ok: false; status: number; message: string };

/**
 * Claim an invitation for a signup that is about to happen.
 *
 * Marks it accepted BEFORE the auth user is created, via a conditional UPDATE
 * that only matches a still-pending row. That single statement is the
 * single-use lock: two simultaneous submissions of the same link race on it and
 * exactly one wins. Claiming afterwards instead would leave a window where both
 * requests see "pending" and two accounts get created from one invitation.
 *
 * The caller MUST call releaseStaffInvite() if signup then fails — otherwise a
 * failed attempt (email already registered, Supabase hiccup) burns the link and
 * the invitee is stuck with a dead URL and no idea why.
 *
 * Both `role` and `email` are re-checked here rather than trusted from the
 * form. The role comes from the route doing the provisioning, so an advisor
 * invitation cannot be POSTed at the underwriting endpoint; the email binds the
 * link to one person, so a forwarded invitation can't be redeemed by whoever
 * received the forward.
 */
export async function consumeStaffInvite(
  rawToken: unknown,
  role: InvitableRole,
  submittedEmail: string
): Promise<ConsumeResult> {
  const resolved = await resolveStaffInvite(rawToken);
  if (!resolved.ok) {
    return { ok: false, status: resolved.state === "unknown" ? 403 : 410, message: resolved.reason };
  }

  const invite = resolved.invite;

  if (invite.role !== role) {
    return {
      ok: false,
      status: 403,
      message: `This invitation is for a ${ROLE_LABEL[invite.role]} account.`,
    };
  }

  if (invite.email.trim().toLowerCase() !== String(submittedEmail).trim().toLowerCase()) {
    return {
      ok: false,
      status: 403,
      message: `This invitation was issued to ${invite.email}. Sign up with that address.`,
    };
  }

  // Claim it. The filters repeat the pending checks so the decision is made by
  // the database in one statement, not by the state we read a moment ago.
  const db = createAdminClient();
  const { data: claimed, error } = await db
    .from("staff_invitations")
    .update({ accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[staff-invite] claim failed:", error);
    return { ok: false, status: 500, message: "We couldn't verify that invitation. Try again." };
  }
  if (!claimed) {
    // Lost the race, or it expired in the gap.
    return { ok: false, status: 410, message: REJECTION.accepted };
  }

  return { ok: true, invite: claimed as StaffInvitation };
}

/**
 * Hand a claimed invitation back after a failed signup, so the link keeps
 * working. Best-effort: if this fails the worst case is an admin resending.
 *
 * The `accepted_user_id IS NULL` filter is load-bearing. Once the auth user
 * exists, markStaffInviteAccepted() has stamped it — and a later failure (GHL
 * sync, welcome email) must NOT reopen the link, or the invitation could be
 * redeemed a second time for an account that already exists.
 */
export async function releaseStaffInvite(inviteId: string): Promise<void> {
  try {
    const db = createAdminClient();
    await db
      .from("staff_invitations")
      .update({ accepted_at: null, updated_at: new Date().toISOString() })
      .eq("id", inviteId)
      .is("accepted_user_id", null);
  } catch (err) {
    console.error("[staff-invite] release failed:", err);
  }
}

/** Record which account an accepted invitation produced. Audit only — never
 *  blocks the signup. */
export async function markStaffInviteAccepted(
  inviteId: string,
  userId: string
): Promise<void> {
  try {
    const db = createAdminClient();
    await db
      .from("staff_invitations")
      .update({ accepted_user_id: userId, updated_at: new Date().toISOString() })
      .eq("id", inviteId);
  } catch (err) {
    console.error("[staff-invite] accept bookkeeping failed:", err);
  }
}

// ============================================================================
// Issuing (admin side)
// ============================================================================

/** The URL an invitee clicks. One entry point for every role — /auth/join reads
 *  the role off the invitation and forwards to the right onboarding form, so an
 *  admin never has to pick the correct signup URL by hand. */
export function inviteUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io").replace(
    /\/+$/,
    ""
  );
  return `${base}/auth/join?token=${encodeURIComponent(token)}`;
}

export function expiryFromNow(days = INVITE_TTL_DAYS): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Freshly minted credential pair: the raw token goes in the email, the hash
 *  goes in the database, and the two are never in the same place again. */
export function mintInviteToken(): { token: string; token_hash: string } {
  const token = newToken();
  return { token, token_hash: hashToken(token) };
}
