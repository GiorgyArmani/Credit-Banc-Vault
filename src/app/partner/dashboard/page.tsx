// src/app/partner/dashboard/page.tsx
//
// Level-2 referral-partner portal: the partner's link, the clients they've
// referred, and where each one sits.
//
// WHAT IS DELIBERATELY NOT HERE:
//   - No commissions. The rate is still being negotiated; the ledger is being
//     written server-side (referral_partner_commissions) so nothing is lost,
//     but showing an unpriced or provisional dollar figure to a CPA is worse
//     than showing none. Turning it on later is a change to this file only.
//   - No client contact details. A partner who can email the business directly
//     can work around us, and they already know the person they referred.
//   - No advisor, no notes, no lender, no funded amounts, no internal statuses.
//     See src/lib/partner-pipeline.ts for the 9→5 stage collapse.
//
// Reads go through the SERVICE ROLE, scoped in code to the partner resolved
// from the session — referral_partners is RLS-locked with zero policies and its
// anon/authenticated grants are revoked (migration 20260807). The layout has
// already gated the role; this page still resolves the partner from
// auth.getUser() rather than anything client-supplied.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CopyLink } from "@/components/copy-link";
import { partnerReferralUrl } from "@/lib/referral-partners";
import { partnerStageFor } from "@/lib/partner-pipeline";
import { PartnerProgress } from "./_components/partner-progress";
import { Users, TrendingUp, CheckCircle2, XCircle, LinkIcon } from "lucide-react";
import clsx from "clsx";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase() || "?";
}

