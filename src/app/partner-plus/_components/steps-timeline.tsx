"use client";

// "How it works" as a timeline that ADVANCES: a mint fill runs along the line
// from marker to marker and each marker lights as the fill reaches it. Holds
// on all-lit for a beat, rewinds, repeats.
//
// One number drives it: `pos`, the index of the furthest lit step (-1 = none).
// The line's fill is pos / (n − 1); markers light when i ≤ pos. The lit
// marker classes carry a transition DELAY roughly equal to the line's travel
// time, so a marker changes color when the fill arrives, not when it sets
// off. CSS uses the NEW state's delay, so un-lighting on rewind is instant.
//
// Runs only while on screen; under prefers-reduced-motion everything is lit
// and nothing moves.
//
// Geometry is unchanged from the static version: horizontal from lg (four
// columns at 768px left each step ~150px wide), a vertical connector per item
// below lg.

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";

/** Circle size, shared by the markers and the connectors that must meet them. */
const NODE = "h-14 w-14"; // 56px — connectors below are positioned against 28px (its center)

const DWELL_MS = 1500; // per step
const HOLD_MS = 2600; // on the last step, before rewinding

export function StepsTimeline({ steps }: { steps: { title: string; body: string }[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const reduceMotion = useReducedMotion();
  const last = steps.length - 1;

  const [step, setStep] = useState(-1);
  const pos = reduceMotion ? last : step;

  useEffect(() => {
    if (reduceMotion || !inView) return;
    const wait = step < 0 ? 300 : step === last ? HOLD_MS : DWELL_MS;
    const id = setTimeout(() => setStep((p) => (p >= last ? 0 : p + 1)), wait);
    return () => clearTimeout(id);
  }, [step, inView, reduceMotion, last]);

  const fill = last > 0 ? Math.max(0, pos) / last : 0;
  // Rewinding (back to 0) retracts quickly; advancing travels at reading pace.
  const travel = pos === 0 ? "duration-500" : "duration-700";

  return (
    <ol ref={ref} className="relative mt-14 grid gap-10 lg:mt-20 lg:grid-cols-4 lg:gap-8" data-timeline>
      {/* Desktop track: from the first marker's center to the last's. A
          column's center is (100% − 3 gaps) / 8 in from each edge; the gap is
          lg:gap-8 (2rem), hence 6rem. top = marker center − 1px. */}
      <span
        aria-hidden
        className="absolute left-[calc((100%-6rem)/8)] right-[calc((100%-6rem)/8)] top-[27px] hidden h-0.5 overflow-hidden rounded-full bg-cb-mint/20 lg:block"
      >
        <span
          className={`absolute inset-0 origin-left bg-cb-mint transition-transform ease-in-out ${travel}`}
          style={{ transform: `scaleX(${fill})` }}
        />
      </span>

      {steps.map((s, i) => {
        const lit = i <= pos;
        const current = i === pos && !reduceMotion;
        return (
          <li key={s.title} className="relative">
            {/* Phone connector: from this marker's bottom edge down to the next
                marker's top, across the 2.5rem (gap-10) between items. Fills
                downward once the NEXT step is reached. */}
            {i < last && (
              <span
                aria-hidden
                className="absolute left-[27px] top-14 h-[calc(100%-3.5rem+2.5rem)] w-0.5 overflow-hidden bg-cb-mint/20 lg:hidden"
              >
                <span
                  className={`absolute inset-0 origin-top bg-cb-mint transition-transform ease-in-out ${travel}`}
                  style={{ transform: `scaleY(${i < pos ? 1 : 0})` }}
                />
              </span>
            )}
            <Reveal
              delay={i * 0.12}
              distance={20}
              className="relative flex gap-5 lg:flex-col lg:items-center lg:gap-6 lg:text-center"
            >
              <span
                className={`relative z-10 flex ${NODE} shrink-0 items-center justify-center rounded-full border-2 font-headline text-xl font-extrabold ring-8 ring-cb-cream transition-all duration-500 ${
                  lit
                    ? "border-cb-mint bg-cb-mint text-cb-navy shadow-[0_8px_18px_-6px_rgba(85,207,158,0.55)] delay-[600ms]"
                    : "border-cb-mint/30 bg-white text-cb-gray delay-0"
                } ${current ? "scale-110" : "scale-100"}`}
              >
                {i + 1}
              </span>
              <div className="min-w-0 pt-2.5 lg:pt-0">
                <h3 className="font-headline text-2xl font-extrabold tracking-tight text-cb-navy">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-on-surface-variant lg:mx-auto lg:max-w-[17rem]">{s.body}</p>
              </div>
            </Reveal>
          </li>
        );
      })}
    </ol>
  );
}
