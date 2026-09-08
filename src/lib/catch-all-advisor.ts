// src/lib/catch-all-advisor.ts
//
// The "catch-all" advisor that stale/inactive files are reassigned to — both
// automatically by the reassign-stale-files cron (7-day inactivity) and
// manually via the "Mark Inactive" button on the client detail page.
//
// The holder is DATA (advisors.is_catch_all, migration 20260908), not a
// hardcoded address. It used to be the literal below, which meant removing the
// catch-all advisor from /admin/team did not fail — it silently kept the cron
// routing stale files to a deactivated account nobody could log into. Making it
// a column is what lets an admin hand the role over, and what lets the removal
// flow REFUSE to remove the holder until someone else is named.
//
// A partial unique index on the column keeps it singular, so this can never
// resolve ambiguously.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The original holder. Retained as the fallback for the window before migration
 * 20260908 is applied — selecting a column that does not exist fails the WHOLE
 * PostgREST query, and a null catch-all stops the stale-file cron dead.
 */
export const CATCH_ALL_ADVISOR_EMAIL = "grant@creditbanc.io";

export interface CatchAllAdvisor {
    id: string;
    user_id: string | null;
    email: string;
    /** Display name ("First Last"), falling back to email. */
    name: string;
}

const SELECT = "id, user_id, first_name, last_name, email";

function shape(data: {
    id: string;
    user_id: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string;
}): CatchAllAdvisor {
    return {
        id: data.id,
        user_id: data.user_id ?? null,
        email: data.email,
        name: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || data.email,
    };
}

/**
 * Looks up the catch-all advisor. Pass a service-role client — the advisors
 * table is not readable from every RLS context. Returns null if nobody holds
 * the role (caller decides how to surface that; the cron answers 500 with
 * catch_all_advisor_not_found, which is the loud failure we want).
 *
 * Note the is_active filter, which the email-matching version did not have. An
 * inactive advisor holding the flag resolves to null rather than to a dead
 * account: better for the cron to fail visibly than to quietly assign every
 * stale file in the company to someone who left.
 */
export async function resolveCatchAllAdvisor(admin: SupabaseClient): Promise<CatchAllAdvisor | null> {
    const flagged = await admin
        .from("advisors")
        .select(SELECT)
        .eq("is_catch_all", true)
        .eq("is_active", true)
        // The catch-all must be internal staff. Belt-and-braces against an
        // external partner advisor ever holding the role — resolving to one
        // would hand every stale file in the company to an outside CPA,
        // silently.
        .is("referral_partner_id", null)
        .maybeSingle();

    if (!flagged.error) return flagged.data ? shape(flagged.data) : null;

    // Pre-migration fallback. Only reached while 20260908 is unapplied; the
    // behaviour is then exactly what it was before this file changed.
    console.warn(
        "catch-all: is_catch_all unavailable, falling back to email match (apply 20260908_team_member_removal):",
        flagged.error.message
    );

    const { data } = await admin
        .from("advisors")
        .select(SELECT)
        .eq("email", CATCH_ALL_ADVISOR_EMAIL)
        .is("referral_partner_id", null)
        .maybeSingle();

    return data ? shape(data) : null;
}
