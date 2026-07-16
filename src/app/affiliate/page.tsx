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
  { icon: Link2, title: "Get your link", desc: "Sign up and get a unique referral link instantly." },
  { icon: Gift, title: "Refer anyone", desc: "Send business owners through our quick pre-qualification form." },
  { icon: DollarSign, title: "Earn $500 per funded deal", desc: "Paid out via Giftronaut the moment your referral gets funded." },
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
                Refer. <span className="text-cb-mint">Get Paid.</span>
              </h1>

              <p className="text-xl md:text-2xl text-cb-mint font-semibold mb-12 leading-relaxed max-w-lg">
                Share your link, send us business owners who need funding, and earn{" "}
                <span className="text-cb-ink font-bold">$500</span> for every referral that gets funded. It's that simple.
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
            </div>

            {/* signup form */}
            <div>
              <AffiliateSignUpForm />
            </div>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="bg-cb-navy text-white py-16 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cb-mint/30 to-transparent" />

        <div className="max-w-6xl mx-auto px-4 relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6">
          <p className="text-white/30 text-xs font-bold uppercase tracking-[0.3em]">
            © {new Date().getFullYear()} Credit Banc. All rights reserved.
          </p>
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
