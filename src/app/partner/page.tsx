// src/app/partner/page.tsx
//
// /partner is a route PREFIX, not a page — the portal has two landing pages and
// which one you want depends on the role:
//   referral_partner  → /partner/dashboard  (the read-only referral book)
//   partner_advisor   → /partner/deals      (the deal desk)
//
// Without this, anything that treats the prefix as a destination 404s. The
// layout above has already gated the role, so a bare /partner just needs to be
// pointed at the right half of the portal.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isExternalAdvisor } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function PartnerIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = userRow?.role;
  redirect(isExternalAdvisor(role) || role === "admin" ? "/partner/deals" : "/partner/dashboard");
}
