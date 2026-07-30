// src/app/affiliate/page.tsx
//
// PUBLIC dedicated affiliate-program signup page. The marketing site (base
// domain) links here (vault.creditbanc.io/affiliate). Anyone can view it — the
// role gate lives one level down in /affiliate/dashboard. See [[role_model]].
//
// Aesthetic matches the creditbanc.io marketing site: warm cream background
// (cb-cream #faf9f6), mint primary (cb-mint #55cf9e), navy surfaces
// (cb-navy #202536), Manrope headlines / Inter body, restrained radii.

import Link from "next/link";
import Image from "next/image";
import { AffiliateSignUpForm } from "@/components/affiliate-sign-up-form";
import { Badge } from "@/components/ui/badge";
import { Gift, DollarSign, Link2 } from "lucide-react";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    icon: Link2,
    title: "Get the Link",
    desc: "Sign up and get your personal referral link. Congratulations. You now have something worth passing around.",
  },
  {
    icon: Gift,
    title: "Spread It Everywhere",
    desc: "Text it. Email it. Post it. Drop it in a group chat. Slide into the DMs of every business owner you know without making it weird.",
  },
  {
    icon: DollarSign,
    title: "Get Your $500",
    desc: "If we can help them and their deal funds, Giftronaut sends you a $500 gift card of your choice.",
  },
];

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
      {/* header */}
      <header className="sticky top-0 z-50 w-full border-b border-black/5 bg-cb-cream/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center group">
            <Image
              src="/powered-by-shield.png"
              alt="Credit Banc — Powered by Shield Advisory Group"
              width={1128}
              height={191}
              priority
              className="h-12 w-auto transition-transform group-hover:scale-105"
            />
          </Link>
          <Link
            href="/auth/login"
            className="text-sm font-semibold text-cb-gray hover:text-cb-ink transition-colors"
          >
            Already an affiliate? <span className="text-cb-mint font-bold">Log in</span>
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="relative w-full overflow-hidden">
        {/* soft mint gradient wash + aurora glows */}
        <div className="absolute inset-0 bg-gradient-to-br from-cb-mint/15 via-cb-cream to-white" />
        <div className="absolute top-0 left-1/4 w-[55%] h-[55%] bg-cb-mint/10 blur-[130px] rounded-full animate-aurora" />
        <div className="absolute bottom-0 right-1/4 w-[45%] h-[45%] bg-cb-mint/5 blur-[130px] rounded-full animate-aurora" style={{ animationDelay: "-4s" }} />

        <div className="max-w-6xl mx-auto px-4 py-20 md:py-28 relative z-10">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* pitch */}
            <div>
              <div className="inline-flex items-center space-x-2 bg-white border border-black/5 rounded-full px-4 py-2 mb-10 shadow-sm">
                <Badge className="bg-cb-mint text-white hover:bg-cb-mint font-bold border-none shadow-sm">PARTNERS</Badge>
                <span className="text-sm text-cb-gray font-bold uppercase tracking-[0.2em]">Affiliate Program</span>
              </div>

              <h1 className="font-manrope text-5xl md:text-7xl font-extrabold mb-8 tracking-tight leading-[1.05] text-cb-ink">
                Refer. <span className="text-cb-mint">Get Paid.</span> Repeat.
              </h1>

              <p className="text-xl md:text-2xl text-cb-mint font-semibold mb-12 leading-relaxed max-w-lg">
                Join our Affiliate Program and turn the business owners you know into{" "}
                <span className="text-cb-ink font-bold">$500</span> rewards, one useful introduction at a time. Cha-ching!
              </p>

              <div className="space-y-6">
                {STEPS.map((item, i) => (
                  <div key={i} className="flex items-start gap-5 group">
                    <div className="h-12 w-12 rounded-xl bg-cb-mint/10 flex items-center justify-center shrink-0 group-hover:bg-cb-mint transition-colors duration-300">
                      <item.icon className="h-6 w-6 text-cb-mint group-hover:text-white transition-colors duration-300" />
                    </div>
                    <div>
                      <h4 className="font-manrope text-lg font-bold text-cb-ink tracking-tight">{item.title}</h4>
                      <p className="text-cb-ink/50">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-10 font-manrope text-2xl md:text-3xl font-extrabold tracking-tight text-cb-ink leading-tight">
                One good introduction. <span className="text-cb-mint">A very happy ending.</span>
              </p>
            </div>

            {/* signup form */}
            <div>
              <AffiliateSignUpForm />
            </div>
          </div>
        </div>
      </section>

      {/* the fine print */}
      <section className="bg-white border-t border-black/5">
        <div className="max-w-4xl mx-auto px-4 py-20 md:py-24">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-cb-mint mb-4">
            The Fine Print
          </p>
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

      {/* footer */}
      <footer className="bg-cb-navy text-white py-16 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cb-mint/30 to-transparent" />

        <div className="max-w-6xl mx-auto px-4 relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
            <p className="text-white/30 text-xs font-bold uppercase tracking-[0.3em]">
              © {new Date().getFullYear()} Credit Banc. All rights reserved.
            </p>
            <div className="flex items-center gap-6">
              <Link
                href="/terms"
                className="text-white/50 hover:text-white text-xs font-bold uppercase tracking-[0.3em] transition-colors"
              >
                Terms
              </Link>
              <a
                href="https://www.creditbanc.io/privacypolicy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/50 hover:text-white text-xs font-bold uppercase tracking-[0.3em] transition-colors"
              >
                Privacy
              </a>
            </div>
          </div>
          <a
            href="https://creditbanc.io"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="creditbanc.io"
            className="group inline-flex items-center transition-opacity hover:opacity-80"
          >
            <Image
              src="/CBLOGOWHITE.png"
              alt="Credit Banc"
              width={1000}
              height={200}
              className="h-8 w-auto"
            />
          </a>
        </div>
      </footer>
    </div>
  );
}
