"use client";

// The Vault's public landing page, written in creditbanc.io's own grammar.
//
// The marketing site's look is five things (docs/design-system-import.md, and
// verified against the live site): Manrope 800 at tracking-tighter for every
// headline against Inter body; cream #faf9f6 rather than white; a section
// rhythm that alternates cream → green → cream → navy and never repeats twice
// running; depth from mint glow instead of borders; and one easing curve.
//
// Section order and colour here: cream hero → green stats → cream steps → navy
// documents → cream affiliate → green close → navy footer.
//
// The page's one animated flourish is the hero panel — see
// components/marketing/vault-file-preview.tsx.

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";
import { BrandFooter } from "@/components/marketing/brand-chrome";
import { VaultFilePreview } from "@/components/marketing/vault-file-preview";
import { ProgramDocuments } from "@/components/marketing/program-documents";
import { EASE } from "@/lib/motion";
import {
  ArrowRight,
  Gift,
  Lock,
  Menu,
  X,
} from "lucide-react";

const APPLY_URL = "https://creditbanc.io/apply-now";

/** The deep-emerald band. One of the four sanctioned stops — do not invent greens. */
const GREEN_BAND = "linear-gradient(135deg, #1f6b4e 0%, #2ea878 50%, #34b07d 100%)";

// Numbers the product can actually stand behind: what the file needs and how
// long it takes. No invented volume metrics.
const FACTS = [
  { value: "24–48h", label: ["From complete file", "to underwriting"] },
  { value: "6–8", label: ["Documents in", "a typical file"] },
  { value: "1", label: ["Place everything", "lives"] },
  { value: "0", label: ["Files lost in", "email threads"] },
];

const STEPS = [
  {
    title: "Upload",
    body: "Drag files in or upload by category. The Vault sorts them where they belong, so nothing gets renamed, re-sent, or lost.",
  },
  {
    title: "Track",
    body: "A live checklist shows what's in, what's missing, and what's been approved. No calls to ask where things stand.",
  },
  {
    title: "Submit",
    body: "When the file is complete, submit once. It goes straight to underwriting with everything attached.",
  },
];

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#documents", label: "What you need" },
  { href: "/support", label: "Support" },
];

/** Section eyebrow — Inter, uppercase, wide tracking, mint. */
function Eyebrow({ children, tone = "mint" }: { children: React.ReactNode; tone?: "mint" | "light" }) {
  return (
    <p
      className={`font-label text-[11px] font-bold uppercase tracking-[0.22em] ${
        tone === "mint" ? "text-cb-mint" : "text-white/60"
      }`}
    >
      {children}
    </p>
  );
}

