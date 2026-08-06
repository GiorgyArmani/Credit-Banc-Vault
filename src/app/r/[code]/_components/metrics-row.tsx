"use client";

// The four creditbanc.io figures. These used to be their own green band between
// the hero and the explainer; they now live inside the gold hero, filling the
// space under the copy, so this is a bare row with no background or section of
// its own — the hero owns the surface.
//
// Styled navy rather than the pale mint they had on green: on gold, pale mint
// drops to near-invisible, and navy is already the hero's type color.
//
// These four figures come from the live marketing site. They are NOT derived or
// estimated here — an earlier attempt to read them off the rendered page came
// back as "$0B+" and "0k+" because the site animates them up from zero on the
// client, so the real values were supplied from a screenshot of the running
// site. Do not "correct" them without checking creditbanc.io.
//
// Note the 5h figure is the wait for an offer, a different measurement from the
// 24–48h "to underwriting" line used elsewhere in the app. Both are correct;
// they count different clocks.

import { useEffect, useRef } from "react";
import { animate, useInView } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";

const METRICS = [
  { value: "$2B+", label: "Dollars Put to Work" },
  { value: "15k+", label: "Businesses Funded. Headaches Downgraded" },
  { value: "5h", label: "Average Time Spent Waiting For An Offer" },
  { value: "0", label: "Funding Applications Reviewed By Robots" },
];

/** "$2B+" -> { prefix: "$", target: 2, suffix: "B+" } */
function parseMetric(text: string) {
  const match = text.match(/^(\D*)(\d+(?:\.\d+)?)(.*)$/);
  if (!match) return { prefix: "", target: 0, suffix: text };
  return { prefix: match[1], target: Number(match[2]), suffix: match[3] };
}

/**
 * Counts up to the figure once it scrolls into view.
 *
 * Renders the FINAL text on the server and on the first client render, then
 * hands the text node to framer-motion via the ref. Rendering 0 initially would
 * be the obvious approach and the wrong one: the server has no scroll position,
 * so it would emit the final value while the client emitted 0 — a hydration
 * mismatch. Driving textContent from an effect sidesteps it entirely, and React
 * never re-renders these children (the props are constants), so nothing fights
 * over the node.
 *
 * Deliberately NOT gated on useReducedMotion. Everything else on this page
 * respects it, but a figure counting up is a content transition, not motion —
 * nothing travels, scales, or parallaxes — and it runs once for 1.6s rather
 * than looping. Gating it made the figures render dead for anyone browsing with
 * the OS setting on, which is most of the point of them.
 */
function Counter({ text, delay = 0 }: { text: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const { prefix, target, suffix } = parseMetric(text);

  useEffect(() => {
    const el = ref.current;
    // Nothing to count toward on "0" — it just sits there while its neighbours
    // climb, which is the joke.
    if (!el || target === 0) return;

    if (!inView) {
      el.textContent = `${prefix}0${suffix}`;
      return;
    }

    // Small figures ($2B+, 5h) would otherwise tick 0, 1, 2 and look broken, so
    // they count through one decimal and snap to the exact source string at the
    // end — that way "$2.0B+" never survives as the final state.
    const decimals = target < 10 ? 1 : 0;

    const controls = animate(0, target, {
      duration: 1.6,
      delay,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        el.textContent = `${prefix}${v.toFixed(decimals)}${suffix}`;
      },
      onComplete: () => {
        el.textContent = text;
      },
    });
    return () => controls.stop();
  }, [inView, target, prefix, suffix, text, delay]);

  return <span ref={ref}>{text}</span>;
}

export function MetricsRow({ className }: { className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4", className)}>
      {METRICS.map((metric, i) => (
        <Reveal key={metric.label} delay={0.5 + i * 0.1} distance={20}>
          <div className="text-center">
            <p className="font-headline text-4xl font-extrabold leading-none tracking-tight tabular-nums text-on-secondary-fixed sm:text-5xl xl:text-6xl">
              <Counter text={metric.value} delay={0.5 + i * 0.1} />
            </p>
            <p className="font-label mx-auto mt-3 max-w-[14rem] text-[10px] font-bold uppercase leading-tight tracking-[0.14em] text-on-secondary-fixed/60 md:text-[11px]">
              {metric.label}
            </p>
          </div>
        </Reveal>
      ))}
    </div>
  );
}
