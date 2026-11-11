"use client";

// "How it works" as the thing it is: one file moving through five stages.
//
// These are the stage names the vault shows a client, in order. Each carries
// who acts at that point, because the question a business owner actually has
// is "what do I have to do, and what happens without me?".
//
// One mint pulse travels the line on a loop, and each stage lights up — the
// same state it takes on hover — while the pulse is on it, so the eye is led
// through the stages one at a time. The pulse is slow on purpose: a stage stays
// lit long enough to read. It all rests under reduced motion and while the
// section is off screen.

import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { Banknote, FileSearch, FolderCheck, Landmark, ListChecks } from "lucide-react";

const STAGES = [
  {
    icon: ListChecks,
    who: "Your advisor",
    title: "Documents requested",
    body: "Your advisor lists exactly what your file needs.",
  },
  {
    icon: FolderCheck,
    who: "You",
    title: "Documents in",
    body: "You upload each document once. The checklist clears as you go.",
  },
  {
    icon: FileSearch,
    who: "Underwriting",
    title: "In review",
    body: "A complete file reaches underwriting in 24–48 hours.",
  },
  {
    icon: Landmark,
    who: "Underwriting",
    title: "Lender matched",
    body: "Your file goes to the lenders it fits.",
  },
  {
    icon: Banknote,
    who: "Lender",
    title: "Funded",
    body: "The funds arrive in your business account.",
  },
];

/** Seconds for the pulse to cross the whole line, and to rest on "Funded". */
const TRAVEL_S = 7;
const REST_S = 1;
/** How close (in stages) the pulse must be for a stage to light up. */
const LIT_WITHIN = 0.3;

export function FilePipeline() {
  const reduce_motion = useReducedMotion();
  const root_ref = useRef<HTMLOListElement>(null);
  const in_view = useInView(root_ref, { amount: 0.3 });

  // 0 → 1 along the line. The pulse's position and the lit stage both read
  // from this one value, so they cannot drift apart.
  const progress = useMotionValue(0);
  const left = useTransform(progress, (v) => `${v * 100}%`);
  const opacity = useTransform(progress, [0, 0.04, 0.96, 1], [0, 1, 1, 0]);
  const [lit, set_lit] = useState(-1);

  useEffect(() => {
    if (reduce_motion || !in_view) return;
    const controls = animate(progress, [0, 1], {
      duration: TRAVEL_S,
      ease: "linear",
      repeat: Infinity,
      repeatDelay: REST_S,
    });
    return () => {
      controls.stop();
      set_lit(-1);
    };
  }, [reduce_motion, in_view, progress]);

  useMotionValueEvent(progress, "change", (v) => {
    const at = v * (STAGES.length - 1);
    const nearest = Math.round(at);
    const next = Math.abs(at - nearest) <= LIT_WITHIN ? nearest : -1;
    set_lit((prev) => (prev === next ? prev : next));
  });

  return (
    <ol ref={root_ref} className="relative grid gap-4 lg:grid-cols-5 lg:gap-5">
      {/* The rail: one horizontal line through the icon row on desktop. On a
          phone each stage draws its own segment down to the next (below), so
          the line ends at the last icon however long the text runs. */}
      <span aria-hidden className="absolute left-[10%] top-[27px] hidden h-px w-[80%] bg-cb-navy/10 lg:block" />
      {!reduce_motion && (
        <span aria-hidden className="pointer-events-none absolute left-[10%] top-[27px] hidden h-px w-[80%] lg:block">
          {/* x: -100% puts the bright head of the pulse, not its tail, on the
              point that lights the stage. */}
          <motion.span
            className="absolute top-0 h-1.5 w-12 rounded-full bg-gradient-to-r from-transparent to-cb-mint"
            style={{ left, opacity, x: "-100%", y: "-50%" }}
          />
        </span>
      )}

      {STAGES.map(({ icon: Icon, who, title, body }, i) => (
        <li
          key={title}
          // The pulse only exists on the desktop row, so the lit state is lg-only.
          data-lit={lit === i}
          className="group relative flex gap-4 lg:flex-col lg:items-center lg:gap-0 lg:text-center"
        >
          {i < STAGES.length - 1 && (
            <span aria-hidden className="absolute left-[27px] top-14 h-[calc(100%-2.5rem)] w-px bg-cb-navy/10 lg:hidden" />
          )}
          <span className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-black/5 bg-white text-cb-navy shadow-[0_16px_32px_-20px_rgba(0,3,33,0.5)] transition-[transform,background-color,color] duration-300 group-hover:-translate-y-0.5 group-hover:bg-cb-navy group-hover:text-cb-mint lg:group-data-[lit=true]:-translate-y-0.5 lg:group-data-[lit=true]:bg-cb-navy lg:group-data-[lit=true]:text-cb-mint">
            <Icon className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 pb-4 lg:mt-6 lg:pb-0">
            <p className="font-label text-[11px] font-bold uppercase tracking-[0.18em] text-on-primary-container tabular-nums">
              {String(i + 1).padStart(2, "0")} · {who}
            </p>
            <h3 className="mt-1.5 font-headline text-lg font-extrabold tracking-tight text-cb-navy">{title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-on-surface-variant transition-colors duration-300 group-hover:text-cb-navy lg:mx-auto lg:max-w-[14rem] lg:group-data-[lit=true]:text-cb-navy">
              {body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