export function LandingPage() {
  const [menu_open, set_menu_open] = useState(false);

  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink selection:bg-cb-mint/20">
      {/* ── Header. Same shape as the marketing site: wordmark, uppercase
             links, a text log-in, and one mint Apply button. ────────────── */}
      <header className="sticky top-0 z-50 w-full border-b border-black/5 bg-cb-cream/80 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 sm:px-8">
          <Link href="/" className="group flex items-center" aria-label="Credit Banc">
            <Image
              src="/powered-by-shield.png"
              alt="Credit Banc — Powered by Shield Advisory Group"
              width={1128}
              height={191}
              priority
              className="h-10 w-auto transition-transform group-hover:scale-105"
            />
          </Link>

          <nav className="hidden items-center gap-9 lg:flex">
            {NAV_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="font-label text-[11px] font-bold uppercase tracking-[0.18em] text-cb-navy/70 transition-colors hover:text-cb-navy"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-6 md:flex">
            <Link
              href="/auth/login"
              className="font-label text-[11px] font-bold uppercase tracking-[0.18em] text-cb-navy/70 transition-colors hover:text-cb-navy"
            >
              Log in
            </Link>
            <a
              href={APPLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center rounded-lg bg-cb-mint px-6 font-label text-[11px] font-bold uppercase tracking-[0.18em] text-cb-navy transition-transform hover:scale-[1.03] active:scale-[0.98]"
            >
              Apply now
            </a>
          </div>

          <button
            type="button"
            className="md:hidden"
            onClick={() => set_menu_open((v) => !v)}
            aria-label={menu_open ? "Close menu" : "Open menu"}
            aria-expanded={menu_open}
          >
            {menu_open ? <X className="h-6 w-6 text-cb-navy" /> : <Menu className="h-6 w-6 text-cb-navy" />}
          </button>
        </div>

        {menu_open && (
          <div className="border-t border-black/5 px-6 py-6 md:hidden">
            <nav className="flex flex-col gap-4">
              {NAV_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => set_menu_open(false)}
                  className="font-label text-xs font-bold uppercase tracking-[0.18em] text-cb-navy"
                >
                  {item.label}
                </Link>
              ))}
              <div className="mt-2 flex flex-col gap-3 border-t border-black/5 pt-5">
                <Link
                  href="/auth/login"
                  onClick={() => set_menu_open(false)}
                  className="inline-flex h-12 items-center justify-center rounded-lg border border-cb-navy/15 font-label text-[11px] font-bold uppercase tracking-[0.18em] text-cb-navy"
                >
                  Log in
                </Link>
                <a
                  href={APPLY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center rounded-lg bg-cb-mint font-label text-[11px] font-bold uppercase tracking-[0.18em] text-cb-navy"
                >
                  Apply now
                </a>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* ── Hero. Left-aligned copy against the file panel, the way the
             marketing site sets copy against its circular photograph. ───── */}
      <section className="relative overflow-hidden px-6 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-cb-mint/15 via-cb-cream to-white" />
        <div
          aria-hidden
          className="absolute -left-32 top-0 h-[34rem] w-[34rem] animate-aurora rounded-full bg-cb-mint/10 blur-[130px]"
        />

        <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
          <div className="min-w-0">
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE }}
              className="font-headline text-[clamp(2.75rem,7vw,5.5rem)] font-extrabold leading-[0.95] tracking-tighter text-cb-navy"
            >
              Upload. Track.
              <br />
              {/* The site's signature device: white type on a mint block that
                  wipes in from the left. */}
              <span className="relative isolate mt-2 inline-block px-3 text-white">
                <motion.span
                  aria-hidden
                  className="absolute inset-y-1 left-0 right-0 -z-10 rounded-sm bg-cb-mint"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.7, delay: 0.5, ease: EASE }}
                  style={{ originX: 0 }}
                />
                Get funded.
              </span>
            </motion.h1>

            <Reveal delay={0.15} distance={20}>
              <p className="mt-8 font-headline text-xl font-extrabold tracking-tight text-cb-navy sm:text-2xl">
                Paperwork is the slow part. It doesn&rsquo;t have to be.
              </p>
              <p className="mt-4 max-w-xl text-lg leading-relaxed text-on-surface-variant">
                The Vault is where your funding file lives. Upload documents once,
                watch the checklist close itself out, and send a complete file to
                underwriting in <span className="font-bold text-cb-navy">24&ndash;48 hours</span> &mdash;
                without a single &ldquo;did you get my email?&rdquo;
              </p>

              <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
                <a
                  href={APPLY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-lg bg-cb-navy px-8 font-bold text-primary-fixed transition-transform hover:scale-[1.03] active:scale-[0.98]"
                >
                  Start your file
                  <ArrowRight className="h-4 w-4" />
                </a>
                <Link
                  href="/auth/login"
                  className="inline-flex h-14 items-center justify-center rounded-lg border border-cb-navy/15 px-8 font-bold text-cb-navy transition-colors hover:bg-white"
                >
                  Log in to your vault
                </Link>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.2} direction="left" distance={28} className="min-w-0">
            <VaultFilePreview />
          </Reveal>
        </div>
      </section>

      {/* ── Facts band. The marketing site's stat strip, with what this
             product can actually claim. ─────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 py-14 sm:px-8 sm:py-16" style={{ background: GREEN_BAND }}>
        <div className="relative mx-auto grid max-w-7xl grid-cols-2 gap-10 text-center lg:grid-cols-4">
          {FACTS.map((fact, i) => (
            <Reveal key={fact.value + i} delay={i * 0.1} distance={20}>
              <p className="font-headline text-4xl font-extrabold tracking-tighter text-white sm:text-5xl">
                {fact.value}
              </p>
              <p className="mt-3 font-label text-[10px] font-bold uppercase leading-relaxed tracking-[0.18em] text-white/70">
                {fact.label[0]}
                <br />
                {fact.label[1]}
              </p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Three steps. Numbered because it genuinely is a sequence. ───── */}
      <section id="how-it-works" className="px-6 py-20 sm:px-8 sm:py-28 md:py-32">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-4 max-w-3xl font-headline text-4xl font-extrabold leading-[1.02] tracking-tighter text-cb-navy sm:text-5xl md:text-6xl">
              Three steps.
              <br />
              <span className="text-cb-mint">Then it runs itself.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-on-surface-variant">
              You do the uploading. The Vault does the chasing, sorting and
              status updates your advisor would otherwise call you about.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 0.12}>
                <div className="group h-full rounded-2xl border border-black/5 bg-white p-8 shadow-[0_24px_60px_-40px_rgba(0,3,33,0.4)] transition-transform duration-500 hover:-translate-y-1">
                  <div className="flex items-baseline gap-4">
                    <span className="font-headline text-5xl font-extrabold leading-none tracking-tighter text-cb-mint">
                      {i + 1}
                    </span>
                    <h3 className="font-headline text-2xl font-extrabold tracking-tight text-cb-navy">
                      {step.title}
                    </h3>
                  </div>
                  <p className="mt-5 leading-relaxed text-on-surface-variant">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── What you need. Navy band — mint on dark carries the three cards,
             and it breaks the cream before the affiliate block. ────────── */}
      <section id="documents" className="relative overflow-hidden bg-cb-navy px-6 py-20 sm:px-8 sm:py-28 md:py-32">
        <div aria-hidden className="absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-cb-mint/10 blur-[130px]" />
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cb-mint/30 to-transparent" />

        <div className="relative mx-auto max-w-7xl">
          <Reveal>
            <Eyebrow tone="light">What you need</Eyebrow>
            {/* Headline and body sit side by side and share a baseline: the
                section runs full width for the card row below, and a lone
                max-w-3xl heading would leave half the band empty. */}
            <div className="mt-4 grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-end lg:gap-16">
              <h2 className="font-headline text-4xl font-extrabold leading-[1.02] tracking-tighter text-white sm:text-5xl md:text-6xl">
                No standard list.
                <br />
                <span className="text-cb-mint">Just yours.</span>
              </h2>
              <p className="max-w-xl text-lg leading-relaxed text-white/60 lg:pb-2">
                Every file is different. Two businesses asking for the same amount
                rarely need the same paperwork, so there is no packet to download
                and nothing to guess at. Your advisor requests exactly the
                documents your file needs, they land in your checklist as they
                come up, and you upload them once.
              </p>
            </div>
          </Reveal>

          {/* Three beats restating the rule the prose just gave. Deliberately
              not a document list — see marketing/program-documents for why the
              per-product checklist was pulled. */}
          <Reveal delay={0.12} className="mt-12">
            <ProgramDocuments />
          </Reveal>
        </div>

        <Reveal delay={0.2} className="relative mx-auto mt-12 max-w-7xl">
          <p className="flex items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-center text-sm text-white/60">
            <Lock className="h-4 w-4 shrink-0 text-cb-mint" />
            Encrypted storage, access you control, and nothing leaves your vault
            without your say-so.
          </p>
        </Reveal>
      </section>

      {/* ── Affiliate. A cream breather between the two dark/green bands;
             the program has its own page, so this is an invitation. ─────── */}
      <section id="affiliate" className="px-6 py-20 sm:px-8 sm:py-28">
        <Reveal className="mx-auto max-w-7xl">
          <div className="grid items-center gap-10 rounded-3xl border border-black/5 bg-white p-8 shadow-[0_32px_70px_-50px_rgba(0,3,33,0.45)] sm:p-12 lg:grid-cols-[1.1fr_auto] lg:gap-16">
            <div>
              <p className="flex items-center gap-2 font-label text-[11px] font-bold uppercase tracking-[0.22em] text-cb-mint">
                <Gift className="h-4 w-4" />
                I Know Someone Club
              </p>
              <h2 className="mt-4 font-headline text-3xl font-extrabold leading-[1.05] tracking-tighter text-cb-navy sm:text-4xl">
                Know a business owner who needs funding?
                <br />
                <span className="text-cb-mint">That&rsquo;s $500 to you.</span>
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-on-surface-variant">
                Share your referral link. When someone you send us gets funded, you
                pick a $500 gift card. Free to join, no limit on referrals.
              </p>
            </div>

            <div className="flex flex-col items-start lg:items-end">
              <Link
                href="/affiliate"
                className="inline-flex h-14 items-center justify-center gap-2 rounded-lg bg-cb-navy px-8 font-bold text-primary-fixed transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                Join the program
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Close. Green band, matching the site's final call. ──────────── */}
      <section className="relative overflow-hidden px-6 py-20 text-center sm:px-8 sm:py-28" style={{ background: GREEN_BAND }}>
        <Reveal className="relative mx-auto max-w-3xl">
          <h2 className="font-headline text-4xl font-extrabold leading-[1.02] tracking-tighter text-white sm:text-5xl md:text-6xl">
            Ready to get things moving?
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/75">
            Apply and an advisor sets up your vault the same day. Already have
            one? Pick up exactly where your checklist left off.
          </p>

          <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
            <a
              href={APPLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-14 items-center justify-center gap-2 rounded-lg bg-cb-navy px-8 font-bold text-primary-fixed transition-transform hover:scale-[1.03] active:scale-[0.98]"
            >
              Apply now
              <ArrowRight className="h-4 w-4" />
            </a>
            <Link
              href="/auth/login"
              className="inline-flex h-14 items-center justify-center rounded-lg border border-white/40 px-8 font-bold text-white transition-colors hover:bg-white/10"
            >
              Log in to your vault
            </Link>
          </div>
        </Reveal>
      </section>

      <BrandFooter />
    </div>
  );
}
