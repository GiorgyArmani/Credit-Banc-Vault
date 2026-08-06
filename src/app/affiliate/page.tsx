// src/app/affiliate/page.tsx
//
// PUBLIC dedicated affiliate-program signup page. The marketing site (base
// domain) links here (vault.creditbanc.io/affiliate). Anyone can view it — the
// role gate lives one level down in /affiliate/dashboard. See [[role_model]].
//
// Layout mirrors the marketing site's apply-now funnel: centered hero (headline
// + metrics), a labelled divider, then the signup form with the "how this
// works" steps card beside it (sticky on desktop, foldable on mobile).
//
// Aesthetic matches the creditbanc.io marketing site: warm cream background
// (cb-cream #faf9f6), mint primary (cb-mint #55cf9e), navy surfaces
// (cb-navy #202536), Manrope headlines / Inter body, restrained radii.

import Link from "next/link";
import { AffiliateSignUpForm } from "@/components/affiliate-sign-up-form";
import { BrandHeader, BrandFooter, BrandBackdrop, Eyebrow } from "@/components/marketing/brand-chrome";
import { AffiliateHero } from "./_components/affiliate-hero";
import { AffiliateSteps } from "./_components/affiliate-steps";

export const dynamic = "force-dynamic";

// Program rules. Shown in full on the page (not hidden behind a link) — these
// are the terms the $500 reward actually hangs on.
const FINE_PRINT = [
  'To receive a $500 gift card, the business owner you refer must apply through your personal “I Know Someone” Club link, and their deal must be successfully funded through Credit Banc. A tiny but very important little detail.',
  'Rewards are issued after the referred deal funds and all required closing conditions are complete. One reward is available per funded referred business, unless otherwise approved by Credit Banc.',
  'There is no limit to the number of business owners you can refer. One link. As many eligible introductions as you can make. Your contact list finally has a job.',
  'Self-referrals, duplicate referrals, fake applications, incomplete applications, or referrals already in Credit Banc’s system may not qualify. Credit Banc reserves the right to determine referral eligibility, because someone, somewhere, will absolutely try to get creative and ruin a nice thing.',
  'Gift cards are subject to availability and may be selected from approved options provided by Credit Banc. Rewards may be subject to tax reporting requirements, and recipients are responsible for any applicable taxes. The IRS, as usual, has entered the chat.',
  'Funding is not guaranteed. All funding requests are subject to review, approval, underwriting, and program availability. We would love to help everyone, but underwriting does occasionally insist on being involved.',
  'Please do not represent yourself as an employee, lender, broker, or advisor of Credit Banc unless you have a separate written agreement with us. Your job is simple: share your link with business owners who may want to talk with Credit Banc. We’ll handle the money side.',
];

export default function AffiliateSignupPage() {
  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink selection:bg-cb-mint/20">
      <BrandHeader
        action={
          <Link
            href="/auth/login"
            className="text-sm font-semibold text-cb-gray hover:text-cb-ink transition-colors"
          >
            Already an affiliate? <span className="text-cb-mint font-bold">Log in</span>
          </Link>
        }
      />

      <section className="relative w-full overflow-hidden px-4 sm:px-6 pt-8 sm:pt-12 pb-12 sm:pb-16">
        <BrandBackdrop />

        <div className="max-w-7xl mx-auto relative z-10">
          <AffiliateHero />

          {/* Divider between hero and form */}
          <div className="max-w-6xl mx-auto mt-2 mb-10 sm:mb-14 flex items-center gap-4">
            <div className="flex-1 h-px bg-black/10" />
            <span className="font-label text-[11px] font-bold uppercase tracking-[0.22em] text-cb-mint whitespace-nowrap">
              Start your sign-up
            </span>
            <div className="flex-1 h-px bg-black/10" />
          </div>

          {/* Form (left) + "how this works" steps (right) on desktop. On mobile
              they stack — form first so it's reachable immediately, steps below
              it as a foldable card. */}
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_340px] gap-8 lg:gap-12 items-start">
            <AffiliateSignUpForm />
            <AffiliateSteps />
          </div>

          <p className="max-w-6xl mx-auto mt-12 sm:mt-16 text-center font-headline text-2xl md:text-3xl font-extrabold tracking-tight text-cb-ink leading-tight">
            One good introduction. <span className="text-cb-mint">A very happy ending.</span>
          </p>
        </div>
      </section>

      {/* the fine print */}
      <section className="bg-white border-t border-black/5">
        <div className="max-w-4xl mx-auto px-4 py-20 md:py-24">
          <Eyebrow className="mb-4">The Fine Print</Eyebrow>
          <h2 className="font-manrope text-3xl md:text-4xl font-extrabold tracking-tight text-cb-ink leading-tight">
            The part written by grown-ups.
          </h2>

          <ol className="mt-10 space-y-6">
            {FINE_PRINT.map((item, i) => (
              <li key={i} className="flex items-start gap-5">
                <span className="mt-0.5 h-8 w-8 shrink-0 rounded-lg bg-cb-mint/10 flex items-center justify-center font-manrope text-sm font-extrabold text-cb-mint">
                  {i + 1}
                </span>
                <p className="text-[15px] leading-relaxed text-cb-ink/70">{item}</p>
              </li>
            ))}
          </ol>

          <p className="mt-10 text-sm text-cb-ink/50">
            Joining also means you agree to our{" "}
            <Link href="/terms" className="font-bold text-cb-mint hover:underline">
              Terms and Conditions
            </Link>{" "}
            and{" "}
            <a
              href="https://www.creditbanc.io/privacypolicy"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-cb-mint hover:underline"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </section>

      <BrandFooter />
    </div>
  );
}
