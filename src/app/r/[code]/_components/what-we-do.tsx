// "So, What Exactly Does Credit Banc Do?" — the plain-language answer, sitting
// directly under the metrics strip. The visitor arrived because a friend sent a
// link; this is the first thing that tells them what they were sent to.
//
// Copy is marketing's, verbatim. Layout follows the main site's split band —
// two edge-to-edge panels, green under the image, white under the copy — using
// step-3.png (the advisor and owner comparing SBA / term loan / LOC / equipment
// options), which is the collage that actually depicts the sentence being read.

import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { CTA, Eyebrow } from "@/components/marketing/brand-chrome";
import { Reveal } from "@/components/ui/reveal";
import { BAND_MIN_H_LG } from "./band";

// Runs vertically, opposite to the metrics strip's 120deg, so the two greens
// meet at a visible seam instead of bleeding into one L-shaped block.
const GREEN_PANEL = "linear-gradient(180deg, #2ea878 0%, #1f6b4e 100%)";

export function WhatWeDo() {
  return (
    // No max-width container: each panel has to reach its own edge of the
    // viewport for the split to read. The copy is re-constrained inside.
    <section id="what-we-do" className={`grid lg:grid-cols-2 ${BAND_MIN_H_LG}`}>
      {/* image — green panel, left */}
      <div
        className="flex items-center justify-center px-6 py-16 sm:px-10 lg:py-24"
        style={{ background: GREEN_PANEL }}
      >
        <Reveal direction="right" className="w-full">
          {/* Bigger than it was: the band is a full screen tall now, and at
              max-w-xl the art floated in a lot of empty green. */}
          <div className="relative mx-auto aspect-[8/7] w-full max-w-xl lg:max-w-2xl">
            <Image
              src="/step-3.png"
              alt="A Credit Banc advisor and a business owner comparing SBA, term loan, line of credit and equipment financing options"
              fill
              sizes="(max-width: 1024px) 88vw, 44vw"
              className="object-contain drop-shadow-[0_30px_50px_rgba(0,3,33,0.28)]"
            />
          </div>
        </Reveal>
      </div>

      {/* copy — white panel, right */}
      <div className="flex items-center bg-white px-6 py-16 sm:px-10 lg:px-16 lg:py-24">
        <Reveal className="mx-auto w-full max-w-xl lg:mx-0">
          <Eyebrow className="mb-4">What We Do</Eyebrow>
          <h2 className="font-headline text-3xl font-extrabold leading-tight tracking-tight text-cb-ink md:text-5xl">
            So, What Exactly Does{" "}
            <span className="text-cb-mint">Credit Banc</span> Do?
          </h2>

          <p className="mt-6 text-lg leading-relaxed text-cb-ink/60">
            Here&rsquo;s the short version: Credit Banc helps business owners
            explore working capital, lines of credit, SBA loans, equipment
            financing, real estate funding, debt consolidation, and longer-term
            options with monthly payments and terms up to 10 years.
          </p>

          <p className="font-headline mt-8 text-xl font-extrabold leading-snug tracking-tight text-cb-ink md:text-2xl">
            Tell us what the money needs to do.{" "}
            <span className="text-cb-mint">
              We&rsquo;ll help figure out what makes sense.
            </span>
          </p>

          {/* Same label as the hero's button on purpose: it is the same action
              and the same destination, and a landing page that renames its one
              CTA halfway down reads as two different offers. A plain anchor,
              so this section stays a server component. */}
          <div className="mt-10 flex flex-col items-start gap-3">
            <a href="#prequal" className={`${CTA.primary} text-base`}>
              Let&rsquo;s Do This
              <ArrowRight className="h-5 w-5" />
            </a>
            <p className="text-sm font-semibold text-cb-ink/50">
              Takes about 30 seconds. No impact to your credit.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
