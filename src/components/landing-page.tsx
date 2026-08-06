"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Reveal } from "@/components/ui/reveal"
import {
  Shield,
  Zap,
  Clock,
  CheckCircle,
  ArrowRight,
  Upload,
  FolderCheck,
  Send,
  Menu,
  X,
  Gift,
  DollarSign,
  Link2,
} from "lucide-react"

export function LandingPage() {
  const [activeStep, setActiveStep] = useState(1)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const pillars = [
    {
      icon: Zap,
      title: "Easy",
      description: "The Vault tells you what it needs. Documents are organized by type so you’re not guessing, renaming files, or sending things twice.",
    },
    {
      icon: Clock,
      title: "Fast",
      description: "No waiting. No wondering. Track progress live and submit directly to underwriting when you’re ready.",
    },
    {
      icon: Shield,
      title: "Secure",
      description: "Private means private. Encrypted storage and protected access. Nothing moves without your say-so.",
    },
  ]

  const steps = [
    { icon: Upload, title: "Upload", desc: "Put everything where it belongs. Drag and drop files or upload by category. The Vault keeps things organized from the start." },
    { icon: FolderCheck, title: "Track", desc: "See what’s done and what’s not. A live checklist shows what’s complete and what’s still missing." },
    { icon: Send, title: "Submit", desc: "Make it official. When everything’s complete, submit once and send your file straight to underwriting." },
  ]

  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink selection:bg-cb-mint/20">

      {/* header-navigation: Fixed navigation bar with logo and menu */}
      <header className="sticky top-0 z-50 w-full border-b border-black/5 bg-cb-cream/80 backdrop-blur-md">
        <div className="container mx-auto px-4">
          <div className="flex h-20 items-center justify-between">

            {/* logo-section: Company logo on the left — scrolls to top */}
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                aria-label="Back to top"
                className="flex items-center space-x-2 group"
              >
                <Image
                  src="/powered-by-shield.png"
                  alt="Credit Banc — Powered by Shield Advisory Group"
                  width={266}
                  height={45}
                  priority
                  className="h-11 w-auto transition-transform group-hover:scale-105"
                />
              </button>
            </div>

            {/* desktop-navigation: Navigation links for desktop */}
            <nav className="hidden md:flex items-center space-x-8">
              <Link href="#features" className="text-sm font-semibold uppercase tracking-wide text-cb-ink hover:text-cb-mint transition-colors">
                Features
              </Link>
              <Link href="#how-it-works" className="text-sm font-semibold uppercase tracking-wide text-cb-ink hover:text-cb-mint transition-colors">
                How It Works
              </Link>
              <Link href="/support" className="text-sm font-semibold uppercase tracking-wide text-cb-ink hover:text-cb-mint transition-colors">
                Support
              </Link>
            </nav>

            {/* desktop-cta-buttons: Action buttons for desktop */}
            <div className="hidden md:flex items-center space-x-6">
              <Button variant="ghost" size="sm" className="font-bold uppercase tracking-wide text-cb-ink hover:text-cb-mint hover:bg-transparent" asChild>
                <Link href="/auth/login">Log In</Link>
              </Button>
              <Button size="sm" className="rounded-full bg-cb-mint hover:bg-cb-mint/90 text-cb-navy font-bold uppercase tracking-wide px-7 h-10 shadow-md shadow-cb-mint/20" asChild>
                <a href="https://creditbanc.io/apply-now" target="_blank" rel="noopener noreferrer">Apply Now</a>
              </Button>
            </div>

            {/* mobile-menu-button: Hamburger menu for mobile */}
            <button
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6 text-cb-ink" />
              ) : (
                <Menu className="h-6 w-6 text-cb-ink" />
              )}
            </button>
          </div>

          {/* mobile-menu: Dropdown menu for mobile devices */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-black/5 py-6 animate-in slide-in-from-top duration-300">
              <nav className="flex flex-col space-y-4">
                <Link
                  href="#features"
                  className="text-base font-bold uppercase tracking-wide text-cb-ink hover:text-cb-mint transition-colors px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Features
                </Link>
                <Link
                  href="#how-it-works"
                  className="text-base font-bold uppercase tracking-wide text-cb-ink hover:text-cb-mint transition-colors px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  How It Works
                </Link>
                <Link
                  href="/support"
                  className="text-base font-bold uppercase tracking-wide text-cb-ink hover:text-cb-mint transition-colors px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Support
                </Link>
                <div className="flex flex-col space-y-3 pt-4 border-t border-black/5">
                  <Button variant="outline" size="lg" className="w-full rounded-full font-bold uppercase tracking-wide" asChild>
                    <Link href="/auth/login" onClick={() => setMobileMenuOpen(false)}>Log In</Link>
                  </Button>
                  <Button size="lg" className="w-full rounded-full bg-cb-mint hover:bg-cb-mint/90 text-cb-navy font-bold uppercase tracking-wide" asChild>
                    <a href="https://creditbanc.io/apply-now" target="_blank" rel="noopener noreferrer">Apply Now</a>
                  </Button>
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* hero-section: Main landing section with headline and CTAs */}
      <section className="relative w-full overflow-hidden">
        {/* soft mint gradient wash + aurora glows */}
        <div className="absolute inset-0 bg-gradient-to-br from-cb-mint/15 via-cb-cream to-white" />
        <div className="absolute top-0 left-1/4 w-[60%] h-[60%] bg-cb-mint/10 blur-[130px] rounded-full animate-aurora" />
        <div className="absolute bottom-0 right-1/4 w-[50%] h-[50%] bg-cb-mint/5 blur-[130px] rounded-full animate-aurora" style={{ animationDelay: '-4s' }} />

        <div className="container relative z-10 mx-auto px-4 pt-28 pb-24 text-center">
          <Reveal className="max-w-4xl mx-auto" distance={24}>
            {/* beta-tag-inline */}


            {/* headline: Main value proposition */}
            <h1 className="font-manrope text-5xl md:text-8xl font-extrabold mb-10 leading-[1.05] tracking-tight text-cb-ink">
              Upload. Track. <br />
              <span className="text-cb-mint whitespace-nowrap">Get Funded.</span>
            </h1>

            {/* subheadline: Detailed description of the service */}
            <p className="text-xl md:text-2xl mb-14 max-w-2xl mx-auto text-cb-ink/50 leading-relaxed font-medium">
              The fastest way to manage your funding documents. Upload in seconds, track progress live, and get your file to underwriting in <span className="text-cb-mint font-bold italic underline decoration-cb-mint/30 underline-offset-[12px]">24–48 hours.</span>
            </p>

            {/* cta-buttons: Primary and secondary call-to-action buttons */}
            <div className="flex flex-col sm:flex-row gap-5 justify-center items-center">
              <Button size="lg" className="text-xl px-12 py-9 h-auto bg-cb-mint text-cb-navy hover:bg-cb-mint/90 font-bold transition-all hover:scale-105 shadow-2xl shadow-cb-mint/30 active:scale-95" asChild>
                <a href="https://creditbanc.io/apply-now" target="_blank" rel="noopener noreferrer">
                  Start Now
                  <ArrowRight className="ml-3 h-6 w-6" />
                </a>
              </Button>
              <Button size="lg" variant="ghost" className="text-xl px-10 py-9 h-auto text-cb-ink hover:bg-white/50 transition-all font-bold" asChild>
                <Link href="#how-it-works">
                  See How It Works
                </Link>
              </Button>
            </div>

            {/* login-link: Link for existing users */}
            <div className="mt-12">
              <Link href="/auth/login" className="text-cb-gray hover:text-cb-mint transition-colors text-base font-bold border-b-2 border-transparent hover:border-cb-mint/20 pb-1">
                Already registered? <span className="text-cb-mint">Log in</span>
              </Link>
            </div>
          </Reveal>
        </div>

        {/* subtle divider */}
        <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-cb-cream to-transparent" />
      </section>

      {/* pillars-section: Three key value propositions */}
      <section id="features" className="container mx-auto px-4 py-24 relative">
        <div className="grid md:grid-cols-3 gap-10">
          {pillars.map((p, i) => (
            <Reveal key={i} delay={i * 0.12}>
            <Card className="text-center border border-black/5 shadow-sm hover:shadow-2xl transition-all duration-500 group hover:-translate-y-2 bg-white rounded-3xl overflow-hidden">
              <CardHeader className="pt-12">
                {/* pillar-icon: Icon representing each value proposition */}
                <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-cb-mint/10 group-hover:bg-cb-mint transition-all duration-500 shadow-inner group-hover:shadow-cb-mint/50">
                  <p.icon className="h-10 w-10 text-cb-mint group-hover:text-white transition-colors duration-500" />
                </div>
                <CardTitle className="font-manrope text-2xl font-extrabold text-cb-ink tracking-tight">{p.title}</CardTitle>
              </CardHeader>
              <CardContent className="pb-12 px-8">
                <CardDescription className="text-lg text-cb-ink/50 leading-relaxed font-medium">{p.description}</CardDescription>
              </CardContent>
            </Card>
            </Reveal>
          ))}
        </div>
      </section>

      {/* how-it-works-section: Step-by-step process explanation */}
      <section id="how-it-works" className="bg-white/60 py-32 border-y border-black/5">
        <div className="container mx-auto px-4">
          {/* section-header: Title and subtitle for the steps section */}
          <Reveal className="text-center mb-20">
            <h2 className="font-manrope text-5xl md:text-6xl font-extrabold text-cb-ink mb-6 tracking-tight">How It Works</h2>
            <div className="inline-block h-1.5 w-20 bg-cb-mint rounded-full mb-6" />
            <p className="text-xl text-cb-gray font-bold uppercase tracking-widest">Three steps. No surprises.</p>
          </Reveal>

          {/* steps-grid: Interactive cards showing the process */}
          <div className="grid lg:grid-cols-3 gap-10">
            {steps.map((s, idx) => (
              <Reveal key={idx} delay={idx * 0.12}>
              <Card
                className={`border border-black/5 shadow-xl transition-all duration-500 rounded-3xl p-4 ${activeStep === idx ? " ring-8 ring-cb-mint/5 bg-white scale-[1.05]" : "bg-white/60 opacity-80"}`}
                onMouseEnter={() => setActiveStep(idx)}
              >
                <CardHeader className="space-y-6 p-10 text-left">
                  {/* step-header: Icon and title for each step */}
                  <div className="flex items-center space-x-5">
                    <div className="rounded-2xl bg-cb-mint p-4 shadow-lg shadow-cb-mint/20">
                      <s.icon className="h-7 w-7 text-white" />
                    </div>
                    <CardTitle className="font-manrope text-3xl font-extrabold text-cb-ink tracking-tight">{s.title}</CardTitle>
                  </div>
                  <CardDescription className="text-xl text-cb-ink/50 leading-relaxed font-medium">{s.desc}</CardDescription>
                </CardHeader>
              </Card>
              </Reveal>
            ))}
          </div>

          {/* required-docs-callout: Highlighted information about required documents */}
          <Reveal className="mt-24 max-w-5xl mx-auto rounded-3xl border border-black/5 p-12 md:p-16 bg-white shadow-2xl relative overflow-hidden">
            <div className="relative z-10">
              <div className="mb-12 text-center">
                <h3 className="font-manrope text-3xl font-extrabold text-cb-ink mb-4 tracking-tight">Required Documents to Start</h3>
                <p className="text-xl text-cb-gray font-bold">Everything you need to get moving today:</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                {[
                  "6 months of business bank statements",
                  "Driver’s License (front and back)",
                  "Voided business check",
                  "Debt schedule (if applicable)"
                ].map((item, i) => (
                  <div key={i} className="flex items-center space-x-5 text-cb-ink text-xl group/item">
                    <div className="h-10 w-10 rounded-2xl bg-cb-mint/10 flex items-center justify-center shrink-0 group-hover/item:bg-cb-mint transition-all duration-300">
                      <CheckCircle className="h-6 w-6 text-cb-mint group-hover/item:text-white" />
                    </div>
                    <span className="font-bold tracking-tight">{item}</span>
                  </div>
                ))}
              </div>
              <p className="text-cb-gray text-lg text-center italic border-t border-black/5 pt-10 font-medium tracking-tight">
                The Vault tells you what’s needed, flags what’s missing, and skips everything that isn’t.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* affiliate-section: Public affiliate program signup */}
      <section id="affiliate" className="bg-cb-navy py-32 relative overflow-hidden">
        {/* glow */}
        <div className="absolute top-0 right-0 w-[40%] h-[60%] bg-cb-mint/10 blur-[130px] rounded-full" />
        <div className="absolute bottom-0 left-0 w-[40%] h-[50%] bg-cb-mint/5 blur-[130px] rounded-full" />

        <div className="container relative z-10 mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-16 items-center max-w-6xl mx-auto">
            {/* pitch */}
            <div className="text-white">
              <div className="inline-flex items-center space-x-2 bg-white/5 border border-cb-mint/20 rounded-full px-4 py-2 mb-8">
                <Badge className="bg-cb-mint text-cb-navy hover:bg-cb-mint font-bold border-none">PARTNERS</Badge>
                <span className="text-sm text-white/50 font-bold uppercase tracking-[0.2em]">Affiliate Program</span>
              </div>
              <h2 className="font-manrope text-4xl md:text-6xl font-extrabold mb-8 tracking-tight leading-tight">
                Refer. <span className="text-cb-mint">Get Paid.</span>
              </h2>
              <p className="text-xl text-white/60 mb-12 leading-relaxed font-medium max-w-lg">
                Share your link, send us business owners who need funding, and earn <span className="text-cb-mint font-bold">$500</span> for every referral that gets funded. It's that simple.
              </p>

              <div className="space-y-6">
                {[
                  { icon: Link2, title: "Get your link", desc: "Sign up and get a unique referral link instantly." },
                  { icon: Gift, title: "Refer anyone", desc: "Send business owners through our quick pre-qualification form." },
                  { icon: DollarSign, title: "Earn $500 per funded deal", desc: "Paid out via Giftronaut the moment your referral gets funded." },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-5">
                    <div className="h-12 w-12 rounded-2xl bg-cb-mint/15 border border-cb-mint/20 flex items-center justify-center shrink-0">
                      <item.icon className="h-6 w-6 text-cb-mint" />
                    </div>
                    <div>
                      <h4 className="font-manrope text-lg font-bold text-white tracking-tight">{item.title}</h4>
                      <p className="text-white/50 font-medium">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* signup CTA — dedicated page */}
            <div className="rounded-3xl bg-white/5 border border-cb-mint/20 p-12 text-center">
              <div className="mx-auto w-16 h-16 bg-cb-mint/20 rounded-2xl flex items-center justify-center mb-6 border border-cb-mint/30">
                <Gift className="h-8 w-8 text-cb-mint" />
              </div>
              <h3 className="font-manrope text-3xl font-extrabold text-white uppercase tracking-tight mb-3">Become an Affiliate</h3>
              <p className="text-white/60 font-medium mb-8">
                Sign up free and start earning $500 for every funded referral.
              </p>
              <Button
                size="lg"
                className="text-lg px-10 py-8 h-auto bg-cb-mint text-cb-navy hover:bg-cb-mint/90 font-bold rounded-xl shadow-2xl shadow-cb-mint/30 transition-all hover:scale-105 active:scale-95"
                asChild
              >
                <Link href="/affiliate">
                  Join the Program
                  <ArrowRight className="ml-3 h-6 w-6" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* final-cta-section: Last call-to-action before footer */}
      <section className="container mx-auto px-4 py-32 text-center">
        <div className="max-w-5xl mx-auto bg-cb-navy rounded-3xl p-16 md:p-24 shadow-2xl relative overflow-hidden">
          {/* visual punch */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-cb-mint/20 blur-[100px] rounded-full -mr-48 -mt-48 animate-pulse" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-cb-mint/10 blur-[100px] rounded-full -ml-48 -mb-48" />

          <h2 className="font-manrope text-4xl md:text-7xl font-extrabold text-white mb-8 tracking-tight leading-tight">Ready to get <br />things moving?</h2>
          <p className="text-xl md:text-2xl text-white/60 mb-14 max-w-3xl mx-auto leading-relaxed font-medium">
            Schedule a call with our advisors to get your account created and start uploading documents to the <span className="text-cb-mint font-bold uppercase tracking-widest">Credit Banc Vault</span>.
          </p>
          <Button size="lg" className="text-2xl px-14 py-10 h-auto bg-cb-mint text-cb-navy hover:bg-cb-mint/90 font-bold transition-all hover:scale-105 shadow-2xl shadow-cb-mint/40 active:scale-95" asChild>
            <a href="https://creditbanc.io/apply-now" target="_blank" rel="noopener noreferrer" className="flex items-center">
              Start Now
            </a>
          </Button>

          <div className="mt-14">
            <Link href="/auth/login" className="text-white/50 hover:text-white transition-colors text-lg font-bold tracking-tight border-b-2 border-white/10 hover:border-white/20 pb-1">
              Already registered? <span className="text-cb-mint underline">Log in</span>
            </Link>
          </div>
        </div>
      </section>

      {/* footer: Strictly simplified footer per USER request */}
      <footer className="bg-cb-navy text-white py-20 relative overflow-hidden">
        {/* color grading/shine from CTA */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cb-mint/30 to-transparent" />

        <div className="container mx-auto px-4 relative z-10 flex flex-col items-center space-y-8">
          <a
            href="https://creditbanc.io"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="creditbanc.io"
            className="transition-all hover:scale-110 active:scale-95 group"
          >
            <Image
              src="/CBLOGOWHITE.png"
              alt="Credit Banc"
              width={1000}
              height={200}
              priority
              className="h-12 w-auto opacity-90 group-hover:opacity-100 transition-opacity"
            />
          </a>

          <div className="h-px w-24 bg-white/10" />

          <p className="text-white/20 text-xs font-bold uppercase tracking-[0.4em]">
            © {new Date().getFullYear()} Credit Banc. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}