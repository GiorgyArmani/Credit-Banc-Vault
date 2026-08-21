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
import { CopyLink } from "@/components/copy-link";
import { MousePointerClick, Users, DollarSign, Clock } from "lucide-react";
import clsx from "clsx";

export const dynamic = "force-dynamic";

const REWARD = Number(process.env.AFFILIATE_COMMISSION_AMOUNT ?? 500);

// Lead status → affiliate-facing label + pill colors.
const STATUS_META: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-amber-50 text-amber-600" },
  contacted: { label: "Contacted", cls: "bg-violet-50 text-violet-600" },
  qualified: { label: "Qualified", cls: "bg-blue-50 text-blue-600" },
  converted: { label: "In progress", cls: "bg-cb-mint/10 text-cb-mint" },
  disqualified: { label: "Not a fit", cls: "bg-cb-gray/10 text-cb-gray" },
};

// Not a `status` value — booking is tracked on affiliate_leads.booked_at,
// stamped by POST /api/webhooks/ghl-appointment when GHL reports the
// appointment. See [[affiliate_lead_qualified_is_not_booked]].
const BOOKED_META = { label: "Booked", cls: "bg-emerald-50 text-emerald-600" };

// Also not a `status` value. affiliate_leads.status has a CHECK constraint that
// stops at 'converted' — there is no 'funded' lead status and adding one would
// duplicate a fact the payout row already owns. So funding is derived: a lead
// with a non-canceled affiliate_payouts row IS funded, by the same rule the
// "N funded" counter on the rewards card uses.
//
// Without this the affiliate watched their reward go out while the referral
// that earned it still read "In progress" — the deal is done, and the row has
// to say so. Solid mint on navy: the terminal, celebratory state, and the one
// pill on the table that isn't a tint.
const FUNDED_META = { label: "Funded", cls: "bg-cb-mint text-cb-navy" };

