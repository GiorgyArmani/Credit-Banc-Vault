"use server";

// Admin-side staff invitations. Every action re-checks for admin: the proxy
// already gates /admin, but a server action is a callable endpoint, and "the
// page it lives on is protected" has never been a guard.
//
// The raw token is minted here, put in the email, and dropped. Nothing returns
// it to the browser — an invitation link sitting in a React state tree is a
// credential in a place nobody is thinking about. If a link needs replacing,
// resend mints a new one, which is also what invalidates the old.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { signedAdvisorDocUrl } from "@/lib/advisor-onboarding";
import { send_staff_invite } from "@/lib/email";
import {
  ROLE_LABEL,
  expiryFromNow,
  inviteUrl,
  isInvitableRole,
  isValidEmail,
  mintInviteToken,
  type InvitableRole,
} from "@/lib/auth/staff-invite";

type Admin = { id: string; email: string | null };

async function requireAdminUser(): Promise<Admin | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return userRow?.role === "admin" ? { id: user.id, email: user.email ?? null } : null;
}

export type InviteActionResult = {
  success: boolean;
  error?: string;
  /** Set when the invitation was created but the email didn't go out, so the UI
   *  can say "created — resend it" rather than implying nothing happened. */
  warning?: string;
};

function expiresLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** Name for the greeting. Falls back to the local part of the address rather
 *  than "Hi ," when no name was given. */
function greetingName(first: string, last: string, email: string): string {
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || email.split("@")[0];
}

/**
 * Invite someone to the team.
 *
 * Refuses an address that already has an account. Sending an invitation to an
 * existing user would produce a link that dies at signup ("email already
 * registered") with no clue why — and if the role differs, the admin's mental
 * model is "I just changed their role", which this does not do.
 */
export async function inviteStaffMember(input: {
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
  note?: string;
}): Promise<InviteActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const email = (input.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) return { success: false, error: "That email doesn't look right" };
  if (!isInvitableRole(input.role)) return { success: false, error: "Pick a role" };

  const role = input.role as InvitableRole;
  const firstName = (input.firstName || "").trim();
  const lastName = (input.lastName || "").trim();
  const note = (input.note || "").trim();

  const db = createAdminClient();

  // Already a user?
  const { data: existingUser } = await db
    .from("users")
    .select("id, role")
    .ilike("email", email)
    .maybeSingle();

  if (existingUser) {
    return {
      success: false,
      error: `${email} already has a ${existingUser.role} account. Change their role from the user record instead.`,
    };
  }

  // Already invited and still live? Resend rather than stacking a second
  // invitation — the partial unique index would reject it anyway, and "resend"
  // is what the admin actually meant.
  const { data: live } = await db
    .from("staff_invitations")
    .select("id")
    .ilike("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();

  if (live) return resendStaffInvite(live.id);

  const { token, token_hash } = mintInviteToken();
  const expires_at = expiryFromNow();

  const { data: inserted, error } = await db
    .from("staff_invitations")
    .insert({
      email,
      role,
      first_name: firstName || null,
      last_name: lastName || null,
      note: note || null,
      token_hash,
      expires_at,
      invited_by: admin.id,
      invited_by_email: admin.email,
      send_count: 1,
      last_sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { success: false, error: "There's already a live invitation for that address." };
    }
    return { success: false, error: error.message };
  }

  const sendError = await deliver({
    email,
    role,
    firstName,
    lastName,
    token,
    expires_at,
    invitedBy: admin.email,
  });

  revalidatePath("/admin/team");

  if (sendError) {
    return {
      success: true,
      warning: `Invitation created, but the email failed to send (${sendError}). Use Resend.`,
    };
  }
  return { success: true };
}

/**
 * Resend an invitation.
 *
 * Mints a NEW token and pushes the expiry out, which is what makes the previous
 * link stop working. That's the point: "resend" is also the recovery path when
 * a link has been forwarded to the wrong place, and a resend that left the old
 * link alive would quietly fail to contain it.
 */
export async function resendStaffInvite(id: string): Promise<InviteActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: invite, error: readErr } = await db
    .from("staff_invitations")
    .select("id, email, role, first_name, last_name, accepted_at, revoked_at, send_count")
    .eq("id", id)
    .maybeSingle();

  if (readErr || !invite) return { success: false, error: "Invitation not found" };
  if (invite.accepted_at) {
    return { success: false, error: "That invitation has already been used." };
  }
  if (invite.revoked_at) {
    return { success: false, error: "That invitation was cancelled. Invite them again instead." };
  }
  if (!isInvitableRole(invite.role)) {
    return { success: false, error: `Unknown role "${invite.role}" on this invitation.` };
  }

  const { token, token_hash } = mintInviteToken();
  const expires_at = expiryFromNow();

  const { error: updErr } = await db
    .from("staff_invitations")
    .update({
      token_hash,
      expires_at,
      send_count: (invite.send_count ?? 0) + 1,
      last_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    // Don't resurrect an invitation that was accepted or revoked in the gap
    // between the read above and this write.
    .is("accepted_at", null)
    .is("revoked_at", null);

  if (updErr) return { success: false, error: updErr.message };

  const sendError = await deliver({
    email: invite.email,
    role: invite.role,
    firstName: invite.first_name ?? "",
    lastName: invite.last_name ?? "",
    token,
    expires_at,
    invitedBy: admin.email,
  });

  revalidatePath("/admin/team");

  if (sendError) {
    // The old link is already dead at this point — say so, or the admin will
    // assume the previous email still works.
    return {
      success: false,
      error: `New link created but the email failed to send (${sendError}). The previous link no longer works — try Resend again.`,
    };
  }
  return { success: true };
}

/**
 * Cancel a pending invitation. The link stops working immediately; the row
 * stays as the record that someone was invited and then wasn't.
 */
export async function revokeStaffInvite(id: string): Promise<InviteActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: updated, error } = await db
    .from("staff_invitations")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: admin.id,
      // Burn the token as well as flagging the row. Revocation that relies on a
      // status check is one forgotten `WHERE` away from being decorative.
      token_hash: mintInviteToken().token_hash,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!updated) {
    return { success: false, error: "That invitation has already been used or cancelled." };
  }

  revalidatePath("/admin/team");
  return { success: true };
}

