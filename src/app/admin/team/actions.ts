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
import { backfillAdvisorW9Pdf, signedAdvisorDocUrl } from "@/lib/advisor-onboarding";
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
    .select("id, w9_signed_at, w9_file_path, voided_check_path")
    .eq("user_id", userId)
    .is("referral_partner_id", null)
    .maybeSingle();
  if (error || !data) return { success: false, error: "Advisor not found" };

  // Signed, but our copy never arrived: SignWell renders the PDF a few seconds
  // after it flips the document to Completed, and every fetch during onboarding
  // is best-effort. This click is the last chance to pick it up — after the
  // gate opens, nothing else asks SignWell again.
  let w9Path = data.w9_file_path as string | null;
  if (!w9Path && data.w9_signed_at) {
    w9Path = await backfillAdvisorW9Pdf(data.id as string);
  }

  const [w9_url, voided_check_url] = await Promise.all([
    signedAdvisorDocUrl(w9Path),
    signedAdvisorDocUrl(data.voided_check_path),
  ]);
  return { success: true, w9_url, voided_check_url };
}

/* ==========================================================================
 * REMOVING A TEAM MEMBER
 * ==========================================================================
 *
 * Two different operations wear the same button, because "remove" means two
 * different things depending on what the person left behind.
 *
 * REVOKE (advisors, and anyone with authored history). The auth user survives,
 * so every note they wrote and every document they approved stays attributed to
 * a real name. Access dies three ways at once — see revokeAccess below.
 *
 * DELETE (underwriters and setters with a genuinely empty history). The auth
 * user is destroyed. This was verified against production with a synthetic
 * account rather than assumed, because the schema dumps in this repo record no
 * ON DELETE rules at all. What the probe found, deleting one auth user:
 *
 *     public.users                 CASCADE  (row destroyed)
 *     advisors                     CASCADE
 *     client_followers             CASCADE
 *     client_internal_notes        CASCADE  <- and author_id is NOT NULL,
 *                                             so it cannot be detached first
 *     document_category_approvals  CASCADE
 *     in_app_notifications         CASCADE
 *     client_data_vault.advisor_id SET NULL (the vault SURVIVES, unassigned)
 *
 * All of it silent — deleteUser returned success. That is why the delete path
 * is gated on a history count instead of being offered freely: deleting an
 * underwriter with approvals would un-approve live documents, which drives the
 * client doc flow and the vault_completed tag, with no error anywhere.
 *
 * The one piece of genuinely good news is the last line: client vaults are
 * never destroyed by removing an advisor. They fall to unassigned, which is
 * already a first-class state (/admin/pipeline's Unassigned filter reads
 * `!d.advisor_id`).
 */

/** Roles this page may remove. Admins are excluded deliberately: no admin can
 *  lock out another, or themselves. partner_advisor is excluded because those
 *  are provisioned at /admin/referral-partners, where revoking is a different
 *  action that also has to think about the partner's referral book. */
const REMOVABLE_ROLES = ["advisor", "underwriting", "setter"] as const;

/**
 * Tables where a hard delete would destroy authored work, verified above.
 *
 * in_app_notifications is deliberately NOT here. Those are messages sent TO
 * someone, not work they produced — losing an inbox on the way out is fine, and
 * including it would block every delete (Yai alone has 60) for no benefit.
 */
/**
 * Is migration 20260908 applied?
 *
 * The READ side degrades gracefully without it (the team page falls back to the
 * old column set). The WRITE side cannot: revokeAccess stamps removed_at, and
 * without the column that UPDATE fails — after the clients have already been
 * moved and, worse, after the catch-all role may already have been handed over.
 * A half-finished removal is a far worse outcome than a refused one, so both
 * mutating paths check first and refuse cleanly.
 */
async function removalSchemaReady(
  db: ReturnType<typeof createAdminClient>
): Promise<boolean> {
  const { error } = await db.from("users").select("removed_at", { head: true, count: "exact" }).limit(1);
  return !error;
}

const MIGRATION_REQUIRED =
  "Removing team members needs migration 20260908_team_member_removal applied first.";

const AUTHORED_HISTORY: { table: string; column: string; label: string }[] = [
  { table: "client_internal_notes", column: "author_id", label: "internal note" },
  { table: "document_category_approvals", column: "approved_by", label: "document approval" },
  { table: "client_file_notes", column: "author_id", label: "file note" },
  { table: "document_share_links", column: "created_by", label: "lender share link" },
  { table: "lender_assignment_attachments", column: "uploaded_by", label: "lender attachment" },
  { table: "communications", column: "staff_user_id", label: "logged communication" },
];

