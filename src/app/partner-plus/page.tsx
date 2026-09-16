// src/app/partner-plus/page.tsx
//
// PUBLIC Partner+ signup. Pay first: the form hands off to Stripe Checkout, and
// the webhook creates the account once the card clears. Public via the exact
// entry in src/proxy.ts.
//
// This is a SALES page for a paid product, so it uses the marketing section
// grammar (docs/design-system-import.md §5, §7 "full treatment"), not
// BrandAuthShell — that shell is for single-card utility pages like login, and
// on this page it left the offer floating in a cream void.
//
// Section rhythm: cream hero (headline + form) → green band (what you get) →
// cream timeline (what happens after you pay) → navy footer.
//
// ALIGNMENT. Every section's content box is `mx-auto max-w-6xl px-4` with the
// padding INSIDE the max-width, exactly like the shared BrandHeader, so the
// header and each section share one left edge. Padding on the <section> instead
// looks identical in code review and sits 16px off at desktop widths.
//
// Known, and NOT a layout bug: powered-by-shield.png carries ~268px of
// transparent padding on its left, so the logo's visible mark renders ~67px
// inside that shared edge. It's the same on every page using BrandHeader. Fix
// it by cropping the asset, never by nudging this page's layout to match.

import Link from "next/link";
import { LayoutDashboard, Network, ShieldCheck, Upload, type LucideIcon } from "lucide-react";
import { BrandBackdrop, BrandFooter, BrandHeader, CTA } from "@/components/marketing/brand-chrome";
import { Reveal } from "@/components/ui/reveal";
import { PartnerPlusHero } from "./_components/partner-plus-hero";
import { PartnerPlusSignupForm } from "./_components/partner-plus-signup-form";

export const metadata = {
  title: "Partner+ | Credit Banc",
  description: "Submit your deals to Credit Banc underwriting for $100/month.",
};

/** The standard deep-emerald band. One of the sanctioned stops — do not invent greens. */
const GREEN_BAND = "linear-gradient(135deg, #1f6b4e 0%, #2ea878 50%, #34b07d 100%)";

/** The spec's masked grid texture for colored bands (design-system-import.md §6). */
const GRID_OVERLAY: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
  backgroundSize: "56px 56px",
  maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
  WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
};

// The four benefits the page already promised. Each body says something its
// title doesn't — the first version restated every title in its own sentence
// ("Our lender network / Access to our lender network…"). No new claims.
const BENEFITS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: LayoutDashboard, title: "Your own deal desk", body: "Every client and file you submit, in one place." },
  { icon: ShieldCheck, title: "Underwriting that closes", body: "Our team works the file, approves it and closes it." },
  { icon: Upload, title: "A portal for borrowers", body: "Borrowers upload their own documents, securely." },
  { icon: Network, title: "Our lender network", body: "Options for the deals outside your usual lenders." },
];

// Numbered because it genuinely is a sequence, and it is the real one: the
// webhook provisions on payment, /desk onboarding collects these five things,
// and underwriting — never the rep — records a deal as funded. Step 3 no longer
// restates "works, approves and closes": the band's underwriting card already
// says it, and the first version said it twice on one screen.
const STEPS = [
  {
    title: "Subscribe",
    body: "$100 a month per login, paid through Stripe. Your account is created when your card clears.",
  },
  {
    title: "Set up your desk",
    body: "Choose a password, add your phone and photo, sign your W-9 and upload a voided check.",
  },
  {
    title: "Submit deals",
    body: "Bring on clients and send their files in. Our underwriting team takes it from there.",
  },
];

/** Circle size, shared by the markers and the connectors that must meet them. */
const NODE = "h-14 w-14"; // 56px — connectors below are positioned against 28px (its center)

function Eyebrow({ children, tone = "mint" }: { children: React.ReactNode; tone?: "mint" | "light" }) {
  return (
    <p
      className={`font-label text-[11px] font-bold uppercase tracking-[0.22em] ${
        tone === "mint" ? "text-cb-mint" : "text-white/70"
      }`}
    >
      {children}
    </p>
  );
}