export default async function PartnerDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const db = createAdminClient();

  const { data: partner } = await db
    .from("referral_partners")
    .select("id, name, slug, active, portal_enabled, password_set_at")
    .eq("user_id", user.id)
    .maybeSingle();

  // An admin (who bypasses the role guard) or a partner whose profile hasn't
  // been linked yet still gets a sane page rather than a crash.
  if (!partner) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="rounded-3xl border border-black/5 bg-white p-10 text-center shadow-sm">
          <h1 className="font-manrope text-2xl font-extrabold text-cb-ink mb-2">
            No partner profile
          </h1>
          <p className="text-cb-ink/50">
            This account isn&apos;t linked to a referral partner yet.
          </p>
        </div>
      </div>
    );
  }

  // Access can be paused without tearing down the login — the partner keeps
  // their referrals, their link and their history, they just can't see the
  // dashboard. Checked here rather than in the layout because the layout
  // doesn't resolve the partner row.
  if (partner.portal_enabled === false) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="rounded-3xl border border-black/5 bg-white p-10 text-center shadow-sm">
          <h1 className="font-manrope text-2xl font-extrabold text-cb-ink mb-2">
            Portal access paused
          </h1>
          <p className="text-cb-ink/50">
            Your referrals are still tracked. Contact{" "}
            <a href="mailto:support@creditbanc.io" className="underline">
              support@creditbanc.io
            </a>{" "}
            to restore access.
          </p>
        </div>
      </div>
    );
  }

  // Onboarding isn't finished until they've chosen a password. Enforced here as
  // well as on the link itself, so a partner who bookmarks the dashboard mid-flow
  // still lands on the step rather than skipping it permanently.
  if (!partner.password_set_at) {
    redirect("/partner/welcome");
  }

  // Stamp the visit so admins can see who has actually activated their portal.
  // Fire-and-forget: a failed timestamp must never cost the partner their page.
  void db
    .from("referral_partners")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", partner.id)
    .then(undefined, () => {});

  // The partner's book of business. ONLY the four fields they're cleared to see.
  const { data: clients } = await db
    .from("client_data_vault")
    .select("id, client_name, company_name, created_at")
    .eq("referral_partner_id", partner.id)
    .order("created_at", { ascending: false });

  const clientRows = clients ?? [];

  // Current stage per client = newest loan_status_history row. Done as one
  // bulk read rather than getBulkLatestStatus(), which uses the user-scoped
  // client and would return an empty map for a non-staff caller under RLS.
  const statusByVault = new Map<string, string>();
  if (clientRows.length) {
    const { data: history } = await db
      .from("loan_status_history")
      .select("client_vault_id, status, created_at")
      .in(
        "client_vault_id",
        clientRows.map((c) => c.id)
      )
      .order("created_at", { ascending: false });

    for (const row of history ?? []) {
      // Descending order means the first row seen per vault is the latest.
      if (!statusByVault.has(row.client_vault_id)) {
        statusByVault.set(row.client_vault_id, row.status);
      }
    }
  }

  const rows = clientRows.map((c) => {
    const status = statusByVault.get(c.id) ?? "created";
    return { ...c, status, stage: partnerStageFor(status) };
  });

  const total = rows.length;
  const funded = rows.filter((r) => r.stage.tone === "won").length;
  const lost = rows.filter((r) => r.stage.tone === "lost").length;
  const inProgress = total - funded - lost;

  const stats = [
    { icon: Users, label: "Referrals", value: String(total), accent: false },
    { icon: TrendingUp, label: "In progress", value: String(inProgress), accent: false },
    { icon: CheckCircle2, label: "Funded", value: String(funded), accent: true },
    { icon: XCircle, label: "Not a fit", value: String(lost), accent: false },
  ];

  const referralUrl = partner.slug ? partnerReferralUrl(partner.slug) : null;

  return (
    <div id="overview" className="max-w-6xl mx-auto px-4 py-10 md:py-14">
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
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-cb-gray mt-1">
                  {s.label}
                </p>
              </div>
            ))}
          </section>

          {/* referrals table */}
          <section
            id="referrals"
            className="scroll-mt-24 rounded-3xl border border-black/5 bg-white overflow-hidden shadow-sm"
          >
            <div className="px-6 py-5 border-b border-black/5">
              <h2 className="font-manrope font-extrabold text-cb-ink uppercase tracking-tight">
                Your referrals
              </h2>
              <p className="text-xs text-cb-ink/40 mt-1">
                We handle the paperwork. This is where each file sits today.
              </p>
            </div>

            {rows.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-cb-mint/10 flex items-center justify-center mb-3">
                  <Users className="w-6 h-6 text-cb-mint" />
                </div>
                <p className="text-cb-ink/50 font-medium">
                  No referrals yet. Share your link to get started.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-[0.15em] text-cb-gray border-b border-black/5">
                      <th className="px-6 py-3">Client</th>
                      <th className="px-6 py-3">Business</th>
                      <th className="px-6 py-3">Referred</th>
                      <th className="px-6 py-3">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t border-black/5 hover:bg-cb-cream/40 transition-colors align-top"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-cb-mint/10 text-cb-mint flex items-center justify-center text-xs font-bold shrink-0">
                              {initials(r.client_name)}
                            </div>
                            <span className="font-bold text-cb-ink">
                              {r.client_name || "—"}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-cb-ink/60 font-medium">
                          {r.company_name || "—"}
                        </td>
                        <td className="px-6 py-4 text-cb-ink/50 font-medium whitespace-nowrap">
                          {fmtDate(r.created_at)}
                        </td>
                        <td className="px-6 py-4">
                          <PartnerProgress status={r.status} />
                          <p className="mt-1 text-[11px] text-cb-ink/40 max-w-[220px]">
                            {r.stage.blurb}
                          </p>
                        </td>
                      </tr>
                    ))}
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
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cb-mint/70 mb-2">
                Your referral link
              </p>
              <h2 className="font-manrope text-xl font-extrabold tracking-tight mb-5 leading-snug">
                Send it over. <span className="text-cb-mint">We take it from there.</span>
              </h2>

              {referralUrl ? (
                <CopyLink
                  url={referralUrl}
                  message={`I work with Credit Banc on business funding — they handle the whole process. Start here:`}
                  subject="Business funding through Credit Banc"
                />
              ) : (
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/70">
                  <LinkIcon className="w-4 h-4 mb-2 text-cb-mint" />
                  Your personal link isn&apos;t set up yet. Referrals recorded under
                  your name still appear here — reach out and we&apos;ll issue one.
                </div>
              )}
            </div>
          </div>

          <p className="mt-4 px-2 text-[11px] leading-relaxed text-cb-ink/40">
            Anyone who applies through your link is tracked to you automatically.
            Questions on a file?{" "}
            <a href="mailto:support@creditbanc.io" className="underline hover:text-cb-ink/70">
              support@creditbanc.io
            </a>
          </p>
        </aside>
      </div>
    </div>
  );
}