export type MemberHistory = { label: string; count: number }[];

/** Counts, per table, what a hard delete of this user would take with it.
 *  A failing count is treated as "history exists" — never as zero. Guessing
 *  optimistically here is how the destructive branch gets taken by accident. */
async function countAuthoredHistory(
  db: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<{ history: MemberHistory; unknown: boolean }> {
  const history: MemberHistory = [];
  let unknown = false;

  for (const { table, column, label } of AUTHORED_HISTORY) {
    const { count, error } = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(column, userId);
    if (error) {
      console.error(`[admin/team] history count failed for ${table}.${column}:`, error.message);
      unknown = true;
      continue;
    }
    if ((count ?? 0) > 0) history.push({ label, count: count ?? 0 });
  }

  return { history, unknown };
}

/**
 * Kill access without touching anything the person produced.
 *
 * Three writes, because one is not enough:
 *   1. users.role -> 'free' is the ONLY one that closes the door. Every gate
 *      (src/proxy.ts, the advisor/admin/underwriting layouts) reads this
 *      column; advisors.is_active does not gate login at all.
 *   2. advisors.is_active -> false drops them out of the reassignment target
 *      list and the follower picker, both of which already filter on it.
 *   3. Banning the auth user invalidates a live session and a remembered
 *      password. Without it, "removed" only takes effect on their next login.
 */
async function revokeAccess(
  db: ReturnType<typeof createAdminClient>,
  member: { id: string; role: string },
  adminId: string
): Promise<string | null> {
  const { error: roleErr } = await db
    .from("users")
    .update({
      role: "free",
      removed_at: new Date().toISOString(),
      removed_role: member.role,
      removed_by: adminId,
    })
    .eq("id", member.id);
  if (roleErr) return roleErr.message;

  // No advisors row for most underwriters — not an error.
  await db.from("advisors").update({ is_active: false }).eq("user_id", member.id);

  // 100 years. Best-effort: access is already gone via the role change, and
  // failing the whole removal because the auth API hiccuped would leave the
  // admin thinking nothing happened when most of it did.
  const { error: banErr } = await db.auth.admin.updateUserById(member.id, {
    ban_duration: "876000h",
  });
  if (banErr) console.error("[admin/team] ban failed (role already revoked):", banErr.message);

  return null;
}

export type RemoveMemberResult = {
  success: boolean;
  error?: string;
  /** What actually happened, so the UI never claims a delete it didn't do. */
  outcome?: "deleted" | "revoked";
  /** Populated when a delete was refused: what would have been destroyed. */
  keptBecause?: MemberHistory;
  /** Clients moved off them, and where they went. */
  clientsMoved?: number;
  handoffLabel?: string;
};

/**
 * Remove a team member.
 *
 * `handoff` is required for anyone holding clients and has no default on
 * purpose. Silently defaulting to the catch-all advisor would blur the line
 * between a person leaving and a file going stale — Grant's queue is the
 * stale-file cron's, and a departure is not staleness. An admin may still
 * choose him explicitly; that is a decision, not a fallback, and it is why this
 * never stamps reassigned_to_catch_all_at.
 *
 * `catchAllSuccessorId` is a SEPARATE required answer when the person being
 * removed holds the catch-all role, because "who takes their clients" and "who
 * inherits stale files from now on" are different questions with different
 * right answers.
 */
export async function removeTeamMember(input: {
  memberId: string;
  handoff: { mode: "unassign" } | { mode: "transfer"; toAdvisorId: string };
  catchAllSuccessorId?: string;
}): Promise<RemoveMemberResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const { memberId, handoff, catchAllSuccessorId } = input;

  if (memberId === admin.id) {
    return { success: false, error: "You can't remove your own account." };
  }

  const db = createAdminClient();

  // Checked before ANY write — see removalSchemaReady.
  if (!(await removalSchemaReady(db))) return { success: false, error: MIGRATION_REQUIRED };

  const { data: member, error: memberErr } = await db
    .from("users")
    .select("id, first_name, last_name, email, role, removed_at")
    .eq("id", memberId)
    .maybeSingle();
  if (memberErr || !member) return { success: false, error: "Team member not found." };
  if (member.removed_at) return { success: false, error: "That member has already been removed." };

  if (!(REMOVABLE_ROLES as readonly string[]).includes(member.role)) {
    return {
      success: false,
      error:
        member.role === "admin"
          ? "Admins can't be removed here."
          : member.role === "partner_advisor"
            ? "Partner advisors are managed from Referral Partners."
            : `A ${member.role} account can't be removed from this page.`,
    };
  }

  const name =
    [member.first_name, member.last_name].filter(Boolean).join(" ").trim() || member.email;

  // ── Their advisor identity, if any. Underwriters generally have none. ──
  const { data: advisorRow } = await db
    .from("advisors")
    .select("id, is_catch_all")
    .eq("user_id", memberId)
    .maybeSingle();

  // ── The catch-all role has to land somewhere before they go ───────────────
  //
  // Checked before any write. Bailing out halfway through a removal because
  // nobody was named would leave a half-removed member behind.
  if (advisorRow?.is_catch_all) {
    if (!catchAllSuccessorId) {
      return {
        success: false,
        error: `${name} is the catch-all advisor for stale files. Choose who takes that over before removing them.`,
      };
    }
    if (catchAllSuccessorId === advisorRow.id) {
      return {
        success: false,
        error: "The catch-all can't be handed to the person being removed.",
      };
    }
    const { data: successor } = await db
      .from("advisors")
      .select("id, is_active, referral_partner_id")
      .eq("id", catchAllSuccessorId)
      .maybeSingle();
    if (!successor || successor.is_active === false || successor.referral_partner_id) {
      return { success: false, error: "That advisor can't hold the catch-all role." };
    }
    // Clear first: the partial unique index permits exactly one holder, so
    // setting before clearing collides.
    const cleared = await db
      .from("advisors")
      .update({ is_catch_all: false })
      .eq("id", advisorRow.id);
    if (cleared.error) return { success: false, error: cleared.error.message };
    const set = await db
      .from("advisors")
      .update({ is_catch_all: true })
      .eq("id", catchAllSuccessorId);
    if (set.error) {
      // Put it back rather than leaving the company with no catch-all.
      await db.from("advisors").update({ is_catch_all: true }).eq("id", advisorRow.id);
      return { success: false, error: set.error.message };
    }
  }

  // ── Hand off the book ─────────────────────────────────────────────────────
  let clientsMoved = 0;
  let handoffLabel = "";

  if (advisorRow) {
    let patch: { advisor_id: string | null; advisor_name: string };

    if (handoff.mode === "transfer") {
      if (handoff.toAdvisorId === advisorRow.id) {
        return { success: false, error: "Choose someone other than the person being removed." };
      }
      const { data: target } = await db
        .from("advisors")
        .select("id, first_name, last_name, email, is_active")
        .eq("id", handoff.toAdvisorId)
        .maybeSingle();
      if (!target) return { success: false, error: "The advisor taking the clients wasn't found." };
      if (target.is_active === false) {
        return { success: false, error: "That advisor is inactive and can't take on clients." };
      }
      handoffLabel = `${target.first_name ?? ""} ${target.last_name ?? ""}`.trim() || target.email;
      patch = { advisor_id: target.id, advisor_name: handoffLabel };
    } else {
      handoffLabel = "Unassigned";
      // advisor_name is NOT NULL, so it can't simply be nulled alongside the
      // id. Leaving it is what produced the six live vaults still displaying a
      // departed advisor's name against a null advisor_id.
      patch = { advisor_id: null, advisor_name: "Unassigned" };
    }

    const { data: owned } = await db
      .from("client_data_vault")
      .select("id")
      .eq("advisor_id", advisorRow.id);
    clientsMoved = owned?.length ?? 0;

    if (clientsMoved > 0) {
      const { error: moveErr } = await db
        .from("client_data_vault")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("advisor_id", advisorRow.id);
      if (moveErr) {
        return { success: false, error: `Couldn't move their clients: ${moveErr.message}` };
      }

      // Nobody is both owner and follower of the same file.
      if (handoff.mode === "transfer") {
        await db
          .from("client_followers")
          .delete()
          .eq("advisor_id", handoff.toAdvisorId)
          .in(
            "client_vault_id",
            (owned ?? []).map((c) => c.id)
          );
      }
    }

    // They're leaving; following files they no longer work on is not access
    // anyone intended to keep granting.
    await db.from("client_followers").delete().eq("advisor_id", advisorRow.id);
  }

  // ── Delete or revoke ──────────────────────────────────────────────────────
  //
  // Advisors are never deleted: they always carry an advisors row and usually
  // notes and approvals, and the row is what keeps their name on that work.
  const { history, unknown } = await countAuthoredHistory(db, memberId);
  const canDelete = member.role !== "advisor" && history.length === 0 && !unknown;

  if (canDelete) {
    // Everything else goes with it, by cascade — including the public.users
    // row, which has no FK recorded in prodDB.sql but cascades in production.
    const { error: delErr } = await db.auth.admin.deleteUser(memberId);
    if (delErr) return { success: false, error: `Couldn't delete the account: ${delErr.message}` };
    revalidatePath("/admin/team");
    return { success: true, outcome: "deleted", clientsMoved, handoffLabel };
  }

  const revokeErr = await revokeAccess(db, member, admin.id);
  if (revokeErr) return { success: false, error: revokeErr };

  revalidatePath("/admin/team");
  return {
    success: true,
    outcome: "revoked",
    keptBecause: history,
    clientsMoved,
    handoffLabel,
  };
}

