"use client";

// "Here's how this works" — the four-step card that sits beside the pre-qual
// form on /r/<code>.
//
// Ported from the marketing site's apply page (it has no counterpart in this
// repo, so the copy is transcribed rather than imported). Marketing asked for
// the same card here: the referral form is seven steps behind a "let's see
// where you stand" heading, and a visitor who arrived from a friend's text has
// no idea what happens after they finish it. This is that answer, parked where
// they'll be looking.
//
// Behaviour follows AffiliateSteps: sticky beside the form on desktop, collapsed
// behind its own heading on mobile so the form is still the first thing reachable.

import { useState } from "react";

const STEPS = [
  {
    title: "Have a chat with your Advisor.",
    body: "We'll look at your numbers, cash flow, debt, timing, and funding goal. Tiny details. Expensive if ignored.",
  },
  {
    title: "Compare your options.",
    body: "Term loan, SBA, line of credit, equipment financing, consolidation, or a very honest “not yet.”",
  },
  {
    title: "Move through the process.",
    body: "Documents, lender questions, next steps, closing details. Your Advisor helps keep the paperwork circus contained.",
  },
  {
    title: "Get funded. Then keep going.",
    body: "Money in the account is the first win. Knowing what to do with it next is where we stay useful.",
  },
];

export function HowThisWorks() {
  // Collapsed on mobile; always open on desktop via the `lg:block` override.
  const [open, setOpen] = useState(false);

  return (
    <div className="relative rounded-2xl border border-black/5 bg-white p-6 shadow-[0_24px_60px_-25px_rgba(0,3,33,0.18)] sm:p-8 lg:sticky lg:top-28">
      <div
        aria-hidden
        className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-cb-mint/50 to-transparent"
      />
      {/* Single heading. Tap-to-expand on mobile; static on desktop. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mb-1 flex w-full items-center justify-between gap-3 lg:pointer-events-none lg:mb-5 lg:cursor-default"
      >
        <span className="font-label text-[11px] font-bold uppercase tracking-[0.22em] text-cb-mint">
          Here&rsquo;s how this works
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 text-cb-mint transition-transform duration-300 lg:hidden ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <ol
        className={`${open ? "block" : "hidden"} mt-4 space-y-5 lg:mt-0 lg:block`}
      >
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cb-mint font-headline text-sm font-extrabold tabular-nums text-cb-navy shadow-[0_8px_18px_-6px_rgba(85,207,158,0.55)]"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="font-headline text-base font-extrabold leading-snug text-cb-ink sm:text-lg">
                {s.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-cb-ink/60">
                {s.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
