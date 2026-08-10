// src/app/admin/referral-partners/page.tsx
//
// Admin management of the Level-2 REFERRAL PARTNER program: the "who referred
// this deal" registry, the links partners hand out, portal access, commission
// terms, and how each partner is actually performing.
//
// Proxy already gates /admin to admins; we re-check defensively. Reads go
// through the service role (referral_partners is RLS-locked with zero policies).
//
// Distinct from the public affiliate program at /admin/affiliates — affiliates
// self-signup and earn a flat gift card; referral partners are invited
// professionals on a negotiated commission. See [[affiliate_program]].

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Users2 } from "lucide-react";
import { partnerStageFor } from "@/lib/partner-pipeline";
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
    .select(
      "id, name, slug, active, email, phone, company, notes, commission_type, commission_value, portal_enabled, user_id, invited_at, password_set_at, last_login_at"
    )
    .order("name", { ascending: true });

  // Per-partner performance, computed here rather than per row: two reads for
  // the whole page instead of two per partner.
  const { data: attributed } = await db
    .from("client_data_vault")
    .select("id, referral_partner_id")
    .not("referral_partner_id", "is", null);

  const vaultIds = (attributed ?? []).map((c) => c.id);
  const statusByVault = new Map<string, string>();
  if (vaultIds.length) {
    const { data: history } = await db
      .from("loan_status_history")
      .select("client_vault_id, status, created_at")
      .in("client_vault_id", vaultIds)
      .order("created_at", { ascending: false });
    for (const h of history ?? []) {
      if (!statusByVault.has(h.client_vault_id)) {
        statusByVault.set(h.client_vault_id, h.status);
      }
    }
  }

  const referralCounts = new Map<string, { total: number; funded: number }>();
  for (const c of attributed ?? []) {
    const key = c.referral_partner_id as string;
    const bucket = referralCounts.get(key) ?? { total: 0, funded: 0 };
    bucket.total += 1;
    if (partnerStageFor(statusByVault.get(c.id)).tone === "won") bucket.funded += 1;
    referralCounts.set(key, bucket);
  }

  const rows: PartnerRow[] = (data ?? []).map((r) => {
    const counts = referralCounts.get(r.id) ?? { total: 0, funded: 0 };
    return {
      id: r.id,
      name: r.name,
      slug: r.slug ?? null,
      active: r.active,
      email: r.email ?? null,
      phone: r.phone ?? null,
      company: r.company ?? null,
      notes: r.notes ?? null,
      commission_type: (r.commission_type as "percent" | "flat" | null) ?? null,
      commission_value:
        r.commission_value === null || r.commission_value === undefined
          ? null
          : Number(r.commission_value),
      portal_enabled: !!r.portal_enabled,
      has_login: !!r.user_id,
      invited_at: r.invited_at ?? null,
      password_set_at: r.password_set_at ?? null,
      last_login_at: r.last_login_at ?? null,
      referral_count: counts.total,
      funded_count: counts.funded,
    };
  });

  const marketingUrl = (
    process.env.NEXT_PUBLIC_MARKETING_URL || "https://creditbanc.io"
  ).replace(/\/+$/, "");

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
            CPAs, bankers and professionals who refer clients. Manage their links,
            portal access and commission terms.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <ReferralPartnersManager initial={rows} marketingUrl={marketingUrl} />
      </div>
    </div>
  );
}
