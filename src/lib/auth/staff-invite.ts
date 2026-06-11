// Shared invite-code gate for staff self-signup (advisor / underwriting /
// setter). The check is SERVER-SIDE on purpose: a form field alone is not a
// gate, because the /api/post-signup-* routes can be POSTed directly. One
// shared code for all three roles, configured via env STAFF_SIGNUP_INVITE_CODE.
//
// Fails CLOSED: if the env var is unset/blank, every staff signup is rejected
// (no configured code = no public staff signups). Set STAFF_SIGNUP_INVITE_CODE
// in the environment to enable them.

/**
 * Returns an error `{ status, message }` if the provided invite code is missing,
 * wrong, or unconfigured — or `null` when the code is valid and signup may
 * proceed.
 */
export function checkStaffInviteCode(
  provided: unknown
): { status: number; message: string } | null {
  const expected = process.env.STAFF_SIGNUP_INVITE_CODE?.trim();

  if (!expected) {
    return { status: 503, message: "Staff sign-ups are currently disabled. Contact an admin." };
  }

  if (typeof provided !== "string" || provided.trim() !== expected) {
    return { status: 403, message: "Invalid invite code." };
  }

  return null;
}
