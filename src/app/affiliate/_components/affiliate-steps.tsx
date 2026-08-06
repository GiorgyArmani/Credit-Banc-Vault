"use client";

// "Here's how this works" card that sits beside the signup form on desktop
// (sticky) and folds shut under it on mobile so the form is reachable first —
// same behavior as the marketing site's apply-now funnel.

import { useState } from "react";

const STEPS = [
  {
    title: "Get the Link",
    body: "Sign up and get your personal referral link. Congratulations. You now have something worth passing around.",
  },
  {
    title: "Spread It Everywhere",
    body: "Text it. Email it. Post it. Drop it in a group chat. Slide into the DMs of every business owner you know without making it weird.",
  },
  {
    title: "Get Your $500",
    body: "If we can help them and their deal funds, Giftronaut sends you a $500 gift card of your choice.",
  },
];

export function AffiliateSteps() {
  // Collapsed on mobile; always open on desktop via the `lg:block` override.
  const [open, setOpen] = useState(false);

  return (
    <div className="relative rounded-2xl border border-black/5 bg-white p-6 sm:p-8 shadow-[0_24px_60px_-25px_rgba(0,3,33,0.18)] lg:sticky lg:top-28">
      <div
        aria-hidden
        className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cb-mint/50 to-transparent"
      />
      {/* Single heading. Tap-to-expand on mobile; static on desktop. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 mb-1 lg:mb-5 lg:cursor-default lg:pointer-events-none"
      >
        <span className="font-label text-[11px] font-bold uppercase tracking-[0.22em] text-cb-mint">
          Here&rsquo;s how this works
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`lg:hidden h-4 w-4 text-cb-mint transition-transform duration-300 ${
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
        className={`${open ? "block" : "hidden"} lg:block space-y-5 mt-4 lg:mt-0`}
      >
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span
              aria-hidden
              className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-cb-mint text-cb-navy font-headline text-sm font-extrabold tabular-nums shadow-[0_8px_18px_-6px_rgba(85,207,158,0.55)]"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="font-headline text-base sm:text-lg font-extrabold text-cb-ink leading-snug">
                {s.title}
              </p>
              <p className="text-sm text-cb-ink/60 leading-relaxed mt-1">
                {s.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
