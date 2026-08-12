// src/lib/catch-all-advisor.ts
//
// The "catch-all" advisor that stale/inactive files are reassigned to — both
// automatically by the reassign-stale-files cron (7-day inactivity) and
// manually via the "Mark Inactive" button on the client detail page.
//
// Resolved by email at runtime (not by a hardcoded id) so a profile change
// (new id/user_id) doesn't silently break reassignment.

import type { SupabaseClient } from "@supabase/supabase-js";

export const CATCH_ALL_ADVISOR_EMAIL = "grant@creditbanc.io";

export interface CatchAllAdvisor {
    id: string;
    user_id: string | null;
    email: string;
    /** Display name ("First Last"), falling back to email. */
    name: string;
}

/**
 * Looks up the catch-all advisor. Pass a service-role client — the advisors
 * table is not readable from every RLS context. Returns null if the advisor
 * row is missing (caller decides how to surface that).
 */
export async function resolveCatchAllAdvisor(admin: SupabaseClient): Promise<CatchAllAdvisor | null> {
    const { data } = await admin
        .from("advisors")
        .select("id, user_id, first_name, last_name, email")
        .eq("email", CATCH_ALL_ADVISOR_EMAIL)
        // The catch-all must be internal staff. Belt-and-braces against an
        // external partner advisor ever being provisioned on this address —
        // resolving to one would hand every stale file in the company to an
        // outside CPA, silently.
        .is("referral_partner_id", null)
        .maybeSingle();

    if (!data) return null;

    return {
        id: data.id,
        user_id: data.user_id ?? null,
        email: data.email,
        name: `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || data.email,
    };
}
