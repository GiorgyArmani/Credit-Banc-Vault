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
import { MetricsRow } from "./metrics-row";
import { BAND_MIN_H } from "./band";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

// Marketing asked for gold/yellow. It is NOT a brand token — creditbanc.io's
// palette is mint / navy / cream — so it lives here as one constant to swap
// rather than being scattered through the markup or added to the theme.
const GOLD_BAND =
  "linear-gradient(135deg, #F3B518 0%, #F8CE5B 48%, #FCE7A8 100%)";

// The only hero-scale artwork in the repo is the four step collages. This is
// the one that reads as "owner looking for money", which is where this
// visitor is standing. Swap the path if marketing supplies a dedicated asset.
const HERO_IMAGE = {
  src: "/step-1.png",
  alt: "Business owner searching for a small business loan on his phone",
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
              <a href="#prequal" className={`${CTA.primary} text-base`}>
                Let&rsquo;s Do This
                <ArrowRight className="h-5 w-5" />
              </a>
              <p className="text-sm font-semibold text-on-secondary-fixed/60">
                Takes about 30 seconds. No impact to your credit.
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
            // 60vh is sized off the copy column, not picked by eye: the grid is
            // items-center, so anything up to the copy's own height is free —
            // the row doesn't grow and the metrics stay above the fold. Height
            // is what binds here, not width; the column is wider than the art
            // needs at this ratio, so raising vh is the lever, not the columns.
            // Below lg it keeps its natural ratio, the column being full width.
            className="relative mx-auto aspect-[8/7] w-full max-w-xl lg:aspect-auto lg:h-[60vh] lg:max-h-[640px] lg:max-w-none"
          >
            <Image
              src={HERO_IMAGE.src}
              alt={HERO_IMAGE.alt}
              fill
              priority
              sizes="(max-width: 1024px) 92vw, 52vw"
              className="object-contain drop-shadow-[0_30px_50px_rgba(0,3,33,0.22)]"
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
