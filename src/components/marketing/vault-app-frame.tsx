"use client";

// The landing hero's product window.
//
// The Vault has no photography, but it has something better to show: the
// artifact itself. This is a file in progress, drawn as the app draws it —
// requirements ticking from "Missing" to "Received" while the ring closes to
// 100%, the submit action wakes up, and the funding status moves on a stage.
//
// It sits on the navy hero as a LIGHT window on purpose: the real vault is
// cream and white, and a light surface on navy is what makes it read as a
// product rather than as decoration.
//
// Plays once when it comes into view, then rests complete. It is a depiction of
// the real checklist, not a live one — six requirements, which is what a typical
// file runs to (the median across live vaults is seven). The "What you need"
// section explains why the exact list depends on the file, so this panel should
// stay a plausible file rather than mirror any fixed list.

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Bell, Check, FileText, ShieldCheck } from "lucide-react";
import { EASE } from "@/lib/motion";

// Short labels on purpose: the row truncates at mobile widths, and "Business
// debt schedule" clipped to "Business debt …" reads as a different document.
// The detail line underneath carries the specificity instead.
const REQUIREMENTS = [
  { label: "Bank statements", detail: "12 months" },
  { label: "Driver's license", detail: "Front and back" },
  { label: "Tax returns", detail: "Most recent years" },
  { label: "Voided check", detail: "Business account" },
  { label: "Profit & loss", detail: "Year to date" },
  { label: "Debt schedule", detail: "If applicable" },
];

// The stage names the vault itself uses.
const STAGES = ["Documents requested", "Documents in", "In review", "Lender matched", "Funded"];

/** ms between one requirement landing and the next. Six items at this pace
    finish in ~2.6s, which is about as long as a hero flourish should run. */
const STEP_MS = 440;

const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

