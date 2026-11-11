"use client";

// The "What you need" section's picture: three facts about a business go in,
// the advisor reads them, one short checklist comes out.
//
// WHY THIS IS NOT A DOCUMENT LIST. The first version of this section was an
// interactive per-product checklist: pick a funding product, watch twenty-one
// document rows render. It was accurate and it was the wrong promise. A
// prospect who has not spoken to an advisor reads a twenty-one-row grid as
// "this is what they will make me do", and the honest answer is that nobody
// gets the whole package — the ask is assembled per file, and most files land
// far under the maximum. It was also a transcription of advisor-facing config
// (@/data/program-document-packages) that changes without a marketing review.
//
// So the diagram states the rule instead of enumerating an instance: the
// output card shows a count and two requests with their reasons, never a
// product's document set.

import { motion, useReducedMotion } from "framer-motion";
import { Briefcase, CalendarClock, MessageSquareText, UserRound, WalletCards } from "lucide-react";

const INPUTS = [
  { icon: Briefcase, label: "Your industry" },
  { icon: CalendarClock, label: "Time in business" },
  { icon: WalletCards, label: "Funding product" },
];

/** Three lanes converging on the hub, in a 100×100 box stretched to fit. The
    start heights are the centres of three equal rows. */
const LANES = ["M0,16.7 C55,16.7 45,50 100,50", "M0,50 L100,50", "M0,83.3 C55,83.3 45,50 100,50"];

// The SVG is stretched, so strokes are non-scaling — which also puts the dash
// pattern in SCREEN pixels. One 18px dash followed by a gap longer than any
// wire gives exactly one pulse per wire; it runs off the end and the rest of
// the loop is the pause before the next one.
const PULSE = 18;
const PULSE_TRAVEL = 640;

function Wires({ paths, delay = 0 }: { paths: string[]; delay?: number }) {
  const reduce_motion = useReducedMotion();
  return (
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="hidden h-full w-full lg:block">
      {paths.map((d, i) => (
        <g key={d}>
          <path d={d} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          {!reduce_motion && (
            <motion.path
              d={d}
              fill="none"
              stroke="#55cf9e"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${PULSE} ${PULSE_TRAVEL}`}
              vectorEffect="non-scaling-stroke"
              initial={{ strokeDashoffset: PULSE }}
              animate={{ strokeDashoffset: -PULSE_TRAVEL }}
              transition={{ duration: 3.5, ease: "linear", repeat: Infinity, delay: delay + i * 0.35 }}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

export function ChecklistDiagram() {
  return (
    <div className="grid items-stretch gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-5 sm:p-7 lg:grid-cols-[13rem_minmax(2rem,1fr)_auto_minmax(2rem,1fr)_17rem] lg:gap-0">
      {/* Inputs */}
      <div className="grid grid-rows-3 gap-3">
        {INPUTS.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5">
            <Icon className="h-4 w-4 shrink-0 text-cb-mint" strokeWidth={2} />
            <span className="text-sm font-bold text-white">{label}</span>
          </div>
        ))}
      </div>

      <Wires paths={LANES} />

      {/* Hub */}
      <div className="flex items-center justify-center">
        <div className="flex flex-row items-center gap-3 rounded-2xl border border-cb-mint/40 bg-cb-mint/10 px-5 py-4 shadow-[0_0_60px_-10px_rgba(85,207,158,0.5)] lg:flex-col lg:px-6 lg:py-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cb-mint text-cb-navy">
            <UserRound className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <span className="font-headline text-base font-extrabold tracking-tight text-white">Your advisor</span>
        </div>
      </div>

      <Wires paths={["M0,50 L100,50"]} delay={1.2} />

      {/* Output */}
      <div className="flex items-center">
        <div className="w-full rounded-2xl bg-cb-cream p-4 text-cb-ink">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-headline text-base font-extrabold tracking-tight text-cb-navy">Your checklist</span>
            <span className="font-label text-[9px] font-bold uppercase tracking-[0.16em] text-cb-gray tabular-nums">
              6 documents
            </span>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white px-3.5 py-3">
              <p className="text-sm font-bold text-cb-navy">Bank statements</p>
              <p className="text-[12px] text-on-surface-variant tabular-nums">12 months</p>
            </div>
            {/* A later ask from underwriting — the one kind that carries a note. */}
            <div className="rounded-xl border border-cb-mint/40 bg-white px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-cb-navy">Debt schedule</p>
                <p className="font-label text-[9px] font-bold uppercase tracking-[0.16em] text-on-primary-container">New request</p>
              </div>
              <p className="mt-1.5 flex gap-2 text-[12px] leading-snug text-on-surface-variant">
                <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-on-primary-container" />
                You listed an existing equipment loan.
              </p>
            </div>
            <p className="px-1 text-[12px] text-on-surface-variant tabular-nums">+ 4 more</p>
          </div>
        </div>
      </div>
    </div>
  );
}
