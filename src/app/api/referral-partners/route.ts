// src/app/api/referral-partners/route.ts
//
// Returns the active INTERNAL referral-partner list for the client-card picker and
// the client-creation forms (standard + speed). The table is RLS-locked with zero
// policies (the affiliates pattern), so the read goes through the service role
// behind an auth check. `can_manage` tells the picker whether to show the inline
// "+ Add" affordance (admins only). See [[ghl_integration_contract]].

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveReferralPartners } from "@/lib/referral-partners";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Any authenticated staff user may read the list; anonymous is rejected.
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: me } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const db = createAdminClient();
  const partners = await getActiveReferralPartners(db);

  return NextResponse.json({
    partners,
    can_manage: me?.role === "admin",
  });
}
