// src/app/r/[code]/page.tsx
//
// PUBLIC affiliate referral landing + pre-qualification flow. Reached via an
// affiliate's referral link (/r/<referral_code>). Resolves the affiliate, bumps
// their link_clicks counter (usage tracking shown on the affiliate dashboard),
// and renders the lead-capture form. Unknown/suspended codes get a neutral page.
// All DB access is via the service role (these tables are RLS-locked; see the
// migration security note). See [[role_model]].

import { createAdminClient } from "@/lib/supabase/admin";
import { AffiliateLeadForm } from "@/components/affiliate-lead-form";

export const dynamic = "force-dynamic";

export default async function ReferralLandingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const db = createAdminClient();

  const { data: affiliate } = await db
    .from("affiliates")
    .select("id, status, link_clicks, first_name")
    .eq("referral_code", code)
    .maybeSingle();

  const active = affiliate && affiliate.status === "active";

  // Usage tracking: count this visit. Best-effort, non-atomic — fine for a
  // click counter (a lost increment under a race is acceptable).
  if (active) {
    await db
      .from("affiliates")
      .update({ link_clicks: (affiliate.link_clicks ?? 0) + 1 })
      .eq("id", affiliate.id);
  }

  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-cb-mint/15 via-cb-cream to-white" />
      <div className="absolute top-0 left-1/4 w-[60%] h-[60%] bg-cb-mint/10 blur-[130px] rounded-full animate-aurora" />

      <div className="container relative z-10 mx-auto px-4 py-16 md:py-24">
        <div className="max-w-2xl mx-auto">
          {active ? (
            // The form renders its own hero (and hides it once the booking
            // calendar takes over on qualify).
            <AffiliateLeadForm code={code} affiliateFirstName={affiliate?.first_name ?? null} />
          ) : (
            <div className="rounded-3xl bg-white border border-black/5 shadow-xl p-12 text-center">
              <h2 className="font-manrope text-2xl font-extrabold text-cb-ink mb-3">This link isn't active</h2>
              <p className="text-cb-gray font-medium">
                The referral link you used is no longer available. Please contact the person who shared it with you.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
