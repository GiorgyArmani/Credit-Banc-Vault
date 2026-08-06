"use client";

// Centered hero for /affiliate — same shape as the marketing site's apply-now
// funnel: eyebrow chip, big headline with an animated mint highlight block,
// one bold sub-line, then a row of three metric cards.
//
// Client component only because of the framer-motion entrance; the page itself
// stays a server component (it exports route segment config).

import { motion } from "framer-motion";

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
    <div className="max-w-3xl mx-auto text-center mb-10 sm:mb-14">
      <div className="inline-flex items-center gap-2 bg-white border border-black/5 rounded-full px-4 py-2 mb-8 shadow-sm">
        <span className="font-label text-sm text-cb-gray font-bold uppercase tracking-[0.2em]">
          Affiliate Program
        </span>
      </div>

      <motion.h1
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="font-headline text-5xl md:text-6xl xl:text-7xl font-extrabold tracking-tighter text-cb-ink leading-[0.95] mb-6"
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

      <p className="font-headline text-xl md:text-2xl xl:text-3xl font-bold tracking-tight text-cb-ink/70 leading-snug">
        Turn the business owners you know into{" "}
        <span className="text-cb-ink">$500</span> rewards,{" "}
        <span className="text-cb-mint">
          one useful introduction at a time. Cha-ching!
        </span>
      </p>

      <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-8">
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
    </div>
  );
}
