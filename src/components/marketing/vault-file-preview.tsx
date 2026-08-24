"use client";

// The landing hero's right column — and the one animated thing on the page.
//
// creditbanc.io opens with a circular mint-ringed photograph. The Vault has no
// photography, but it has something better to show: the artifact itself. This
// is a file in progress — requirements ticking from "Missing" to "Received"
// while a mint ring closes to 100% and the submit action wakes up. It keeps the
// site's circle motif, and it says what the product does without a paragraph.
//
// Plays once when it comes into view, then rests complete. It is a depiction of
// the real checklist, not a live one: the requirement names are the same four
// the page lists below as what you need to start.

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Check, FileText, ShieldCheck } from "lucide-react";
import { EASE } from "@/lib/motion";

const REQUIREMENTS = [
  { label: "Business bank statements", detail: "6 months" },
  { label: "Driver's license", detail: "Front and back" },
  { label: "Voided business check", detail: "Business account" },
  { label: "Debt schedule", detail: "If applicable" },
];

/** ms between one requirement landing and the next. */
const STEP_MS = 620;

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

export function VaultFilePreview() {
  const root_ref = useRef<HTMLDivElement>(null);
  const in_view = useInView(root_ref, { once: true, amount: 0.4 });
  const reduce_motion = useReducedMotion();

  // How many requirements have landed. Starts complete under reduced motion —
  // the point of the panel is the finished state, the animation is only how it
  // gets there.
  const [received, set_received] = useState(0);

  useEffect(() => {
    if (!in_view) return;
    if (reduce_motion) {
      set_received(REQUIREMENTS.length);
      return;
    }
    const timers = REQUIREMENTS.map((_, i) =>
      window.setTimeout(() => set_received(i + 1), 420 + i * STEP_MS)
    );
    return () => timers.forEach(window.clearTimeout);
  }, [in_view, reduce_motion]);

  const complete = received === REQUIREMENTS.length;
  const pct = Math.round((received / REQUIREMENTS.length) * 100);

  return (
    <div ref={root_ref} className="relative mx-auto w-full max-w-[30rem]">
      {/* Mint halo — the site's circular hero shape, kept as an atmosphere
          rather than a frame so the card stays rectangular and legible. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 rounded-full bg-cb-mint/20 blur-3xl"
      />

      <div className="relative rounded-3xl border border-black/5 bg-white p-6 shadow-[0_40px_80px_-40px_rgba(0,3,33,0.35)] sm:p-8">
        {/* File header: who the file belongs to, and how far along it is. */}
        <div className="flex items-center gap-4">
          <div className="relative h-[7.5rem] w-[7.5rem] shrink-0">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-cb-mint/15"
              />
              <motion.circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeLinecap="round"
                className="text-cb-mint"
                strokeDasharray={RING_CIRCUMFERENCE}
                initial={{ strokeDashoffset: RING_CIRCUMFERENCE }}
                animate={{
                  strokeDashoffset:
                    RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * pct) / 100,
                }}
                transition={reduce_motion ? { duration: 0 } : { duration: 0.6, ease: EASE }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-headline text-2xl font-extrabold tracking-tighter text-cb-navy tabular-nums">
                {pct}%
              </span>
              <span className="font-label text-[9px] font-bold uppercase tracking-[0.18em] text-cb-gray">
                Complete
              </span>
            </div>
          </div>

          <div className="min-w-0">
            <p className="font-label text-[10px] font-bold uppercase tracking-[0.22em] text-cb-mint">
              Your vault
            </p>
            <p className="mt-1 truncate font-headline text-xl font-extrabold tracking-tight text-cb-navy">
              Document checklist
            </p>
            <p className="mt-1 text-sm text-on-surface-variant">
              {complete
                ? "Everything's in. Ready to submit."
                : `${REQUIREMENTS.length - received} still to upload`}
            </p>
          </div>
        </div>

        {/* The checklist itself. */}
        <ul className="mt-6 space-y-2">
          {REQUIREMENTS.map((req, i) => {
            const done = i < received;
            return (
              <li
                key={req.label}
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-500 ${
                  done
                    ? "border-cb-mint/30 bg-cb-mint/[0.07]"
                    : "border-black/5 bg-cb-cream"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-500 ${
                    done ? "bg-cb-mint text-white" : "bg-white text-cb-gray"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" strokeWidth={3} /> : <FileText className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-cb-navy">
                    {req.label}
                  </span>
                  <span className="block text-xs text-cb-gray">{req.detail}</span>
                </span>
                <span
                  className={`shrink-0 font-label text-[9px] font-bold uppercase tracking-[0.16em] transition-colors duration-500 ${
                    done ? "text-cb-mint" : "text-cb-gray/70"
                  }`}
                >
                  {done ? "Received" : "Missing"}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Submit wakes up only when the file is actually complete — which is
            how the product behaves, and the whole promise of the page. */}
        <div
          className={`mt-6 flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 transition-colors duration-500 ${
            complete ? "bg-cb-navy text-primary-fixed" : "bg-cb-cream text-cb-gray"
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          <span className="font-label text-[11px] font-bold uppercase tracking-[0.18em]">
            {complete ? "Submit to underwriting" : "Waiting on documents"}
          </span>
        </div>
      </div>
    </div>
  );
}
