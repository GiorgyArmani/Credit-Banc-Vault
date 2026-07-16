// src/app/advisor/dashboard/referrals/page.tsx
//
// Staff view of affiliate referral leads that haven't become vaults yet. This is
// the human pre-qualification step: advisors contact/qualify/disqualify a lead
// before creating a vault for it. Attribution to the affiliate is linked
// AUTOMATICALLY at vault creation, so there's no "convert" button here — staff
// just work the lead, then create the client through the normal speed/standard
// flow. Read via the service role (referral tables are RLS-locked).

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeadStatusButtons } from "./_components/lead-status-buttons";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function ReferralLeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const db = createAdminClient();

  // Pending, qualified referrals only — converted leads graduated to a vault and
  // disqualified ones were filtered out at intake.
  const { data: leads } = await db
    .from("referral_leads")
    .select("id, first_name, last_name, email, phone, business_name, status, created_at, loan_amount, fico_band, monthly_revenue, time_in_business, affiliates(first_name, last_name)")
    .neq("status", "converted")
    .neq("status", "disqualified")
    .order("created_at", { ascending: false });

  const rows = leads ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
          <Users className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-emerald-950 tracking-tight">Referral Leads</h1>
          <p className="text-emerald-900/50 font-bold text-sm">
            Pre-qualify affiliate referrals, then create a vault through the normal flow.
          </p>
        </div>
      </div>

      <div className="rounded-3xl border border-emerald-100 bg-white overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-emerald-900/40 font-bold">
            No pending referral leads right now.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-900/40">
                  <th className="px-6 py-3">Lead</th>
                  <th className="px-6 py-3">Contact</th>
                  <th className="px-6 py-3">Pre-qual</th>
                  <th className="px-6 py-3">Referred by</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l: any) => {
                  const aff = l.affiliates;
                  const affName = aff ? [aff.first_name, aff.last_name].filter(Boolean).join(" ") : "—";
                  return (
                    <tr key={l.id} className="border-t border-emerald-50 font-bold text-emerald-950 align-top">
                      <td className="px-6 py-4">
                        <div>{[l.first_name, l.last_name].filter(Boolean).join(" ") || "—"}</div>
                        <div className="text-emerald-900/50 text-sm">{l.business_name || ""}</div>
                        <div className="mt-1 inline-block rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-0.5 text-[10px] uppercase tracking-wide">
                          {l.status}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-emerald-900/70 text-sm">
                        <div>{l.email || "—"}</div>
                        <div>{l.phone || ""}</div>
                      </td>
                      <td className="px-6 py-4 text-emerald-900/70 text-sm">
                        <div><span className="text-emerald-900/40">Amount:</span> {l.loan_amount || "—"}</div>
                        <div><span className="text-emerald-900/40">FICO:</span> {l.fico_band || "—"}</div>
                        <div><span className="text-emerald-900/40">Revenue:</span> {l.monthly_revenue || "—"}</div>
                        <div><span className="text-emerald-900/40">TIB:</span> {l.time_in_business || "—"}</div>
                      </td>
                      <td className="px-6 py-4 text-emerald-900/70">{affName}</td>
                      <td className="px-6 py-4 text-emerald-900/60">{fmtDate(l.created_at)}</td>
                      <td className="px-6 py-4">
                        <LeadStatusButtons leadId={l.id} current={l.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
