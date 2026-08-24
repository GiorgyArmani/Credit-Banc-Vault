"use client";

// Centered hero for /affiliate — same shape as the marketing site's apply-now
// funnel: eyebrow chip, big headline with an animated mint highlight block,
// one bold sub-line, then a row of three metric cards.
//
// Client component only because of the framer-motion entrance; the page itself
// stays a server component (it exports route segment config).

import Image from "next/image";
import { motion } from "framer-motion";
import { GiftCardBackdrop } from "./gift-card-backdrop";

const METRICS: Array<{ value: string; label: string; valueClass?: string }> = [
  { value: "$500", label: "Per Funded Referral" },
  {
    value: "Unlimited",
    label: "No referral limits.",
    valueClass: "text-xs sm:text-2xl xl:text-3xl",
  },
  { value: "Free", label: "To Join" },
];

export function AffiliateHero() {
  return (
    <div className="relative max-w-3xl mx-auto text-center mb-10 sm:mb-14">
      {/* The actual cards, drifting past behind the headline. Decorative, and
          it renders nothing below lg — see the component. Everything after it
          sits on z-10 so the type always wins. */}
      <GiftCardBackdrop />

      <div className="relative z-10 inline-flex items-center gap-2 bg-white border border-black/5 rounded-full px-4 py-2 mb-8 shadow-sm">
        <span className="font-label text-sm text-cb-gray font-bold uppercase tracking-[0.2em]">
          Affiliate Program
        </span>
      </div>

      <motion.h1
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 font-headline text-5xl md:text-6xl xl:text-7xl font-extrabold tracking-tighter text-cb-ink leading-[0.95] mb-6"
      >
        Refer.{" "}
        <span
          className="relative inline-block px-3 text-white"
          style={{ isolation: "isolate" }}
        >
          <motion.span
            aria-hidden
            className="absolute inset-y-1 left-0 right-0 bg-cb-mint rounded-sm"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.7, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
            style={{ originX: 0, zIndex: 0 }}
          />
          <span className="relative" style={{ zIndex: 1 }}>
            Get Paid.
          </span>
        </span>{" "}
        Repeat.
      </motion.h1>

      <p className="relative z-10 font-headline text-xl md:text-2xl xl:text-3xl font-bold tracking-tight text-cb-ink/70 leading-snug">
        Turn the business owners you know into{" "}
        <span className="text-cb-ink">$500</span> rewards,{" "}
        <span className="text-cb-mint">
          one useful introduction at a time. Cha-ching!
        </span>
      </p>

      <div className="relative z-10 grid grid-cols-3 gap-2 sm:gap-4 mt-8">
        {METRICS.map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.6,
              delay: 0.4 + i * 0.1,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="rounded-lg sm:rounded-xl border border-black/5 bg-white px-2 py-3 sm:px-4 sm:py-6 shadow-[0_12px_30px_-20px_rgba(0,3,33,0.18)] flex flex-col items-center justify-center text-center gap-1 sm:gap-2 min-h-[84px] sm:min-h-[120px]"
          >
            <p
              className={`font-headline font-extrabold tracking-tight text-cb-mint leading-[1.05] ${
                m.valueClass ?? "text-xl sm:text-4xl xl:text-5xl"
              }`}
            >
              {m.value}
            </p>
            <p className="font-label text-[9px] sm:text-[11px] font-bold uppercase tracking-[0.1em] sm:tracking-[0.18em] text-cb-gray leading-tight">
              {m.label}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Names the cards drifting behind the headline, and credits who ships
          them. On mobile the backdrop is off, so this line carries the whole
          "pick any card" idea by itself. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mt-7 flex flex-col items-center gap-3"
      >
        <p className="max-w-lg text-[13px] leading-relaxed text-cb-ink/50 sm:text-sm">
          Amazon. Target. Starbucks. Airbnb. Or a Visa reward card you can spend
          anywhere &mdash; your $500, your call.
        </p>
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-[0_10px_24px_-16px_rgba(32,37,54,0.6)] ring-1 ring-black/5">
          <span className="font-label text-[11px] font-bold uppercase tracking-[0.16em] text-cb-gray">
            Rewards by
          </span>
          <Image
            src="/giftcards/giftronaut-logo.webp"
            alt="Giftronaut"
            width={3132}
            height={332}
            /* `unoptimized` on purpose. The wordmark is dark glyphs on
               transparency, and next/image's JPEG fallback (served to any client
               that does not advertise webp/avif) flattens that alpha to BLACK —
               a black slab on the white badge. The source is a 13KB webp,
               smaller than the optimizer's own output, so there is nothing to
               gain by routing it through /_next/image. */
            unoptimized
            className="h-4 w-auto"
          />
        </span>
      </motion.div>
    </div>
  );
}