export function VaultAppFrame() {
  const root_ref = useRef<HTMLDivElement>(null);
  const in_view = useInView(root_ref, { once: true, amount: 0.3 });
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
      window.setTimeout(() => set_received(i + 1), 600 + i * STEP_MS)
    );
    return () => timers.forEach(window.clearTimeout);
  }, [in_view, reduce_motion]);

  const complete = received === REQUIREMENTS.length;
  const pct = Math.round((received / REQUIREMENTS.length) * 100);
  // Stage 1 while documents are still coming in; a complete file is in review.
  const current_stage = complete ? 2 : 1;

  return (
    <div ref={root_ref} className="relative w-full">
      {/* Mint light behind the window — depth from glow, not from a border. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-6 -inset-y-10 rounded-[3rem] bg-cb-mint/20 blur-3xl"
      />

      {/* Bezel: a hairline glass frame, then the app surface. */}
      <div className="relative rounded-[1.25rem] border border-white/20 bg-white/[0.06] p-1.5 shadow-[0_50px_100px_-40px_rgba(0,0,0,0.7)] backdrop-blur">
        <div className="overflow-hidden rounded-[0.9rem] bg-cb-cream text-cb-ink">
          {/* App bar */}
          <div className="flex items-center justify-between gap-3 border-b border-black/5 bg-white px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cb-navy">
                <ShieldCheck className="h-4 w-4 text-cb-mint" />
              </span>
              <span className="truncate font-headline text-sm font-extrabold tracking-tight text-cb-navy">
                Your vault
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="relative text-cb-gray">
                <Bell className="h-4 w-4" />
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-cb-mint" />
              </span>
              <span className="hidden rounded-full bg-cb-cream px-2.5 py-1 font-label text-[9px] font-bold uppercase tracking-[0.16em] text-cb-navy/70 sm:inline">
                Harbor Cafe LLC
              </span>
            </div>
          </div>

          <div className="grid md:grid-cols-[minmax(0,1fr)_13.5rem]">
            {/* ── Checklist pane ─────────────────────────────────────── */}
            <div className="p-4 sm:p-5">
              <div className="flex items-center gap-4">
                <div className="relative h-20 w-20 shrink-0">
                  <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="10" className="text-cb-mint/20" />
                    <motion.circle
                      cx="60"
                      cy="60"
                      r="52"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="10"
                      strokeLinecap="round"
                      className="text-cb-mint"
                      strokeDasharray={RING_CIRCUMFERENCE}
                      initial={{ strokeDashoffset: RING_CIRCUMFERENCE }}
                      animate={{ strokeDashoffset: RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * pct) / 100 }}
                      transition={reduce_motion ? { duration: 0 } : { duration: 0.6, ease: EASE }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-headline text-lg font-extrabold tracking-tighter text-cb-navy tabular-nums">
                      {pct}%
                    </span>
                  </div>
                </div>

                <div className="min-w-0">
                  <p className="truncate font-headline text-lg font-extrabold tracking-tight text-cb-navy">
                    Document checklist
                  </p>
                  <p className="mt-0.5 text-sm text-on-surface-variant tabular-nums">
                    {complete
                      ? "Everything is in. Ready to submit."
                      : `${received} of ${REQUIREMENTS.length} received`}
                  </p>
                </div>
              </div>

              <ul className="mt-4 space-y-1.5">
                {REQUIREMENTS.map((req, i) => {
                  const done = i < received;
                  return (
                    <li
                      key={req.label}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-500 ${
                        done ? "border-cb-mint/30 bg-cb-mint/[0.08]" : "border-black/5 bg-white"
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-500 ${
                          done ? "bg-cb-mint text-cb-navy" : "bg-cb-cream text-cb-gray"
                        }`}
                      >
                        {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <FileText className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold leading-tight text-cb-navy">{req.label}</span>
                        <span className="block truncate text-[11px] leading-tight text-cb-gray">{req.detail}</span>
                      </span>
                      <span
                        className={`shrink-0 font-label text-[9px] font-bold uppercase tracking-[0.16em] transition-colors duration-500 ${
                          done ? "text-on-primary-container" : "text-cb-gray"
                        }`}
                      >
                        {done ? "Received" : "Missing"}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* Submit wakes up only when the file is actually complete — which
                  is how the product behaves, and the whole promise of the page. */}
              <div
                className={`mt-4 flex items-center justify-center gap-2 rounded-lg px-5 py-3 transition-colors duration-500 ${
                  complete ? "bg-cb-navy text-primary-fixed" : "bg-black/[0.04] text-cb-gray"
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                <span className="font-label text-[10px] font-bold uppercase tracking-[0.18em]">
                  {complete ? "Submit to underwriting" : "Waiting on documents"}
                </span>
              </div>
            </div>

            {/* ── Funding status rail. Desktop only: on a phone the checklist
                   alone has to fit the first screen. ─────────────────────── */}
            <div className="hidden border-l border-black/5 bg-white p-5 md:block">
              <p className="font-label text-[9px] font-bold uppercase tracking-[0.2em] text-cb-gray">Funding status</p>
              <ol className="mt-4">
                {STAGES.map((stage, i) => {
                  const state = i < current_stage ? "done" : i === current_stage ? "current" : "next";
                  return (
                    <li key={stage} className="relative flex gap-3 pb-5 last:pb-0">
                      {i < STAGES.length - 1 && (
                        <span
                          aria-hidden
                          className={`absolute left-[9px] top-5 h-full w-px transition-colors duration-500 ${
                            state === "done" ? "bg-cb-mint" : "bg-black/10"
                          }`}
                        />
                      )}
                      <span
                        className={`relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-500 ${
                          state === "done"
                            ? "border-cb-mint bg-cb-mint text-cb-navy"
                            : state === "current"
                              ? "border-cb-mint bg-white"
                              : "border-black/10 bg-white"
                        }`}
                      >
                        {state === "done" && <Check className="h-2.5 w-2.5" strokeWidth={4} />}
                        {state === "current" && (
                          <span className="h-1.5 w-1.5 rounded-full bg-cb-mint motion-safe:animate-pulse" />
                        )}
                      </span>
                      <span
                        className={`text-[12px] leading-tight transition-colors duration-500 ${
                          state === "next" ? "text-cb-gray" : "font-bold text-cb-navy"
                        }`}
                      >
                        {stage}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
