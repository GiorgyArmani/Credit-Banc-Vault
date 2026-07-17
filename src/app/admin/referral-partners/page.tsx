// src/app/admin/referral-partners/page.tsx
//
// Admin management of the INTERNAL referral-partner list (the client-card dropdown
// + client-creation forms). Add / rename / activate-deactivate without a code
// change. Proxy already gates /admin to admins; we re-check defensively. Reads via
// the service role (referral_partners is RLS-locked). Distinct from the public
// affiliate program at /admin/affiliates — see [[affiliate_program]].

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Users2 } from "lucide-react";
import {
  ReferralPartnersManager,
  type PartnerRow,
} from "./_components/referral-partners-manager";

export const dynamic = "force-dynamic";

export default async function AdminReferralPartnersPage() {
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
  const { data } = await db
    .from("referral_partners")
    .select("id, name, active")
    .order("name", { ascending: true });

  const rows: PartnerRow[] = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    active: r.active,
  }));

  return (
    <div className="p-6 md:p-10">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
          <Users2 className="h-5 w-5 text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            Referral Partners
          </h1>
          <p className="text-sm text-slate-500">
            The internal &quot;who referred this deal&quot; list shown when creating
            a client and on each client card.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <ReferralPartnersManager initial={rows} />
      </div>
    </div>
  );
}
