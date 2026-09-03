// src/app/admin/team/page.tsx
//
// Team access: who has a staff account, and who has an open invitation to get
// one. This is the replacement for the shared STAFF_SIGNUP_INVITE_CODE — staff
// signup is now invitation-only, per person, and every account traces back to
// the admin who issued the invite. See [[staff_signup_invite_gate]].
//
// Proxy already gates /admin to admins; we re-check defensively. Reads go
// through the service role (staff_invitations is RLS-locked with zero policies).

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserPlus } from "lucide-react";
import { inviteState, type InvitableRole } from "@/lib/auth/staff-invite-shared";
import {
  TeamInvitationsManager,
  type InviteRow,
  type MemberRow,
} from "./_components/team-invitations-manager";

export const dynamic = "force-dynamic";

// Who shows up under "who has access". Includes partner_advisor: they are
// external referral partners working their own deals, and an admin asking who
// can reach the advisor tooling needs to see them. They are NOT invitable from
// this page — the deal desk is provisioned at /admin/referral-partners — so
// they appear in the member list only. See [[role_model]].
const STAFF_ROLES = ["admin", "advisor", "underwriting", "setter", "partner_advisor"] as const;

export default async function AdminTeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data: me } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "admin") redirect("/dashboard");

  const db = createAdminClient();

  // `cleared_at` trails the code until migration 20260902_2 is applied, and a
  // PostgREST select naming a column that does not exist fails the WHOLE query.
  // The error is destructured away below, so without this fallback an unapplied
  // migration would render an EMPTY invitation list — no error, no clue, just an
  // admin concluding their invites vanished. Fall back to the old column set.
  const INVITE_COLUMNS_BASE =
    "id, email, role, first_name, last_name, note, expires_at, invited_by_email, send_count, last_sent_at, accepted_at, revoked_at, created_at";

  async function readInvites() {
    const withCleared = await db
      .from("staff_invitations")
      .select(`${INVITE_COLUMNS_BASE}, cleared_at`)
      .order("created_at", { ascending: false });
    if (!withCleared.error) return withCleared;

    console.warn(
      "admin/team: cleared_at unavailable, falling back (apply 20260902_2_staff_invitation_clearing):",
      withCleared.error.message
    );
    return db
      .from("staff_invitations")
      .select(INVITE_COLUMNS_BASE)
      .order("created_at", { ascending: false });
  }

  // Compliance paperwork for staff advisors (migration 20260903). The columns
  // trail the code until that migration is applied, and a select naming a
  // missing column fails the whole query — so a failure here degrades to "no
  // compliance info" rather than an empty team list.
  async function readAdvisorCompliance(): Promise<
    Map<string, { w9_signed_at: string | null; w9_file_path: string | null; voided_check_uploaded_at: string | null; voided_check_filename: string | null; onboarding_completed_at: string | null; created_at: string | null }>
  > {
    const { data, error } = await db
      .from("advisors")
      .select(
        "user_id, w9_signed_at, w9_file_path, voided_check_uploaded_at, voided_check_filename, onboarding_completed_at, created_at"
      )
      .is("referral_partner_id", null)
      .not("user_id", "is", null);
    if (error) {
      console.error("[admin/team] advisor compliance read failed (migration 20260903 applied?):", error.message);
      return new Map();
    }
    return new Map(
      (data ?? []).map((r) => [
        r.user_id as string,
        {
          w9_signed_at: r.w9_signed_at ?? null,
          w9_file_path: r.w9_file_path ?? null,
          voided_check_uploaded_at: r.voided_check_uploaded_at ?? null,
          voided_check_filename: r.voided_check_filename ?? null,
          onboarding_completed_at: r.onboarding_completed_at ?? null,
          created_at: r.created_at ?? null,
        },
      ])
    );
  }

  const [{ data: invites }, { data: members }, compliance] = await Promise.all([
    readInvites(),
    // The existing team, shown alongside so "invite" isn't the only thing on
    // this page — the question an admin actually arrives with is "who has
    // access", and an invitation list alone answers half of it.
    db
      .from("users")
      .select("id, first_name, last_name, email, role, created_at")
      .in("role", STAFF_ROLES as unknown as string[])
      .order("created_at", { ascending: false }),
    readAdvisorCompliance(),
  ]);

  const inviteRows: InviteRow[] = (invites ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role as InvitableRole,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    note: r.note ?? null,
    expires_at: r.expires_at,
    invited_by_email: r.invited_by_email ?? null,
    send_count: r.send_count ?? 0,
    last_sent_at: r.last_sent_at ?? null,
    created_at: r.created_at,
    state: inviteState({
      accepted_at: r.accepted_at ?? null,
      revoked_at: r.revoked_at ?? null,
      expires_at: r.expires_at,
    }),
    accepted_at: r.accepted_at ?? null,
    // Orthogonal to `state` on purpose — a cleared row is still *accepted*.
    // Cleared rows are fetched, not filtered out server-side: the chips filter
    // client-side, so excluding them here would make the Cleared chip empty.
    // Optional-chained for the pre-migration fallback above, where it is absent.
    cleared_at: (r as { cleared_at?: string | null }).cleared_at ?? null,
  }));

  const memberRows: MemberRow[] = (members ?? []).map((r) => {
    const c = r.role === "advisor" ? compliance.get(r.id) : undefined;
    return {
      id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.email,
      email: r.email,
      role: r.role,
      created_at: r.created_at,
      compliance: c
        ? {
            w9_signed_at: c.w9_signed_at,
            w9_file: !!c.w9_file_path,
            voided_check_uploaded_at: c.voided_check_uploaded_at,
            voided_check_filename: c.voided_check_filename,
            onboarding_completed_at: c.onboarding_completed_at,
          }
        : null,
    };
  });

  return (
    <div className="p-6 md:p-10">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
          <UserPlus className="h-5 w-5 text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Team Access</h1>
          <p className="text-sm text-slate-500">
            Invite advisors, underwriters and setters by email. Each invitation is
            single-use, expires in 7 days and can be cancelled before it&apos;s used.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <TeamInvitationsManager invites={inviteRows} members={memberRows} />
      </div>
    </div>
  );
}
