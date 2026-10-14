// src/app/partner/webinars/page.tsx
//
// Recordings of our live partner sessions. Access is enforced by
// src/app/partner/layout.tsx (referral_partner / partner_advisor / admin, plus
// the Tier 2 onboarding takeover) — this page only renders after that passes.
// Spec: docs/superpowers/specs/2026-10-14-partner-webinars-design.md

import { listPublishedWebinars } from "@/lib/webinars";
import { WebinarLibrary } from "./_components/webinar-library";

export const dynamic = "force-dynamic";
export const metadata = { title: "Webinars — Credit Banc" };

export default async function PartnerWebinarsPage() {
  const { webinars, degraded } = await listPublishedWebinars();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-headline text-2xl font-extrabold tracking-tight text-cb-ink">Webinars</h1>
      <p className="mt-1 text-sm text-cb-gray">Recordings of our live sessions for referral partners.</p>
      <div className="mt-6">
        <WebinarLibrary webinars={webinars} degraded={degraded} />
      </div>
    </div>
  );
}
