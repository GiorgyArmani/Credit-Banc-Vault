// Shared server-side gate for the three staff signup pages.
//
// One helper rather than the same twenty lines pasted into advisor-signup,
// underwriting-signup and setter-signup: a gate that exists in three copies
// eventually exists in two, and the one that drifts is the one nobody notices
// until someone walks through it.
//
// This decides only whether to RENDER the onboarding form. The real gate is
// consumeStaffInvite() inside /api/post-signup-*, because that endpoint can be
// POSTed without ever loading this page. See [[staff_signup_invite_gate]].

import { resolveStaffInvite } from "@/lib/auth/staff-invite";
import { ROLE_LABEL, type InvitableRole } from "@/lib/auth/staff-invite-shared";

/** What the form needs to render itself pre-filled and locked to one person. */
export type InviteContext = {
  token: string;
  email: string;
  firstName: string;
  lastName: string;
};

export type SignupGate =
  | { ok: true; invite: InviteContext }
  | { ok: false; title: string; message: string };

export async function gateSignupPage(
  rawToken: unknown,
  role: InvitableRole
): Promise<SignupGate> {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  // No token at all: someone found the URL. Staff accounts are invitation-only
  // now, so this is a wall, not a form with a code box on it.
  if (!token) {
    return {
      ok: false,
      title: "Invitation required",
      message:
        "Credit Banc team accounts are created by invitation only. Ask an administrator to send you one — you'll get an email with a link that brings you straight here.",
    };
  }

  const result = await resolveStaffInvite(token);
  if (!result.ok) {
    return {
      ok: false,
      title: result.state === "expired" ? "This invitation expired" : "Invitation not valid",
      message: result.reason,
    };
  }

  if (result.invite.role !== role) {
    return {
      ok: false,
      title: "Wrong sign-up page",
      message: `This invitation is for a ${ROLE_LABEL[result.invite.role]} account. Open the link from your invitation email again and it'll take you to the right place.`,
    };
  }

  return {
    ok: true,
    invite: {
      token,
      email: result.invite.email,
      firstName: result.invite.first_name ?? "",
      lastName: result.invite.last_name ?? "",
    },
  };
}
