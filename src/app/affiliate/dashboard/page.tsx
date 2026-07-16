// src/app/affiliate/dashboard/page.tsx
//
// Affiliate referral dashboard: the affiliate's link + usage (clicks), the
// referrals they've sent, and their rewards ($500 per funded referral). Reads
// are done with the service role, strictly scoped to the affiliate resolved from
// the authenticated session (these tables are RLS-locked to service-role only —
// see the migration security note). The /affiliate layout already gates the role.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CopyLink } from "./_components/copy-link";
import { MousePointerClick, Users, DollarSign, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

const REWARD = Number(process.env.AFFILIATE_COMMISSION_AMOUNT ?? 500);

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "In progress",
  disqualified: "Not a fit",
};

const PAYOUT_LABELS: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Processing",
  canceled: "Canceled",
};

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function AffiliateDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const db = createAdminClient();

  const { data: affiliate } = await db
    .from("affiliates")
    .select("id, referral_code, first_name, link_clicks, status")
    .eq("user_id", user.id)
    .maybeSingle();

  // An admin visiting without an affiliate profile still gets a sane page.
  if (!affiliate) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="rounded-3xl border border-emerald-100 bg-white p-10 text-center">
          <h1 className="text-2xl font-black text-emerald-950 mb-2">No affiliate profile</h1>
          <p className="text-emerald-900/50 font-bold">This account isn't set up as an affiliate.</p>
        </div>
      </div>
    );
  }

  const [{ data: leads }, { data: payouts }] = await Promise.all([
    db
      .from("referral_leads")
      .select("id, first_name, last_name, business_name, status, created_at")
      .eq("affiliate_id", affiliate.id)
      .order("created_at", { ascending: false }),
    db
      .from("affiliate_payouts")
      .select("id, commission_amount, status, created_at")
      .eq("affiliate_id", affiliate.id)
      .order("created_at", { ascending: false }),
  ]);

  const leadRows = leads ?? [];
  const payoutRows = payouts ?? [];

  const totalReferrals = leadRows.length;
  const fundedCount = payoutRows.length;
  const earned = payoutRows
    .filter((p) => p.status === "sent" || p.status === "delivered")
    .reduce((sum, p) => sum + Number(p.commission_amount || 0), 0);
  const pending = payoutRows
    .filter((p) => p.status === "pending" || p.status === "failed")
    .reduce((sum, p) => sum + Number(p.commission_amount || 0), 0);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
  const referralUrl = `${appUrl}/r/${affiliate.referral_code}`;

  const stats = [
    { icon: MousePointerClick, label: "Link clicks", value: String(affiliate.link_clicks ?? 0) },
    { icon: Users, label: "Referrals", value: String(totalReferrals) },
    { icon: DollarSign, label: "Earned", value: fmtMoney(earned) },
    { icon: Clock, label: "Pending", value: fmtMoney(pending) },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 md:py-14 space-y-10">
      {/* referral link */}
      <section className="rounded-3xl bg-emerald-950 text-white p-8 md:p-10 shadow-2xl">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300/60 mb-2">Your referral link</p>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight mb-6">
          Share it. Earn {fmtMoney(REWARD)} per funded referral.
        </h1>
        <CopyLink url={referralUrl} />
      </section>

      {/* stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div key={i} className="rounded-3xl border border-emerald-100 bg-white p-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center mb-4">
              <s.icon className="w-5 h-5 text-emerald-600" />
            </div>
            <p className="text-3xl font-black text-emerald-950 tracking-tight">{s.value}</p>
            <p className="text-xs font-black uppercase tracking-[0.15em] text-emerald-900/40 mt-1">{s.label}</p>
          </div>
        ))}
      </section>

      {/* referrals table */}
      <section className="rounded-3xl border border-emerald-100 bg-white overflow-hidden">
        <div className="px-6 py-5 border-b border-emerald-50">
          <h2 className="font-black text-emerald-950 uppercase tracking-tight">Your referrals</h2>
        </div>
        {leadRows.length === 0 ? (
          <div className="px-6 py-12 text-center text-emerald-900/40 font-bold">
            No referrals yet. Share your link to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-900/40">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Business</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {leadRows.map((l) => (
                  <tr key={l.id} className="border-t border-emerald-50 font-bold text-emerald-950">
                    <td className="px-6 py-4">{[l.first_name, l.last_name].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-6 py-4 text-emerald-900/60">{l.business_name || "—"}</td>
                    <td className="px-6 py-4">
                      <span className="inline-block rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs font-black uppercase tracking-wide">
                        {STATUS_LABELS[l.status] ?? l.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-emerald-900/60">{fmtDate(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* rewards table */}
      <section className="rounded-3xl border border-emerald-100 bg-white overflow-hidden">
        <div className="px-6 py-5 border-b border-emerald-50 flex items-center justify-between">
          <h2 className="font-black text-emerald-950 uppercase tracking-tight">Rewards</h2>
          <span className="text-sm font-black text-emerald-700">{fundedCount} funded</span>
        </div>
        {payoutRows.length === 0 ? (
          <div className="px-6 py-12 text-center text-emerald-900/40 font-bold">
            No rewards yet. You earn {fmtMoney(REWARD)} when a referral gets funded.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-900/40">
                  <th className="px-6 py-3">Reward</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {payoutRows.map((p) => (
                  <tr key={p.id} className="border-t border-emerald-50 font-bold text-emerald-950">
                    <td className="px-6 py-4">{fmtMoney(Number(p.commission_amount || 0))}</td>
                    <td className="px-6 py-4">
                      <span className="inline-block rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs font-black uppercase tracking-wide">
                        {PAYOUT_LABELS[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-emerald-900/60">{fmtDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