export default async function PartnerPlusPage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}) {
  const { canceled } = await searchParams;

  const signupCard = (
    <div
      id="signup"
      className="rounded-3xl border border-black/5 bg-white p-7 shadow-[0_40px_90px_-40px_rgba(0,3,33,0.35)] sm:p-9"
    >
      <h2 className="font-headline text-2xl font-extrabold tracking-tight text-cb-navy">Start your desk</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-on-surface-variant">
        You&apos;ll add payment on the next screen, through Stripe.
      </p>

      {canceled && (
        <div className="mt-5 rounded-xl border border-cb-mint/30 bg-cb-mint/10 p-4 text-sm leading-relaxed text-cb-navy">
          <span className="font-bold">Checkout canceled.</span> No charge was made. Start again below whenever
          you&apos;re ready.
        </div>
      )}

      <div className="mt-7">
        <PartnerPlusSignupForm />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink selection:bg-cb-mint/20">
      <BrandHeader
        action={
          <Link href="/auth/login" className="text-sm font-semibold text-cb-gray transition-colors hover:text-cb-ink">
            Already a member? <span className="font-bold text-cb-mint">Log in</span>
          </Link>
        }
      />

      <section className="relative overflow-hidden pb-20 pt-12 sm:pb-28 sm:pt-16">
        <BrandBackdrop />
        <div className="relative z-10">
          <PartnerPlusHero form={signupCard} />
        </div>
      </section>

      {/* ── What you get. Split: a real headline gives the band an entry point,
             and white cards on green carry the contrast the text-only version
             lost toward the lighter right edge of the gradient. 2×2 rather than
             4-up so no title is ever forced onto two lines beside one-liners. ── */}
      <section className="relative overflow-hidden py-20 sm:py-28" style={{ background: GREEN_BAND }}>
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={GRID_OVERLAY} />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-white/10 blur-3xl"
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <Reveal>
            <Eyebrow tone="light">What you get</Eyebrow>
            <h2 className="mt-4 font-headline text-4xl font-extrabold leading-[1.02] tracking-tighter text-white sm:text-5xl">
              {/* Explicit break: left to wrap on its own, a phone split it as
                  "…the deal. We / bring everything", tearing "We bring" apart. */}
              You bring the deal.
              <br />
              We bring everything behind it.
            </h2>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
            {BENEFITS.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 0.1} distance={20} className="h-full">
                <div className="flex h-full flex-col rounded-2xl bg-white p-6 shadow-[0_14px_34px_-18px_rgba(32,37,54,0.55)]">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-container/40 text-on-primary-container">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-5 font-headline text-xl font-extrabold tracking-tight text-cb-navy">{title}</h3>
                  <p className="mt-2 leading-relaxed text-on-surface-variant">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works, as a connected timeline. Deliberately NOT cards: the
             band above is already a card grid, and three more boxes read as
             "card grid, card grid" instead of as a sequence. Desktop: one mint
             line runs through all three markers. Phone: a vertical line joins
             each marker to the next. The button sits on the timeline's axis so
             it reads as the step after step 3. ── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <Reveal className="text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mx-auto mt-4 max-w-3xl font-headline text-4xl font-extrabold leading-[1.02] tracking-tighter text-cb-navy sm:text-5xl">
              From signup to your first submission.
            </h2>
          </Reveal>

          <ol className="relative mt-14 grid gap-10 md:mt-20 md:grid-cols-3 md:gap-8" data-timeline>
            {/* Desktop connector: from the first marker's center to the last's.
                A column's center is (100% − 2 gaps) / 6 in from each edge; the
                gap is md:gap-8 (2rem), hence 4rem. top = marker center − 1px. */}
            <span
              aria-hidden
              className="absolute left-[calc((100%-4rem)/6)] right-[calc((100%-4rem)/6)] top-[27px] hidden h-0.5 bg-cb-mint/40 md:block"
            />

            {STEPS.map((step, i) => (
              <li key={step.title} className="relative">
                {/* Phone connector: from this marker's bottom edge down to the
                    next marker's top, across the 2.5rem (gap-10) between items. */}
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-[27px] top-14 h-[calc(100%-3.5rem+2.5rem)] w-0.5 bg-cb-mint/40 md:hidden"
                  />
                )}
                <Reveal
                  delay={i * 0.12}
                  distance={20}
                  className="relative flex gap-5 md:flex-col md:items-center md:gap-6 md:text-center"
                >
                  <span
                    className={`relative z-10 flex ${NODE} shrink-0 items-center justify-center rounded-full bg-cb-mint font-headline text-xl font-extrabold text-cb-navy shadow-[0_8px_18px_-6px_rgba(85,207,158,0.55)] ring-8 ring-cb-cream`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 pt-2.5 md:pt-0">
                    <h3 className="font-headline text-2xl font-extrabold tracking-tight text-cb-navy">{step.title}</h3>
                    <p className="mt-2 leading-relaxed text-on-surface-variant md:mx-auto md:max-w-[17rem]">
                      {step.body}
                    </p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>

          <Reveal className="mt-14 flex justify-center md:mt-16">
            <a href="#signup" className={`${CTA.primary} h-14 py-0`}>
              Start your desk
            </a>
          </Reveal>
        </div>
      </section>

      <BrandFooter />
    </div>
  );
}