/**
 * Undo a revocation: role back, ban lifted, advisor profile reactivated.
 *
 * Clients deliberately do NOT come back. They were handed to someone who has
 * been working them since, and silently pulling them back out from under that
 * person is a worse surprise than reassigning a few files by hand.
 */
export async function restoreTeamMember(memberId: string): Promise<InviteActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  if (!(await removalSchemaReady(db))) return { success: false, error: MIGRATION_REQUIRED };

  const { data: member } = await db
    .from("users")
    .select("id, removed_at, removed_role")
    .eq("id", memberId)
    .maybeSingle();

  if (!member) return { success: false, error: "Team member not found." };
  if (!member.removed_at) return { success: false, error: "That member hasn't been removed." };

  const role = member.removed_role;
  if (!role || !(REMOVABLE_ROLES as readonly string[]).includes(role)) {
    return { success: false, error: "Their previous role isn't recorded — set it by hand." };
  }

  const { error } = await db
    .from("users")
    .update({ role, removed_at: null, removed_role: null, removed_by: null })
    .eq("id", memberId);
  if (error) return { success: false, error: error.message };

  await db.from("advisors").update({ is_active: true }).eq("user_id", memberId);

  const { error: unbanErr } = await db.auth.admin.updateUserById(memberId, {
    ban_duration: "none",
  });
  if (unbanErr) {
    // The role is back but the ban would still block the login, which looks
    // exactly like "restore did nothing". Say so rather than reporting success.
    return {
      success: true,
      warning: `Role restored, but the login is still blocked (${unbanErr.message}). Unban them in Supabase.`,
    };
  }

  revalidatePath("/admin/team");
  return { success: true };
}

