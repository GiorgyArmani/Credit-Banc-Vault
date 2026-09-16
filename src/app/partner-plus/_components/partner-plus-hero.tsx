"use client";

// Hero for the public Partner+ signup, in creditbanc.io's own grammar — the
// same devices as the landing page and /affiliate: a navy Manrope 800 headline
// at tracking-tighter, the mint highlight block that wipes in from the left,
// and a row of white fact tiles with the number set in mint.
//
// The signup form is passed in as `form` so the page stays a server component
// (it reads searchParams) and only this entrance animation ships to the client.
//
// LAYOUT. Desktop: copy + fact tiles on the left, form on the right spanning
// both rows. Phone: headline → form → tiles, so the form is reachable without
// scrolling past marketing. Done with explicit grid placement rather than
// duplicating the form for two breakpoints.

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { EASE } from "@/lib/motion";

// Only things the product actually stands behind: the price, the billing unit
// (one subscription per login), and the cancellation promise the form already
// made. No invented volume or approval claims.
const FACTS = [
  { value: "$100", label: "Per month" },
  { value: "1", label: "Login per plan" },
  { value: "Anytime", label: "Cancel" },
];

export function PartnerPlusHero({ form }: { form: ReactNode }) {
  return (
    // max-w-6xl, not the landing page's 7xl: this page uses the shared
    // BrandHeader (max-w-6xl, px-4 INSIDE the box), and the hero must share that
    // exact box or its left edge sits 16px off the header's.
    <div className="relative mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-[1.1fr_0.9fr] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:gap-y-12">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1 lg:pt-10">
        <motion.span
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="inline-flex items-center rounded-full border border-black/5 bg-white px-4 py-2 font-label text-xs font-bold uppercase tracking-[0.2em] text-cb-gray shadow-sm"
        >
          Partner+
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="mt-7 font-headline text-[clamp(2.4rem,6vw,4.5rem)] font-extrabold leading-[0.95] tracking-tighter text-cb-navy"
        >
          Bring us the deals
          <br />
          {/* The brand's signature device: white type on a mint block that
              wipes in from the left, after the headline has landed. */}
          <span className="relative isolate mt-2 inline-block px-3 text-white">
            <motion.span
              aria-hidden
              className="absolute inset-y-1 left-0 right-0 -z-10 rounded-sm bg-cb-mint"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, delay: 0.5, ease: EASE }}
              style={{ originX: 0 }}
            />
            that don&apos;t fit.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
          className="mt-8 max-w-xl text-lg leading-relaxed text-on-surface-variant"
        >
          Submit your own files into the Credit Banc vault. Our underwriting team and lender network
          work the back end with you.
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
        className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1"
      >
        {form}
      </motion.div>

      <div className="grid min-w-0 grid-cols-3 gap-3 sm:gap-4 lg:col-start-1 lg:row-start-2 lg:self-start">
        {FACTS.map((fact, i) => (
          <motion.div
            key={fact.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 + i * 0.1, ease: EASE }}
            className="flex min-h-[96px] flex-col items-center justify-center gap-1.5 rounded-xl border border-black/5 bg-white px-2 py-4 text-center shadow-[0_12px_30px_-20px_rgba(0,3,33,0.18)] sm:min-h-[120px] sm:px-4 sm:py-6"
          >
            {/* Steps down at lg: the copy column is at its narrowest just past
                the breakpoint (~1024px), where "Anytime" at 4xl nearly touches
                its tile edges. Back up at xl once the column has room. */}
            <p className="font-headline text-2xl font-extrabold leading-none tracking-tighter text-cb-mint sm:text-4xl lg:text-3xl xl:text-4xl">
              {fact.value}
            </p>
            <p className="font-label text-[10px] font-bold uppercase leading-tight tracking-[0.14em] text-cb-gray sm:text-[11px] sm:tracking-[0.18em]">
              {fact.label}
            </p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
