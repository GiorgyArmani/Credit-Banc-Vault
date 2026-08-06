"use client";

// Body of the referral landing page for an ACTIVE affiliate link.
//
// A referred owner lands here from a friend's text, not from creditbanc.io —
// they have no idea who we are. So the page explains first and asks second:
// hero → the numbers → what we do → the pre-qual form.
//
// Four explainers were cut on marketing's call along the way: a ValueProp
// step-through, WhoWeAre pillars, a funding-product card grid, and a required-
// documents panel. Each restated something WhatWeDo or the hero already says.
// The hero's "Let's Do This" is now the page's only CTA above the form.
//
// Client component for two reasons: the form's heading retires once the lead
// qualifies (a "not sure what you need?" pitch over a booking calendar they've
// already earned reads badly), and qualifying scrolls the page down to that
// calendar, which is well below the fold by then.

import { useState } from "react";
import { AffiliateLeadForm } from "@/components/affiliate-lead-form";
import { Eyebrow } from "@/components/marketing/brand-chrome";
import { ReferralHero } from "./referral-hero";
import { WhatWeDo } from "./what-we-do";
import { BAND_MIN_H_LG } from "./band";

export function ReferralLanding({
  code,
  affiliateFirstName,
}: {
  code: string;
  affiliateFirstName: string | null;
}) {
  const [qualified, setQualified] = useState(false);

  const handleQualified = () => {
    setQualified(true);
    // The form sits at the foot of a long page; without this the calendar
    // renders somewhere off-screen and the visitor thinks nothing happened.
    requestAnimationFrame(() => {
      document
        .getElementById("prequal")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <>
      {/* hero — renders its own gold band, so no cream backdrop here */}
      <ReferralHero affiliateFirstName={affiliateFirstName} />

      {/* the explainer — the numbers now sit inside the hero band above */}
      <WhatWeDo />

      {/* the form — the whole page points here */}
      {/* min-h matches the bands above so the page scrolls in whole screens.
          It is a floor, not a cap — this section outgrows it as the visitor
          steps through the form, and again when the booking calendar lands. */}
      <section
        id="prequal"
        className={`relative flex w-full items-center overflow-hidden scroll-mt-24 bg-white ${BAND_MIN_H_LG}`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-cb-mint/10 to-transparent"
        />
        <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-20 md:py-28">
          {!qualified && (
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <Eyebrow className="mb-4">Let&rsquo;s See Where You Stand</Eyebrow>
              <h2 className="font-headline text-3xl font-extrabold leading-tight tracking-tight text-cb-ink md:text-5xl">
                Not sure what kind of funding you need?{" "}
                <span className="text-cb-mint">That&rsquo;s the point.</span>
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-cb-ink/60">
                Answer a few questions and we&rsquo;ll tell you where you stand — no
                impact to your credit, and no obligation to do anything with the
                answer.
              </p>
            </div>
          )}

          <div className="mx-auto max-w-2xl">
            <AffiliateLeadForm
              code={code}
              affiliateFirstName={affiliateFirstName}
              onQualified={handleQualified}
              showHero={false}
            />
          </div>
        </div>
      </section>
    </>
  );
}
