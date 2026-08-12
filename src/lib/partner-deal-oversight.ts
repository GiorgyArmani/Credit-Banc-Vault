// src/lib/partner-deal-oversight.ts
//
// Internal oversight of deals created by an EXTERNAL partner advisor.
//
// A partner advisor owns the files they create — they are the advisor of record
// and do the advisor job on them. That is the point of the deal desk. But an
// outside CPA working a Credit Banc file unsupervised is not, so every
// partner-created deal gets internal eyes on it automatically:
//
//   1. Every admin holding an `advisors` row is added as a client_follower.
//      Followers get read access through is_assigned_advisor_for() (it matches
//      followers as well as owners), appear on the file, and are CC'd on the
//      client-facing emails the vault sends.
//   2. Those same admins get an in-app notification that the deal exists.
//
// This also replaces the stale-file safety net: partner-owned files are exempt
// from the reassign-stale-files cron (an outside partner shouldn't silently lose
// their deal to Grant on day 7), so the admin follower is what makes sure a
// stalled partner deal is still somebody's problem.
//
// SERVICE ROLE ONLY. Both writes are blocked for the caller under RLS:
// client_followers insert is `is_admin_user()` and in_app_notifications insert
// is `is_staff_user()`, and an RLS denial here fails SILENTLY — see
// [[rls_client_writes_need_service_role]]. Pass the admin client.
//
// Entirely best-effort: a signup must never fail because oversight wiring did.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Attach internal oversight to a freshly created, partner-owned vault.
 *
 * No-op when `creatorPartnerId` is null — i.e. every deal created by staff.
 */
export async function attachAdminOversightToPartnerDeal(
  db: SupabaseClient,
  args: {
    vaultId: string;
    /** advisors.referral_partner_id of the creator. Null for staff-created deals. */
    creatorPartnerId: string | null | undefined;
    clientName?: string | null;
    companyName?: string | null;
    partnerName?: string | null;
  }
): Promise<void> {
  const { vaultId, creatorPartnerId, clientName, companyName, partnerName } = args;
  if (!vaultId || !creatorPartnerId) return;

  try {
    const { data: adminUsers, error: adminErr } = await db
      .from("users")
      .select("id")
      .eq("role", "admin");

    if (adminErr) {
      console.error("[partner-oversight] could not list admins:", adminErr);
      return;
    }
    if (!adminUsers?.length) {
      console.warn(`[partner-oversight] vault ${vaultId}: no admin users found`);
      return;
    }

    // client_followers.advisor_id is an FK to advisors.id, NOT users.id. An
    // admin without an advisors row simply cannot be a follower — skip them
    // rather than failing the whole insert on a bad FK.
    const { data: adminAdvisors, error: advErr } = await db
      .from("advisors")
      .select("id, user_id")
      .in(
        "user_id",
        adminUsers.map((u) => u.id)
      );

    if (advErr) {
      console.error("[partner-oversight] could not resolve admin advisor rows:", advErr);
      return;
    }

    if (!adminAdvisors?.length) {
      // Worth shouting about: this is the ONLY internal safety net on a
      // partner-owned deal, and it is silently absent.
      console.warn(
        `[partner-oversight] vault ${vaultId}: no admin has an advisors row — ` +
          `this partner-created deal has NO internal follower. Give an admin an advisors row.`
      );
      return;
    }

    const label = `${clientName || "A client"}${companyName ? ` (${companyName})` : ""}`;

    // Duplicates are expected on re-runs; ignore rather than upsert, matching
    // how the reassignment cron adds the previous advisor as a follower.
    const { error: followErr } = await db.from("client_followers").insert(
      adminAdvisors.map((a) => ({
        client_vault_id: vaultId,
        advisor_id: a.id,
      }))
    );
    if (followErr && followErr.code !== "23505") {
      console.error("[partner-oversight] follower insert failed:", followErr);
    }

    const { error: notifyErr } = await db.from("in_app_notifications").insert(
      adminAdvisors.map((a) => ({
        user_id: a.user_id,
        client_id: vaultId,
        title: "New deal from a referral partner",
        message:
          `${label} was created by ${partnerName || "a referral partner"}. ` +
          `You've been added as a follower.`,
      }))
    );
    if (notifyErr) {
      console.error("[partner-oversight] notification insert failed:", notifyErr);
    }

    console.log(
      `[partner-oversight] vault ${vaultId}: ${adminAdvisors.length} admin follower(s) attached`
    );
  } catch (err) {
    console.error("[partner-oversight] failed (non-fatal):", err);
  }
}
