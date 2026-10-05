"use client";

// The "What you get" benefits, one at a time. Replaced a 2×3 card grid: six
// paragraph-length cards side by side read as a wall of text. Here one white
// card holds the current benefit and the slides move INSIDE it, so the card
// itself never jumps. It's an AUTO carousel by design — no prev/next arrows;
// the segmented bar under it is the progress indicator, and clicking a
// segment jumps there. Keyboard arrows still step while it has focus.
//
// Autoplay advances every DWELL_MS, and stops while hovered, while anything
// inside has keyboard focus, while scrolled out of view (so a visitor doesn't
// arrive mid-sequence), and entirely under prefers-reduced-motion. Swipe on
// touch comes from Embla. Icons live here, not in the server page, because
// component references can't cross the server→client boundary as props.

import { useCallback, useEffect, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { useInView, useReducedMotion } from "framer-motion";
import {
  Eye,
  Handshake,
  LayoutDashboard,
  Network,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

// Marketing-approved copy (Oct 2026). Each body says something its title doesn't.
const BENEFITS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: LayoutDashboard,
    title: "Your own deal desk",
    body: "Your clients, files, and documents all live in one place instead of scattered across your inbox, desktop, and wherever else PDFs go to disappear.",
  },
  {
    icon: Users,
    title: "A team that works the file",
    body: "We review the deal, help structure it, package it properly, and work it through the financing process with you.",
  },
  {
    icon: Upload,
    title: "A portal for your clients",
    body: "No more playing email ping-pong with tax returns and bank statements. Your clients can upload their documents directly and securely.",
  },
  {
    icon: Network,
    title: "Our lender network",
    body: "Get access to Credit Banc’s lender network without having to build and manage dozens of lender relationships yourself.",
  },
  {
    icon: Eye,
    title: "Visibility into your deals",
    body: "See what’s happening with the deals you submit instead of sending a referral into the void and hoping somebody eventually remembers you exist.",
  },
  {
    icon: Handshake,
    title: "You keep the relationship",
    body: "They’re your client. We’re here to help you get the financing handled.",
  },
];

const DWELL_MS = 6000;

const pad = (n: number) => String(n).padStart(2, "0");

export function BenefitsCarousel() {
  const [emblaRef, api] = useEmblaCarousel({ loop: true });
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.4 });
  const reduceMotion = useReducedMotion();

  const [selected, setSelected] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1 through the current slide's dwell
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const autoplay = !!api && inView && !hovered && !focused && !reduceMotion;

  useEffect(() => {
    if (!api) return;
    const onSelect = () => {
      setSelected(api.selectedScrollSnap());
      setProgress(0);
    };
    onSelect();
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  // rAF clock rather than setInterval so the bar fills smoothly and a pause
  // resumes from where it stopped instead of restarting the slide.
  useEffect(() => {
    if (!autoplay) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setProgress((p) => Math.min(1, p + dt / DWELL_MS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoplay]);

  // Embla fires "select" synchronously inside scrollNext, which resets progress
  // to 0 — so this runs once per slide, not once per frame past 1.
  useEffect(() => {
    if (progress >= 1) api?.scrollNext();
  }, [progress, api]);

  const scrollPrev = useCallback(() => api?.scrollPrev(), [api]);
  const scrollNext = useCallback(() => api?.scrollNext(), [api]);

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription="carousel"
      aria-label="What you get with Partner Plus"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          scrollPrev();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          scrollNext();
        }
      }}
    >
      {/* The viewport IS the card: slides travel inside one fixed white frame. */}
      <div
        ref={emblaRef}
        className="overflow-hidden rounded-3xl bg-white shadow-[0_30px_70px_-30px_rgba(32,37,54,0.6)]"
      >
        <div className="flex">
          {BENEFITS.map(({ icon: Icon, title, body }, i) => (
            <div
              key={title}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${BENEFITS.length}: ${title}`}
              aria-hidden={i !== selected}
              className="min-w-0 shrink-0 grow-0 basis-full p-8 sm:p-10 lg:p-12"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary-container/40 text-on-primary-container">
                  <Icon className="h-7 w-7" />
                </span>
                <span className="font-headline text-sm font-extrabold tracking-tight text-cb-gray">
                  <span className="text-cb-mint">{pad(i + 1)}</span> / {pad(BENEFITS.length)}
                </span>
              </div>
              <h3 className="mt-8 font-headline text-2xl font-extrabold tracking-tight text-cb-navy sm:text-3xl">
                {title}
              </h3>
              <p className="mt-4 max-w-xl text-lg leading-relaxed text-on-surface-variant">{body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <div className="flex gap-1.5">
          {BENEFITS.map(({ title }, i) => {
            const fill = i < selected ? 1 : i === selected ? (reduceMotion ? 1 : progress) : 0;
            return (
              <button
                key={title}
                type="button"
                onClick={() => api?.scrollTo(i)}
                aria-label={`Show ${title}`}
                aria-current={i === selected ? "true" : undefined}
                className="group flex-1 py-3"
              >
                <span className="block h-1.5 overflow-hidden rounded-full bg-white/25 transition-colors group-hover:bg-white/40">
                  <span
                    className="block h-full origin-left rounded-full bg-white"
                    style={{ transform: `scaleX(${fill})` }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
