"use client";

// Top-of-page hero for /r/<code>, built to marketing's spec: gold band, copy
// left, big image right.
//
// This replaced a port of the creditbanc.io hero ("Funding Is Our Favorite F
// Word", typed sub-line, orbiting stat cards). That angle led with what Credit
// Banc is; this one leads with the person who sent them — which is the only
// reason this visitor clicked anything. The site's own pitch still gets made
// further down the page, in MetricsStrip, WhatWeDo and FundingToolbox.

import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { CTA } from "@/components/marketing/brand-chrome";
import { cn } from "@/lib/utils";
import { MetricsRow } from "./metrics-row";
import { BAND_MIN_H } from "./band";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

// Marketing asked for gold/yellow. It is NOT a brand token — creditbanc.io's
// palette is mint / navy / cream — so it lives here as one constant to swap
// rather than being scattered through the markup or added to the theme.
const GOLD_BAND =
  "linear-gradient(135deg, #F3B518 0%, #F8CE5B 48%, #FCE7A8 100%)";

// Marketing's dedicated hero asset (replaced the step-1.png collage that stood
// in before one existed). Cut out on a transparent background on purpose, so it
// sits directly on the gold band with no card or panel behind it.
//
// Renamed on the way in: it arrived as "Cue the confetti. Your referral
// funded.png", which is the name of an affiliate *email* hero — and
// email.ts:2429 really does wire "Your referral funded.png" into that send. Two
// unrelated assets a space apart in the same folder was a wrong-image bug
// waiting to happen.
const HERO_IMAGE = {
  src: "/referral-hero-owner.png",
  alt: "A smiling business owner on the phone",
};

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};
const item = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

export function ReferralHero({
  affiliateFirstName,
}: {
  affiliateFirstName: string | null;
}) {
  // Reads naturally either way: "Jorge thought…" or "Someone thought…", which
  // also keeps the sub-line agreeing with the headline when the name is absent.
  const referrer = affiliateFirstName?.trim() || "Someone";

  return (
    // min-h + items-center makes this a deliberate full-screen band with its
    // content optically centered. Without it the section was only as tall as
    // the image column, which left a slab of empty gold under the copy and
    // pushed the metrics to sit awkwardly on the fold.
    <section
      className={`relative flex w-full items-center overflow-hidden ${BAND_MIN_H}`}
      style={{ background: GOLD_BAND }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 top-0 h-[420px] w-[420px] rounded-full bg-white/25 blur-3xl"
      />

      {/* Wider than the max-w-7xl the rest of the page uses: this is the one
          full-bleed band, and at large viewports 1280px left the art stranded
          in the middle with a lot of idle gold either side. */}
      {/* Padding is deliberately tight. Everything in this band — copy, art and
          the figures — has to clear one viewport, and the section is
          min-h-screen, so any slack here pushes the metrics under the fold. */}
      <div className="relative z-10 mx-auto w-full max-w-[88rem] px-6 py-10 sm:px-8 md:py-14">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr]">
          {/* copy */}
          <motion.div variants={container} initial="hidden" animate="visible">
            {/* leading-[1.15] rather than 1.05: the highlight block below is a
                full-height bar behind its line, so the line above needs real
                air or its descenders sit inside it. The block's inset is in
                `em` for the same reason — a fixed px inset reads as clearance
                at 48px type and as a collision at 96px. */}
            <motion.h1
              variants={item}
              className="font-headline text-5xl font-extrabold leading-[1.1] tracking-tight text-on-secondary-fixed sm:text-6xl lg:text-7xl xl:text-8xl"
            >
              Someone Thinks We{" "}
              <span className="relative inline-block px-3 text-white">
                {/* White on mint, matching the creditbanc.io hero. Note this is
                    about 1.9:1 and fails WCAG even at display sizes — the rest
                    of the brand deliberately uses navy-on-mint for that reason
                    (see primary.foreground in tailwind.config.ts). Kept white
                    here as an explicit call to match the marketing site. */}
                <motion.span
                  aria-hidden
                  className="absolute inset-y-[0.12em] left-0 right-0 -z-10 rounded-sm bg-primary-container"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.7, delay: 1.1, ease: EASE }}
                  style={{ originX: 0 }}
                />
                <span className="relative">Should Talk.</span>
              </span>
            </motion.h1>

            <motion.p
              variants={item}
              className="mt-6 max-w-2xl text-xl leading-relaxed text-on-secondary-fixed/75 md:text-2xl"
            >
              <span className="font-bold text-on-secondary-fixed">
                {referrer}
              </span>{" "}
              thought Credit Banc might be able to help with the money side of
              running or growing your business. We think they may be onto
              something.
            </motion.p>

            <motion.div
              variants={item}
              className="mt-8 flex flex-col items-start gap-3"
            >
              {/* Deliberately larger than CTA.primary's default 8/4 padding:
                  this is the one action the whole band exists to drive, and at
                  the base size it read as a footnote under a 96px headline.
                  cn() rather than string concat so tailwind-merge drops the
                  token's px-8/py-4 instead of leaving both to CSS order. */}
              <a
                href="#prequal"
                className={cn(CTA.primary, "gap-3 px-10 py-5 text-lg sm:px-12 sm:py-6 sm:text-xl")}
              >
                Let&rsquo;s Do This
                <ArrowRight className="h-6 w-6 sm:h-7 sm:w-7" />
              </a>
              <p className="text-sm font-semibold text-on-secondary-fixed/60">
                Takes just a few minutes. No impact on your credit score.
              </p>
            </motion.div>
          </motion.div>

          {/* the image */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.2, ease: EASE }}
            // Height-capped rather than aspect-driven on desktop. At 8/7 the
            // art was the tallest thing in the band and set the row height on
            // its own, which is what pushed the figures off the fold.
            //
            // Bottom-aligned and bled into the metrics gap, rather than centred
            // in its cell. A cut-out figure on a transparent background with
            // empty band above AND below it reads as floating — it needs a
            // ground line, and the metrics hairline is the one already there.
            // `self-end` overrides the grid's items-center for this cell,
            // -mb-10 cancels MetricsRow's mt-10 so the art's bottom edge lands
            // exactly on the rule, and object-bottom keeps the figure sitting
            // on it as the box grows.
            //
            // 66vh, up from 60: height is what binds here, not width (the
            // column is wider than the art needs at this ratio), so vh is the
            // lever. Kept modest on purpose — the band is min-h-screen and the
            // figures below have to clear the fold, and the 2.5rem reclaimed by
            // the negative margin is most of what paid for the increase.
            // Below lg it keeps its natural ratio, the column being full width.
            className="relative mx-auto aspect-[8/7] w-full max-w-xl lg:aspect-auto lg:-mb-10 lg:h-[66vh] lg:max-h-[720px] lg:max-w-none lg:self-end"
          >
            <Image
              src={HERO_IMAGE.src}
              alt={HERO_IMAGE.alt}
              fill
              priority
              sizes="(max-width: 1024px) 92vw, 52vw"
              className="object-contain object-bottom drop-shadow-[0_30px_50px_rgba(0,3,33,0.22)]"
            />
          </motion.div>
        </div>

        {/* The figures live in the band rather than in a strip of their own —
            they fill the space under the copy that the tall hero opened up, and
            the hairline is the only separation they need. */}
        <MetricsRow className="mt-10 border-t border-on-secondary-fixed/10 pt-8" />
      </div>
    </section>
  );
}