// Payout status → affiliate-facing label (`failed` shown as the softer
// "Processing" so partners never see a raw failure) + pill colors.
// The affiliate never needs to see our internal review machinery — a queued,
// pending or retrying payout is all the same thing from their side: on its way.
const PAYOUT_META: Record<string, { label: string; cls: string }> = {
  queued: { label: "Processing", cls: "bg-amber-50 text-amber-600" },
  pending: { label: "Pending", cls: "bg-amber-50 text-amber-600" },
  sent: { label: "Sent", cls: "bg-cb-mint/10 text-cb-mint" },
  delivered: { label: "Delivered", cls: "bg-cb-mint/10 text-cb-mint" },
  failed: { label: "Processing", cls: "bg-amber-50 text-amber-600" },
  canceled: { label: "Canceled", cls: "bg-cb-gray/10 text-cb-gray" },
};

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function initials(first?: string | null, last?: string | null): string {
  const a = (first ?? "").trim()[0] ?? "";
  const b = (last ?? "").trim()[0] ?? "";
  return (a + b).toUpperCase() || "?";
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
        <div className="rounded-3xl border border-black/5 bg-white p-10 text-center shadow-sm">
          <h1 className="font-manrope text-2xl font-extrabold text-cb-ink mb-2">No affiliate profile</h1>
          <p className="text-cb-ink/50">This account isn't set up as an affiliate.</p>
        </div>
      </div>
    );
  }

  // booked_at is selected separately from the rest of the row because it arrives
  // with migration 20260814_affiliate_lead_booked_at, which trails the code to
  // production. A single select naming a column the database doesn't have yet
  // fails the WHOLE query — the affiliate would see "No referrals yet" rather
  // than a missing pill. So: ask for it, and fall back to the pre-migration
  // shape if it isn't there. Delete the fallback once the migration is applied
  // everywhere. See [[refactor_alongside_production]].
  // The column list is built at runtime, so name the shape we rely on —
  // a dynamic select string erases supabase-js's inferred row type.
  type LeadRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    business_name: string | null;
    status: string;
    created_at: string;
    /** Matched against affiliate_payouts.client_vault_id to derive Funded. */
    converted_vault_id: string | null;
    /** Absent until migration 20260814 is applied. */
    booked_at?: string | null;
  };

  const leadColumns = "id, first_name, last_name, business_name, status, created_at, converted_vault_id";
  const selectLeads = (columns: string) =>
    db
      .from("affiliate_leads")
      .select(columns)
      .eq("affiliate_id", affiliate.id)
      .order("created_at", { ascending: false });

  const [leadsResult, { data: payouts }] = await Promise.all([
    (async (): Promise<LeadRow[]> => {
      const withBooked = await selectLeads(`${leadColumns}, booked_at`);
      if (!withBooked.error) return (withBooked.data ?? []) as unknown as LeadRow[];
      console.warn(
        "[affiliate/dashboard] booked_at unavailable — falling back (apply migration 20260814_affiliate_lead_booked_at):",
        withBooked.error.message
      );
      const { data } = await selectLeads(leadColumns);
      return (data ?? []) as unknown as LeadRow[];
    })(),
    db
      .from("affiliate_payouts")
      .select("id, commission_amount, status, created_at, affiliate_lead_id, client_vault_id")
      .eq("affiliate_id", affiliate.id)
      .order("created_at", { ascending: false }),
  ]);
  const leads = leadsResult;


  const leadRows = leads ?? [];
  const payoutRows = payouts ?? [];

  const totalReferrals = leadRows.length;
  // A canceled payout is a deal that didn't hold up — don't count it as funded.
  const fundedPayouts = payoutRows.filter((p) => p.status !== "canceled");
  const fundedCount = fundedPayouts.length;

  // Which referrals actually funded, for the Funded pill in the table below.
  // Two ways in on purpose: affiliate_lead_id is the direct link, but a payout
  // created from a vault whose lead was matched later can carry only the vault
  // id — and both point at the same funded deal. Matching on either keeps a
  // real funding from silently reading as "In progress".
  const fundedLeadIds = new Set(fundedPayouts.map((p) => p.affiliate_lead_id).filter(Boolean));
  const fundedVaultIds = new Set(fundedPayouts.map((p) => p.client_vault_id).filter(Boolean));
  const earned = payoutRows
    .filter((p) => p.status === "sent" || p.status === "delivered")
    .reduce((sum, p) => sum + Number(p.commission_amount || 0), 0);
  // Everything still on its way: queued behind the 24h review window, or a send
  // the system is retrying.
  const pending = payoutRows
    .filter((p) => p.status === "queued" || p.status === "pending" || p.status === "failed")
    .reduce((sum, p) => sum + Number(p.commission_amount || 0), 0);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
  const referralUrl = `${appUrl}/r/${affiliate.referral_code}`;

  const stats = [
    { icon: MousePointerClick, label: "Link clicks", value: String(affiliate.link_clicks ?? 0), accent: false },
    { icon: Users, label: "Referrals", value: String(totalReferrals), accent: false },
    { icon: DollarSign, label: "Earned", value: fmtMoney(earned), accent: true },
    { icon: Clock, label: "Pending", value: fmtMoney(pending), accent: false },
  ];

  // first_name is nullable, and "Welcome," with nothing after it reads as a bug.
  const greetingName = (affiliate.first_name ?? "").trim();

  return (
    <div id="overview" className="max-w-6xl mx-auto px-4 py-10 md:py-14">
      <header className="mb-8 md:mb-10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-cb-gray">Affiliate program</p>
        <h1 className="font-manrope text-4xl md:text-5xl font-extrabold tracking-tight text-cb-ink mt-2">
          {greetingName ? (
            <>
              Welcome, <span className="text-cb-mint">{greetingName}</span>
            </>
          ) : (
            "Welcome back"
          )}
        </h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 items-start">
      {/* main column */}
      <div className="order-2 lg:order-1 space-y-8">
      {/* stats */}
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div
            key={i}
            className={clsx(
              "rounded-3xl border p-6 transition-shadow hover:shadow-md",
              s.accent ? "border-cb-mint/30 bg-cb-mint/5" : "border-black/5 bg-white"
            )}
          >
            <div
              className={clsx(
                "w-10 h-10 rounded-xl flex items-center justify-center mb-4",
                s.accent ? "bg-cb-mint text-cb-navy" : "bg-cb-mint/10 text-cb-mint"
              )}
            >
              <s.icon className="w-5 h-5" />
            </div>
            <p
              className={clsx(
                "font-manrope text-3xl font-extrabold tracking-tight",
                s.accent ? "text-cb-mint" : "text-cb-ink"
              )}
            >
              {s.value}
            </p>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-cb-gray mt-1">{s.label}</p>
          </div>
        ))}
      </section>

      {/* referrals table */}
      <section id="referrals" className="scroll-mt-24 rounded-3xl border border-black/5 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-black/5">
          <h2 className="font-manrope font-extrabold text-cb-ink uppercase tracking-tight">Your referrals</h2>
        </div>
        {leadRows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-cb-mint/10 flex items-center justify-center mb-3">
              <Users className="w-6 h-6 text-cb-mint" />
            </div>
            <p className="text-cb-ink/50 font-medium">No referrals yet. Share your link to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.15em] text-cb-gray border-b border-black/5">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Business</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {leadRows.map((l) => {
                  // A lead who actually booked a call is further along than one
                  // who merely passed the pre-qual and closed the tab at the
                  // calendar — and "Qualified" reads as the same thing for both.
                  // `converted` outranks it: they already have a vault.
                  //
                  // Funded outranks everything: it's the end of the road, and
                  // the lead's own status column never advances past
                  // 'converted' to say so.
                  const isFunded =
                    fundedLeadIds.has(l.id) ||
                    (!!l.converted_vault_id && fundedVaultIds.has(l.converted_vault_id));
                  const meta = isFunded
                    ? FUNDED_META
                    : l.booked_at && l.status !== "converted"
                      ? BOOKED_META
                      : STATUS_META[l.status] ?? { label: l.status, cls: "bg-cb-gray/10 text-cb-gray" };
                  return (
                    <tr key={l.id} className="border-t border-black/5 hover:bg-cb-cream/40 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-cb-mint/10 text-cb-mint flex items-center justify-center text-xs font-bold shrink-0">
                            {initials(l.first_name, l.last_name)}
                          </div>
                          <span className="font-bold text-cb-ink">
                            {[l.first_name, l.last_name].filter(Boolean).join(" ") || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-cb-ink/60 font-medium">{l.business_name || "—"}</td>
                      <td className="px-6 py-4">
                        <span className={clsx("inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide", meta.cls)}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-cb-ink/50 font-medium">{fmtDate(l.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* rewards table */}
      <section id="rewards" className="scroll-mt-24 rounded-3xl border border-black/5 bg-white overflow-hidden shadow-sm">
        <div className="px-6 py-5 border-b border-black/5 flex items-center justify-between">
          <h2 className="font-manrope font-extrabold text-cb-ink uppercase tracking-tight">Rewards</h2>
          <span className="text-sm font-bold text-cb-mint">{fundedCount} funded</span>
        </div>
        {payoutRows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-cb-mint/10 flex items-center justify-center mb-3">
              <DollarSign className="w-6 h-6 text-cb-mint" />
            </div>
            <p className="text-cb-ink/50 font-medium">You earn {fmtMoney(REWARD)} when a referral gets funded.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.15em] text-cb-gray border-b border-black/5">
                  <th className="px-6 py-3">Reward</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {payoutRows.map((p) => {
                  const meta = PAYOUT_META[p.status] ?? { label: p.status, cls: "bg-cb-gray/10 text-cb-gray" };
                  return (
                    <tr key={p.id} className="border-t border-black/5 hover:bg-cb-cream/40 transition-colors">
                      <td className="px-6 py-4 font-manrope font-extrabold text-cb-ink">{fmtMoney(Number(p.commission_amount || 0))}</td>
                      <td className="px-6 py-4">
                        <span className={clsx("inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide", meta.cls)}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-cb-ink/50 font-medium">{fmtDate(p.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>

      {/* referral / share side panel */}
      <aside id="refer" className="order-1 lg:order-2 lg:sticky lg:top-20">
        <div className="relative overflow-hidden rounded-3xl bg-cb-navy text-white p-7 shadow-2xl">
          <div className="absolute top-0 right-0 w-56 h-56 bg-cb-mint/10 blur-[100px] rounded-full -mr-16 -mt-16 pointer-events-none" />
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cb-mint/70 mb-2">Your referral link</p>
            <h2 className="font-manrope text-xl font-extrabold tracking-tight mb-5 leading-snug">
              Share it. Earn <span className="text-cb-mint">{fmtMoney(REWARD)}</span> per funded referral.
            </h2>
            <CopyLink url={referralUrl} />
          </div>
        </div>
      </aside>
      </div>
    </div>
  );
}
