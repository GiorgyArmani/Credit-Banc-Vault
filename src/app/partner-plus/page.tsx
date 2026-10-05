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
// cream timeline (what happens after you pay) → white "who it's for" → navy footer.
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
import { BrandBackdrop, BrandFooter, BrandHeader, CTA } from "@/components/marketing/brand-chrome";
import { Reveal } from "@/components/ui/reveal";
import { BenefitsCarousel } from "./_components/benefits-carousel";
import { StepsTimeline } from "./_components/steps-timeline";
import { PartnerPlusHero } from "./_components/partner-plus-hero";
import { PartnerPlusSignupForm } from "./_components/partner-plus-signup-form";

export const metadata = {
  title: "Partner+ | Credit Banc",
  description:
    "Got a deal? Bring it here. Full access to the Credit Banc Vault, plus the team, technology, and lender network behind it — $100/month.",
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

// Numbered because it genuinely is a sequence, and it is the real one: the
// webhook provisions on payment, /desk onboarding collects the partner profile,
// then deals go in and our team works them.
const STEPS = [
  {
    title: "Join Partner Plus",
    body: "Subscribe for $100/month and get access to your Credit Banc Vault.",
  },
  {
    title: "Set up your desk",
    body: "Create your login, complete your partner profile, and get your account ready to roll.",
  },
  {
    title: "Send us the deal",
    body: "Add your client, send them a secure upload link, or drop the documents directly into the Vault.",
  },
  {
    title: "We get to work",
    body: "Our team reviews the file, figures out the best financing route, packages it up properly, and works it through the lender process with you.",
  },
];

const PROFESSIONS = [
  "Consultants",
  "Accountants",
  "Fractional CFOs",
  "Business Brokers",
  "Commercial Real Estate Pros",
  "Equipment Dealers",
  "Insurance Professionals",
  "Coaches",
  "Advisors",
];

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
      <h2 className="font-headline text-2xl font-extrabold tracking-tight text-cb-navy">
        Open your Partner Plus account
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-on-surface-variant">
        Enter your information below. You&apos;ll complete payment securely through Stripe on the next screen.
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
             and a white card on green carries the contrast the text-only version
             lost toward the lighter right edge of the gradient. One benefit at a
             time (BenefitsCarousel): six paragraph cards in a grid were a wall. ── */}
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
              We bring the backup.
            </h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-white/80">
              You don&apos;t need to become a lending expert. That&apos;s our problem now. Partner Plus gives you
              the tools, team, and lender access to handle more financing requests without building the whole
              operation yourself.
            </p>
          </Reveal>

          <Reveal delay={0.1} distance={20} className="min-w-0">
            <BenefitsCarousel />
          </Reveal>
        </div>
      </section>

      {/* ── How it works, as a connected timeline. Deliberately NOT cards: the
             band above is already a white card, and four more boxes read as
             more cards instead of as a sequence. StepsTimeline animates the
             fill advancing marker to marker. The button sits on the timeline's axis so
             it reads as the step after step 4. ── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4">
          <Reveal className="text-center">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mx-auto mt-4 max-w-3xl font-headline text-4xl font-extrabold leading-[1.02] tracking-tighter text-cb-navy sm:text-5xl">
              Four steps. Then we get to work.
            </h2>
          </Reveal>

          <StepsTimeline steps={STEPS} />

          <Reveal className="mt-14 flex justify-center lg:mt-16">
            <a href="#signup" className={`${CTA.primary} h-14 py-0`}>
              Open your account
            </a>
          </Reveal>
        </div>
      </section>

      {/* ── Who it's for. White, not cream, so it separates from the cream
             timeline above and the navy footer below. Professions are
             chips rather than a bullet-joined line so they wrap cleanly. Hover
             lifts + fills mint; text stays navy (white-on-mint fails contrast). ── */}
      <section className="bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <Reveal>
            <Eyebrow>Who it&apos;s for</Eyebrow>
            <h2 className="mx-auto mt-4 max-w-3xl font-headline text-4xl font-extrabold leading-[1.02] tracking-tighter text-cb-navy sm:text-5xl">
              Add financing to your toolbox.
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-on-surface-variant">
              Partner Plus is built for professionals who work with business owners and want a better way to
              handle financing when it comes up.
            </p>
          </Reveal>

          <Reveal delay={0.1} className="mt-12">
            <p className="font-label text-xs font-bold uppercase tracking-[0.18em] text-cb-gray">
              Built for professionals like
            </p>
            <ul className="mx-auto mt-5 flex max-w-4xl flex-wrap justify-center gap-2.5 sm:gap-3">
              {PROFESSIONS.map((p) => (
                <li
                  key={p}
                  className="cursor-default rounded-full border border-cb-mint/30 bg-cb-mint/10 px-4 py-2 text-sm font-semibold text-cb-navy transition-all duration-200 ease-out hover:border-cb-mint hover:bg-cb-mint hover:shadow-[0_10px_22px_-10px_rgba(85,207,158,0.8)] motion-safe:hover:-translate-y-1 sm:text-base"
                >
                  {p}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.2}>
            <p className="mx-auto mt-12 max-w-2xl font-headline text-xl font-extrabold tracking-tight text-cb-navy">
              You don&apos;t need to know every lender, loan program, or underwriting rule. That&apos;s what
              we&apos;re here for.
            </p>
          </Reveal>
        </div>
      </section>

      <BrandFooter />
    </div>
  );
}
