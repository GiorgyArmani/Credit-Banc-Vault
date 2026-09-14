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
  type HandoffTarget,
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
      .is("is_external", false)
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

  // The existing team, shown alongside so "invite" isn't the only thing on this
  // page — the question an admin actually arrives with is "who has access", and
  // an invitation list alone answers half of it.
  //
  // Removed members are pulled in by the same query. Removal sets role='free',
  // so an `in(role, STAFF_ROLES)` filter alone would make them vanish the
  // instant they were removed, taking the Restore button with them. Same
  // column-fallback guard as readInvites: `removed_at` trails the code until
  // migration 20260908 is applied, and naming a missing column in a filter
  // fails the WHOLE query — which would render an empty team list.
  const MEMBER_COLUMNS = "id, first_name, last_name, email, role, created_at";

  async function readMembers() {
    const withRemoved = await db
      .from("users")
      .select(`${MEMBER_COLUMNS}, removed_at, removed_role`)
      .or(`role.in.(${STAFF_ROLES.join(",")}),removed_at.not.is.null`)
      .order("created_at", { ascending: false });
    if (!withRemoved.error) return withRemoved;

    console.warn(
      "admin/team: removed_at unavailable, falling back (apply 20260908_team_member_removal):",
      withRemoved.error.message
    );
    return db
      .from("users")
      .select(MEMBER_COLUMNS)
      .in("role", STAFF_ROLES as unknown as string[])
      .order("created_at", { ascending: false });
  }

  // Advisor identity per staff user: the id client vaults actually point at,
  // plus who currently holds the catch-all. `is_catch_all` trails the code the
  // same way, so it degrades to "nobody is marked" rather than to no advisors.
  async function readAdvisorIdentities(): Promise<
    Map<string, { advisor_id: string; is_active: boolean; is_catch_all: boolean }>
  > {
    const columns = "id, user_id, is_active, referral_partner_id";
    let rows: { id: string; user_id: string | null; is_active: boolean | null; is_catch_all?: boolean }[] = [];

    const withFlag = await db.from("advisors").select(`${columns}, is_catch_all`).is("is_external", false);
    if (!withFlag.error) {
      rows = withFlag.data ?? [];
    } else {
      console.warn(
        "admin/team: is_catch_all unavailable, falling back (apply 20260908_team_member_removal):",
        withFlag.error.message
      );
      const plain = await db.from("advisors").select(columns).is("is_external", false);
      rows = plain.data ?? [];
    }

    return new Map(
      rows
        .filter((r) => r.user_id)
        .map((r) => [
          r.user_id as string,
          {
            advisor_id: r.id,
            is_active: r.is_active !== false,
            is_catch_all: r.is_catch_all === true,
          },
        ])
    );
  }

  const [{ data: invites }, { data: members }, compliance, identities, { data: ownedVaults }] =
    await Promise.all([
      readInvites(),
      readMembers(),
      readAdvisorCompliance(),
      readAdvisorIdentities(),
      // Counted here rather than per row: the modal has to say "owns 20
      // clients" BEFORE an admin commits, and a count fetched on click is a
      // count fetched too late to change their mind.
      db.from("client_data_vault").select("advisor_id").not("advisor_id", "is", null),
    ]);

  const ownedByAdvisor = new Map<string, number>();
  for (const v of ownedVaults ?? []) {
    if (v.advisor_id) ownedByAdvisor.set(v.advisor_id, (ownedByAdvisor.get(v.advisor_id) ?? 0) + 1);
  }

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
    const removed_at = (r as { removed_at?: string | null }).removed_at ?? null;
    const removed_role = (r as { removed_role?: string | null }).removed_role ?? null;
    // A removed member's badge should read the role they held, not the 'free'
    // they were demoted to — that string means nothing to an admin.
    const displayRole = removed_at ? (removed_role ?? r.role) : r.role;
    const c = displayRole === "advisor" ? compliance.get(r.id) : undefined;
    const identity = identities.get(r.id);
    return {
      id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.email,
      email: r.email,
      role: displayRole,
      created_at: r.created_at,
      removed_at,
      advisor_id: identity?.advisor_id ?? null,
      is_catch_all: identity?.is_catch_all ?? false,
      clients_owned: identity ? (ownedByAdvisor.get(identity.advisor_id) ?? 0) : 0,
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

  // Who can inherit a departing advisor's clients, or the catch-all role.
  // Active internal advisors only — handing files to an inactive advisor is the
  // silent-breakage this whole feature exists to prevent.
  const handoffTargets: HandoffTarget[] = memberRows
    .filter((m) => m.advisor_id && !m.removed_at && identities.get(m.id)?.is_active)
    .map((m) => ({
      advisor_id: m.advisor_id as string,
      user_id: m.id,
      name: m.name,
      clients_owned: m.clients_owned ?? 0,
      is_catch_all: m.is_catch_all ?? false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

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
        <TeamInvitationsManager
          invites={inviteRows}
          members={memberRows}
          handoffTargets={handoffTargets}
          currentAdminId={user.id}
        />
      </div>
    </div>
  );
}
