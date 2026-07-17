import type { SupabaseClient } from "@supabase/supabase-js";
import { REFERRAL_PARTNERS } from "@/data/referral-partners";

/**
 * Internal referral-partner registry read helper.
 *
 * Returns the alphabetized list of ACTIVE partner names shown in the client-card
 * dropdown and the client-creation forms. Backed by the `referral_partners` table
 * (migration 20260718). Falls back to the static seed list ([[refactor_alongside_production]])
 * if the table doesn't exist yet or the query fails, so the picker is never empty.
 *
 * Pass a SERVICE-ROLE client — the table is RLS-locked with zero policies
 * (the affiliates pattern). See [[ghl_integration_contract]].
 *
 * This is the INTERNAL referral-partner program, distinct from the public affiliate
 * program (affiliates / referral_leads). See [[affiliate_program]].
 */
export async function getActiveReferralPartners(
  db: SupabaseClient
): Promise<string[]> {
  try {
    const { data, error } = await db
      .from("referral_partners")
      .select("name")
      .eq("active", true)
      .order("name", { ascending: true });

    if (error || !data) {
      console.error("[referral-partners] read failed, using static fallback:", error);
      return [...REFERRAL_PARTNERS];
    }
    return data.map((r: { name: string }) => r.name);
  } catch (err) {
    console.error("[referral-partners] read threw, using static fallback:", err);
    return [...REFERRAL_PARTNERS];
  }
}