/**
 * Hand the catch-all role to another advisor without removing anyone.
 *
 * Same clear-then-set order as the removal path, for the same reason: the
 * partial unique index allows exactly one holder.
 */
export async function setCatchAllAdvisor(advisorId: string): Promise<InviteActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { data: target, error: readErr } = await db
    .from("advisors")
    .select("id, is_active, referral_partner_id")
    .eq("id", advisorId)
    .maybeSingle();

  if (readErr) return { success: false, error: readErr.message };
  if (!target) return { success: false, error: "Advisor not found." };
  if (target.is_active === false) {
    return { success: false, error: "An inactive advisor can't be the catch-all." };
  }
  if (target.referral_partner_id) {
    return { success: false, error: "External partner advisors can't hold the catch-all role." };
  }

  const { data: current, error: currentErr } = await db
    .from("advisors")
    .select("id")
    .eq("is_catch_all", true)
    .maybeSingle();

  if (currentErr) {
    return { success: false, error: "Apply migration 20260908 before changing the catch-all." };
  }
  if (current?.id === advisorId) return { success: true };

  if (current) {
    const cleared = await db.from("advisors").update({ is_catch_all: false }).eq("id", current.id);
    if (cleared.error) return { success: false, error: cleared.error.message };
  }

  const { error } = await db.from("advisors").update({ is_catch_all: true }).eq("id", advisorId);
  if (error) {
    if (current) await db.from("advisors").update({ is_catch_all: true }).eq("id", current.id);
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/team");
  return { success: true };
}