/**
 * Delete an invitation row outright. For typos and test rows — revoke is what
 * retires a real one, because it keeps the record that the invitation existed.
 * Accepted invitations are never deletable: they're the audit trail explaining
 * how a live staff account came to exist.
 */
export async function deleteStaffInvite(id: string): Promise<InviteActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: invite } = await db
    .from("staff_invitations")
    .select("id, accepted_at")
    .eq("id", id)
    .maybeSingle();

  if (!invite) return { success: false, error: "Invitation not found" };
  if (invite.accepted_at) {
    return {
      success: false,
      error: "This invitation was used to create an account — it stays as the record of that.",
    };
  }

  // The accepted_at check is repeated as a filter on the DELETE, not just on the
  // read above: a signup accepting in the gap between the two would otherwise
  // have its invitation hard-deleted mid-flight, and releaseStaffInvite would
  // then silently no-op against a row that no longer exists. Same belt-and-
  // braces revokeStaffInvite already uses on its update.
  const { data: deleted, error } = await db
    .from("staff_invitations")
    .delete()
    .eq("id", id)
    .is("accepted_at", null)
    .select("id");
  if (error) return { success: false, error: error.message };
  if (!deleted?.length) {
    return {
      success: false,
      error: "This invitation was just used to create an account — it stays as the record of that.",
    };
  }

  revalidatePath("/admin/team");
  return { success: true };
}

/**
 * Clear an ACCEPTED invitation out of the Team Access list.
 *
 * The counterpart to deleteStaffInvite, for the rows it refuses. An accepted
 * invitation is the only record anywhere of who granted a person staff access —
 * no FK points at it and there is no audit table — so it must not be deleted.
 * But it also renders no actions at all, which left the list growing forever.
 * Clearing hides it; the "Cleared" chip brings it back.
 *
 * Filtered on accepted_at NOT NULL so this can never be used as a back door to
 * hide a live pending invite: those are cancelled (which burns the token), not
 * tidied away.
 */
export async function clearStaffInvite(id: string): Promise<InviteActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: cleared, error } = await db
    .from("staff_invitations")
    .update({
      cleared_at: new Date().toISOString(),
      cleared_by: admin.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .not("accepted_at", "is", null)
    .is("cleared_at", null)
    .select("id");

  if (error) return { success: false, error: error.message };
  if (!cleared?.length) {
    return {
      success: false,
      error: "Only an accepted invitation can be cleared. Cancel a pending one instead.",
    };
  }

  revalidatePath("/admin/team");
  return { success: true };
}

/** Put a cleared invitation back on the list. Clearing is a view, not a door. */
export async function unclearStaffInvite(id: string): Promise<InviteActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { error } = await db
    .from("staff_invitations")
    .update({ cleared_at: null, cleared_by: null, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/team");
  return { success: true };
}

/**
 * Send the email. Returns an error STRING on failure rather than throwing, so
 * callers can report "created but not sent" — which is a different situation
 * from "nothing happened" and needs a different next step from the admin.
 */
async function deliver(args: {
  email: string;
  role: InvitableRole;
  firstName: string;
  lastName: string;
  token: string;
  expires_at: string;
  invitedBy: string | null;
}): Promise<string | null> {
  const url = inviteUrl(args.token);

  // Local convenience: print the link so the onboarding flow can be walked
  // without working SMTP. NEVER in production — this link is a credential, and
  // a credential in a log file is a credential anyone with log access holds.
  if (process.env.NODE_ENV !== "production") {
    console.log(`[staff-invite] DEV invite link for ${args.email} (${args.role}):\n${url}`);
  }

  try {
    await send_staff_invite({
      invitee_name: greetingName(args.firstName, args.lastName, args.email),
      invitee_email: args.email,
      role_label: ROLE_LABEL[args.role],
      invite_url: url,
      expires_label: expiresLabel(args.expires_at),
      invited_by: args.invitedBy,
    });
    return null;
  } catch (err: any) {
    console.error("[staff-invite] send failed:", err);
    return err?.message || "SMTP error";
  }
}

/**
 * Short-lived links to a staff advisor's compliance documents (admin only).
 *
 * Minted on demand rather than rendered into the page: both files live in the
 * PRIVATE `vault` bucket, and a signed URL baked into server-rendered HTML is a
 * credential sitting in a page that gets cached, screenshotted and shared. Ten
 * minutes, fetched at click time. Keyed by the users.id the team list shows.
 */
export async function getAdvisorComplianceLinks(userId: string): Promise<{
  success: boolean;
  error?: string;
  w9_url?: string | null;
  voided_check_url?: string | null;
}> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data, error } = await db
    .from("advisors")
    .select("w9_file_path, voided_check_path")
    .eq("user_id", userId)
    .is("referral_partner_id", null)
    .maybeSingle();
  if (error || !data) return { success: false, error: "Advisor not found" };

  const [w9_url, voided_check_url] = await Promise.all([
    signedAdvisorDocUrl(data.w9_file_path),
    signedAdvisorDocUrl(data.voided_check_path),
  ]);
  return { success: true, w9_url, voided_check_url };
}
