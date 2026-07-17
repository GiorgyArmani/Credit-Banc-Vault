"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Shield,
  Zap,
  Clock,
  CheckCircle,
  ArrowRight,
  Play,
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
    <div className="min-h-screen bg-white font-sans selection:bg-emerald-100 selection:text-emerald-900">

      {/* header-navigation: Fixed navigation bar with logo and menu */}
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
        <div className="container mx-auto px-4">
          <div className="flex h-20 items-center justify-between">

            {/* logo-section: Company logo on the left */}
            <div className="flex items-center">
              <Link href="/" className="flex items-center space-x-2 group">
                <Image
                  src="/powered-by-shield.png"
                  alt="Credit Banc — Powered by Shield Advisory Group"
                  width={266}
                  height={45}
                  priority
                  className="h-11 w-auto transition-transform group-hover:scale-105"
                />
              </Link>
            </div>

            {/* desktop-navigation: Navigation links for desktop */}
            <nav className="hidden md:flex items-center space-x-8">
              <Link href="#features" className="text-sm font-semibold text-gray-600 hover:text-emerald-600 transition-colors">
                Features
              </Link>
              <Link href="#how-it-works" className="text-sm font-semibold text-gray-600 hover:text-emerald-600 transition-colors">
                How It Works
              </Link>
              <Link href="/affiliate" className="text-sm font-semibold text-gray-600 hover:text-emerald-600 transition-colors">
                Affiliate Program
              </Link>
              <Link href="/support" className="text-sm font-semibold text-gray-600 hover:text-emerald-600 transition-colors">
                Support
              </Link>
            </nav>

            {/* desktop-cta-buttons: Action buttons for desktop */}
            <div className="hidden md:flex items-center space-x-4">
              <Button variant="ghost" size="sm" className="font-bold text-gray-700" asChild>
                <Link href="/auth/login">Log In</Link>
              </Button>
              <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-6 shadow-md shadow-emerald-500/10" asChild>
                <a href="https://creditbanc.io/apply-now" target="_blank" rel="noopener noreferrer">Schedule Call</a>
              </Button>
            </div>

            {/* mobile-menu-button: Hamburger menu for mobile */}
            <button
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6 text-gray-700" />
              ) : (
                <Menu className="h-6 w-6 text-gray-700" />
              )}
            </button>
          </div>

          {/* mobile-menu: Dropdown menu for mobile devices */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t py-6 animate-in slide-in-from-top duration-300">
              <nav className="flex flex-col space-y-4">
                <Link
                  href="#features"
                  className="text-base font-bold text-gray-700 hover:text-emerald-600 transition-colors px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Features
                </Link>
                <Link
                  href="#how-it-works"
                  className="text-base font-bold text-gray-700 hover:text-emerald-600 transition-colors px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  How It Works
                </Link>
                <Link
                  href="/affiliate"
                  className="text-base font-bold text-gray-700 hover:text-emerald-600 transition-colors px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Affiliate Program
                </Link>
                <Link
                  href="/support"
                  className="text-base font-bold text-gray-700 hover:text-emerald-600 transition-colors px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Support
                </Link>
                <div className="flex flex-col space-y-3 pt-4 border-t">
                  <Button variant="outline" size="lg" className="w-full font-bold" asChild>
                    <Link href="/auth/login" onClick={() => setMobileMenuOpen(false)}>Log In</Link>
                  </Button>
                  <Button size="lg" className="w-full bg-emerald-500 hover:bg-emerald-600 font-bold" asChild>
                    <a href="https://creditbanc.io/apply-now" target="_blank" rel="noopener noreferrer">Get Started</a>
                  </Button>
                </div>
              </nav>
            </div>
          )}
        </div>
      </header>

      {/* hero-section: Main landing section with headline and CTAs */}
      <section className="relative w-full bg-[#f0fdf7] overflow-hidden">
        {/* mint aurora-glow effect for clarity */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/50 via-white/80 to-white" />
        <div className="absolute top-0 left-1/4 w-[60%] h-[60%] bg-emerald-300/10 blur-[130px] rounded-full animate-aurora" />
        <div className="absolute bottom-0 right-1/4 w-[50%] h-[50%] bg-blue-200/5 blur-[130px] rounded-full animate-aurora" style={{ animationDelay: '-4s' }} />

        <div className="container relative z-10 mx-auto px-4 pt-28 pb-24 text-center">
          <div className="max-w-4xl mx-auto">
            {/* beta-tag-inline */}
           

            {/* headline: Main value proposition */}
            <h1 className="text-5xl md:text-8xl font-black mb-10 leading-[1.05] tracking-tight text-emerald-950">
              Upload. Track. <br className="sm:hidden" />
              <span className="text-emerald-500">Get Funded.</span>
            </h1>

            {/* subheadline: Detailed description of the service */}
            <p className="text-xl md:text-2xl mb-14 max-w-2xl mx-auto text-emerald-900/60 leading-relaxed font-medium">
              The fastest way to manage your funding documents. Upload in seconds, track progress live, and get your file to underwriting in <span className="text-emerald-600 font-bold italic underline decoration-emerald-500/30 underline-offset-[12px]">24–48 hours.</span>
            </p>

            {/* cta-buttons: Primary and secondary call-to-action buttons */}
            <div className="flex flex-col sm:flex-row gap-5 justify-center items-center">
              <Button size="lg" className="text-xl px-12 py-9 h-auto bg-emerald-500 text-white hover:bg-emerald-400 font-bold transition-all hover:scale-105 shadow-2xl shadow-emerald-500/30 active:scale-95" asChild>
                <a href="creditbanc.io/apply-now" target="_blank" rel="noopener noreferrer">
                  Start Now
                  <ArrowRight className="ml-3 h-6 w-6" />
                </a>
              </Button>
              <Button size="lg" variant="ghost" className="text-xl px-10 py-9 h-auto text-emerald-950 hover:bg-white/50 transition-all font-bold" asChild>
                <Link href="#how-it-works">
                  See How It Works
                </Link>
              </Button>
            </div>

            {/* login-link: Link for existing users */}
            <div className="mt-12">
              <Link href="/auth/login" className="text-emerald-900/40 hover:text-emerald-600 transition-colors text-base font-bold border-b-2 border-transparent hover:border-emerald-500/20 pb-1">
                Already registered? <span className="text-emerald-600">Log in</span>
              </Link>
            </div>
          </div>
        </div>

        {/* subtle divider */}
        <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* pillars-section: Three key value propositions */}
      <section id="features" className="container mx-auto px-4 py-24 relative">
        <div className="grid md:grid-cols-3 gap-10">
          {pillars.map((p, i) => (
            <Card key={i} className="text-center border border-emerald-50 shadow-sm hover:shadow-2xl transition-all duration-500 group hover:-translate-y-2 bg-white rounded-[2rem] overflow-hidden">
              <CardHeader className="pt-12">
                {/* pillar-icon: Icon representing each value proposition */}
                <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-50 group-hover:bg-emerald-500 transition-all duration-500 shadow-inner group-hover:shadow-emerald-500/50">
                  <p.icon className="h-10 w-10 text-emerald-600 group-hover:text-white transition-colors duration-500" />
                </div>
                <CardTitle className="text-2xl font-black text-emerald-950 tracking-tight">{p.title}</CardTitle>
              </CardHeader>
              <CardContent className="pb-12 px-8">
                <CardDescription className="text-lg text-emerald-900/60 leading-relaxed font-bold">{p.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* how-it-works-section: Step-by-step process explanation */}
      <section id="how-it-works" className="bg-[#f8fdfb]/80 py-32 border-y border-emerald-100/30">
        <div className="container mx-auto px-4">
          {/* section-header: Title and subtitle for the steps section */}
          <div className="text-center mb-20">
            <h2 className="text-5xl md:text-6xl font-black text-emerald-950 mb-6 tracking-tighter">How It Works</h2>
            <div className="inline-block h-1.5 w-20 bg-emerald-500 rounded-full mb-6" />
            <p className="text-xl text-emerald-900/40 font-bold uppercase tracking-widest">Three steps. No surprises.</p>
          </div>

          {/* steps-grid: Interactive cards showing the process */}
          <div className="grid lg:grid-cols-3 gap-10">
            {steps.map((s, idx) => (
              <Card
                key={idx}
                className={`border-none shadow-xl transition-all duration-500 rounded-[2.5rem] p-4 ${activeStep === idx ? " ring-8 ring-emerald-500/5 bg-white scale-[1.05]" : "bg-white/60 opacity-80"}`}
                onMouseEnter={() => setActiveStep(idx)}
              >
                <CardHeader className="space-y-6 p-10 text-left">
                  {/* step-header: Icon and title for each step */}
                  <div className="flex items-center space-x-5">
                    <div className="rounded-2xl bg-emerald-500 p-4 shadow-lg shadow-emerald-500/20">
                      <s.icon className="h-7 w-7 text-white" />
                    </div>
                    <CardTitle className="text-3xl font-black text-emerald-950 tracking-tight">{s.title}</CardTitle>
                  </div>
                  <CardDescription className="text-xl text-emerald-900/60 leading-relaxed font-bold">{s.desc}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>

          {/* required-docs-callout: Highlighted information about required documents */}
          <div className="mt-24 max-w-5xl mx-auto rounded-[3rem] border border-emerald-100 p-12 md:p-16 bg-white shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-full -mr-32 -mt-32 transition-transform duration-700 group-hover:scale-110" />

            <div className="relative z-10">
              <div className="mb-12 text-center">
                <h3 className="text-3xl font-black text-emerald-950 mb-4 tracking-tight">Required Documents to Start</h3>
                <p className="text-xl text-emerald-700/60 font-bold">Everything you need to get moving today:</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                {[
                  "6 months of business bank statements",
                  "Driver’s License (front and back)",
                  "Voided business check",
                  "Debt schedule (if applicable)"
                ].map((item, i) => (
                  <div key={i} className="flex items-center space-x-5 text-emerald-950 text-xl group/item">
                    <div className="h-10 w-10 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0 group-hover/item:bg-emerald-500 transition-all duration-300">
                      <CheckCircle className="h-6 w-6 text-emerald-500 group-hover/item:text-white" />
                    </div>
                    <span className="font-black tracking-tight">{item}</span>
                  </div>
                ))}
              </div>
              <p className="text-emerald-900/40 text-lg text-center italic border-t border-emerald-50 pt-10 font-bold tracking-tight">
                The Vault tells you what’s needed, flags what’s missing, and skips everything that isn’t.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* affiliate-section: Public affiliate program signup */}
      <section id="affiliate" className="bg-emerald-950 py-32 relative overflow-hidden">
        {/* glow */}
        <div className="absolute top-0 right-0 w-[40%] h-[60%] bg-emerald-500/10 blur-[130px] rounded-full" />
        <div className="absolute bottom-0 left-0 w-[40%] h-[50%] bg-emerald-400/5 blur-[130px] rounded-full" />

        <div className="container relative z-10 mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-16 items-center max-w-6xl mx-auto">
            {/* pitch */}
            <div className="text-white">
              <div className="inline-flex items-center space-x-2 bg-white/5 border border-emerald-400/20 rounded-full px-4 py-2 mb-8">
                <Badge className="bg-emerald-500 text-white hover:bg-emerald-400 font-bold border-none">PARTNERS</Badge>
                <span className="text-sm text-emerald-300/60 font-bold uppercase tracking-[0.2em]">Affiliate Program</span>
              </div>
              <h2 className="text-4xl md:text-6xl font-black mb-8 tracking-tighter leading-tight">
                Refer. <span className="text-emerald-400">Get Paid.</span>
              </h2>
              <p className="text-xl text-emerald-100/60 mb-12 leading-relaxed font-bold max-w-lg">
                Share your link, send us business owners who need funding, and earn <span className="text-emerald-400">$500</span> for every referral that gets funded. It's that simple.
              </p>

              <div className="space-y-6">
                {[
                  { icon: Link2, title: "Get your link", desc: "Sign up and get a unique referral link instantly." },
                  { icon: Gift, title: "Refer anyone", desc: "Send business owners through our quick pre-qualification form." },
                  { icon: DollarSign, title: "Earn $500 per funded deal", desc: "Paid out via Giftronaut the moment your referral gets funded." },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-5">
                    <div className="h-12 w-12 rounded-2xl bg-emerald-500/15 border border-emerald-400/20 flex items-center justify-center shrink-0">
                      <item.icon className="h-6 w-6 text-emerald-400" />
                    </div>
                    <div>
                      <h4 className="text-lg font-black text-white tracking-tight">{item.title}</h4>
                      <p className="text-emerald-100/50 font-bold">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* signup CTA — dedicated page */}
            <div className="rounded-[3rem] bg-white/5 border border-emerald-400/20 p-12 text-center">
              <div className="mx-auto w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center mb-6 border border-emerald-400/30">
                <Gift className="h-8 w-8 text-emerald-400" />
              </div>
              <h3 className="text-3xl font-black text-white uppercase tracking-tighter mb-3">Become an Affiliate</h3>
              <p className="text-emerald-100/60 font-bold mb-8">
                Sign up free and start earning $500 for every funded referral.
              </p>
              <Button
                size="lg"
                className="text-lg px-10 py-8 h-auto bg-emerald-500 text-white hover:bg-emerald-400 font-black rounded-2xl shadow-2xl shadow-emerald-500/30 transition-all hover:scale-105 active:scale-95"
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
        <div className="max-w-5xl mx-auto bg-emerald-900 rounded-[4rem] p-16 md:p-24 shadow-2xl relative overflow-hidden">
          {/* visual punch */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/20 blur-[100px] rounded-full -mr-48 -mt-48 animate-pulse" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-500/10 blur-[100px] rounded-full -ml-48 -mb-48" />

          <h2 className="text-4xl md:text-7xl font-black text-white mb-8 tracking-tighter leading-tight">Ready to get <br />things moving?</h2>
          <p className="text-xl md:text-2xl text-emerald-100/60 mb-14 max-w-3xl mx-auto leading-relaxed font-bold">
            Schedule a call with our advisors to get your account created and start uploading documents to the <span className="text-emerald-400 font-extrabold uppercase tracking-widest">Credit Banc Vault</span>.
          </p>
          <Button size="lg" className="text-2xl px-14 py-10 h-auto bg-emerald-500 text-white hover:bg-emerald-400 font-black transition-all hover:scale-105 shadow-2xl shadow-emerald-500/40 active:scale-95" asChild>
            <a href="https://creditbanc.io/apply-now" target="_blank" rel="noopener noreferrer" className="flex items-center">
              Start Now
              <ArrowRight className="ml-4 h-8 w-8" />
            </a>
          </Button>

          <div className="mt-14">
            <Link href="/auth/login" className="text-emerald-300/60 hover:text-white transition-colors text-lg font-black tracking-tight border-b-2 border-emerald-300/10 hover:border-white/20 pb-1">
              Already registered? <span className="text-emerald-300 underline">Log in</span>
            </Link>
          </div>
        </div>
      </section>

      {/* footer: Strictly simplified footer per USER request */}
      <footer className="bg-emerald-950 text-white py-20 relative overflow-hidden">
        {/* color grading/shine from CTA */}
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/50 to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />

        <div className="container mx-auto px-4 relative z-10 flex flex-col items-center space-y-12">
          <Link href="/" className="transition-all hover:scale-110 active:scale-95 group">
            <Image
              src="/vaultlogo.svg"
              alt="Credit Banc Vault"
              width={180}
              height={80}
              priority
              className="h-14 w-auto brightness-0 invert opacity-90 group-hover:opacity-100 transition-opacity"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = '/vaultlogo.png';
              }}
            />
          </Link>

          <div className="flex flex-col items-center space-y-8">
            <a
              href="https://creditbanc.io"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center space-x-3 text-emerald-400 hover:text-white transition-all text-3xl font-black tracking-tighter"
            >
              <span>creditbanc.io</span>
              <ArrowRight className="h-7 w-7 transform group-hover:translate-x-2 transition-transform" />
            </a>

            <div className="h-px w-24 bg-emerald-800/50" />

            <p className="text-emerald-100/20 text-xs font-black uppercase tracking-[0.4em]">
              © {new Date().getFullYear()} Credit Banc. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}