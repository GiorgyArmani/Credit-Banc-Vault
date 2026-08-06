// src/app/r/[code]/page.tsx
//
// PUBLIC affiliate referral landing + pre-qualification flow. Reached via an
// affiliate's referral link (/r/<referral_code>). Resolves the affiliate, bumps
// their link_clicks counter (usage tracking shown on the affiliate dashboard),
// and renders the lead-capture form. Unknown/suspended codes get a neutral page.
// All DB access is via the service role (these tables are RLS-locked; see the
// migration security note). See [[role_model]].
//
// This is a full landing page, not just a form: the visitor arrived from a
// friend's link with no prior exposure to Credit Banc, so the pre-qual form is
// followed by the funding process, an introduction, and what we fund. That
// body lives in ReferralLanding (client — it hides the marketing once the lead
// qualifies and the booking calendar takes over).

import { createAdminClient } from "@/lib/supabase/admin";
import { BrandHeader, BrandFooter } from "@/components/marketing/brand-chrome";
import { ReferralLanding } from "./_components/referral-landing";

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
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink selection:bg-cb-mint/20">
      {/* Logo links out to the marketing site, not to /: a cold lead has no
          reason to land on the Vault's document-management pitch. */}
      <BrandHeader href="https://creditbanc.io" />

      {active ? (
        <ReferralLanding
          code={code}
          affiliateFirstName={affiliate?.first_name ?? null}
        />
      ) : (
        // Dead link — no marketing, no funnel. Just tell them and stop.
        <section className="relative w-full overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-cb-mint/15 via-cb-cream to-white" />
          <div className="absolute left-1/4 top-0 h-[60%] w-[60%] animate-aurora rounded-full bg-cb-mint/10 blur-[130px]" />
          <div className="container relative z-10 mx-auto px-4 py-24 md:py-32">
            <div className="mx-auto max-w-2xl rounded-3xl border border-black/5 bg-white p-12 text-center shadow-xl">
              <h2 className="font-manrope mb-3 text-2xl font-extrabold text-cb-ink">
                This link isn&rsquo;t active
              </h2>
              <p className="font-medium text-cb-gray">
                The referral link you used is no longer available. Please contact
                the person who shared it with you.
              </p>
            </div>
          </div>
        </section>
      )}

      <BrandFooter />
    </div>
  );
}
