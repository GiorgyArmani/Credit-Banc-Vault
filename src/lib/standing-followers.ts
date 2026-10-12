// src/lib/standing-followers.ts
//
// Standing followers — advisors who automatically follow EVERY vault a given
// advisor creates, without the creator having to pick them on the form.
//
// Exists for the booking/chasing agent account (Llyod): Matt is building that
// agent and needs eyes on every file it opens. A follower gets read access
// through is_assigned_advisor_for(), shows on the file, and is CC'd on the
// client-facing emails the vault sends.
//
// Keyed by the CREATOR's advisors.id, valued by follower advisors.id —
// client_followers.advisor_id is an FK to advisors.id, NOT users.id.

import type { SupabaseClient } from "@supabase/supabase-js";

const STANDING_FOLLOWERS: Record<string, string[]> = {
  // Llyod Fitz (llyod@creditbanc.io) → Matthew R Meehan (matt@mrmcapitalgroup.com)
  "f9c60db0-d7a1-46ed-93f3-c460ec767fcc": ["5f3d0a61-4132-4baf-8c88-da3a0066a252"],
};

/** advisors.id of everyone who follows every vault this advisor creates. */
export function getStandingFollowerIds(creatorAdvisorId: string | null | undefined): string[] {
  if (!creatorAdvisorId) return [];
  return (STANDING_FOLLOWERS[creatorAdvisorId] ?? []).filter((id) => id !== creatorAdvisorId);
}

/**
 * Attach the creator's standing followers to a freshly created vault and return
 * their emails so the caller can CC them.
 *
 * SERVICE ROLE ONLY — client_followers insert is `is_admin_user()` under RLS and
 * a denial fails silently. Best-effort: a signup must never fail because of this.
 */
export async function attachStandingFollowers(
  db: SupabaseClient,
  args: { vaultId: string; creatorAdvisorId: string | null | undefined }
): Promise<string[]> {
  const followerIds = getStandingFollowerIds(args.creatorAdvisorId);
  if (!args.vaultId || followerIds.length === 0) return [];

  try {
    // Resolve first: a follower whose advisors row was deleted would otherwise
    // fail the whole insert on a bad FK.
    const { data: followers, error: lookupErr } = await db
      .from("advisors")
      .select("id, email")
      .in("id", followerIds);

    if (lookupErr) {
      console.error("[standing-followers] could not resolve follower advisors:", lookupErr);
      return [];
    }
    if (!followers?.length) {
      console.warn(
        `[standing-followers] vault ${args.vaultId}: none of the configured followers has an advisors row`
      );
      return [];
    }

    // Duplicates are expected on re-signup; ignore rather than upsert.
    const { error: followErr } = await db.from("client_followers").insert(
      followers.map((f) => ({
        client_vault_id: args.vaultId,
        advisor_id: f.id,
        assigned_by: args.creatorAdvisorId,
      }))
    );
    if (followErr && followErr.code !== "23505") {
      console.error("[standing-followers] follower insert failed:", followErr);
      return [];
    }

    console.log(
      `[standing-followers] vault ${args.vaultId}: ${followers.length} standing follower(s) attached`
    );
    return followers
      .map((f) => f.email)
      .filter((e): e is string => typeof e === "string" && e.includes("@"));
  } catch (err) {
    console.error("[standing-followers] failed (non-fatal):", err);
    return [];
  }
}
