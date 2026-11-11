"use client";

// The Vault's public landing page, written in creditbanc.io's own grammar and
// pitched as the fintech product it is.
//
// The brand is unchanged (docs/design-system-import.md): Manrope 800 at
// tracking-tighter for every headline against Inter body, cream rather than
// white, navy and mint, depth from mint glow instead of borders, one easing
// curve. What changed is what carries each section — every one now shows a
// piece of the product instead of a paragraph about it:
//
//   navy hero      the vault itself, as a live window  (marketing/vault-app-frame)
//   cream          the file's five stages               (marketing/file-pipeline)
//   white          four vault behaviours, as vault UI   (marketing/vault-feature-grid)
//   navy           how a checklist gets built           (marketing/checklist-diagram)
//   cream          the referral program
//   green          the close
//   navy           footer
//
// Motion: the hero plays once on load; one pulse loops on the pipeline and one
// on the checklist diagram. Everything rests under reduced motion.

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";
import { BrandFooter } from "@/components/marketing/brand-chrome";
import { VaultAppFrame } from "@/components/marketing/vault-app-frame";
import { FilePipeline } from "@/components/marketing/file-pipeline";
import { VaultFeatureGrid } from "@/components/marketing/vault-feature-grid";
import { ChecklistDiagram } from "@/components/marketing/checklist-diagram";
import { BAND_GRADIENT, EASE, GRID_OVERLAY } from "@/lib/motion";
import { FileStack, Gift, Lock, Menu, X } from "lucide-react";

const APPLY_URL = "https://creditbanc.io/apply-now";

// The page's one main action, worded the same in the nav, the hero and the close.
const APPLY_LABEL = "Apply for funding";
const LOGIN_LABEL = "Log in to your vault";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#documents", label: "What you need" },
  { href: "/support", label: "Support" },
];

// Restating the rule the "What you need" diagram draws. Deliberately not a
// document list — see marketing/checklist-diagram for why.
const CHECKLIST_POINTS = [
  {
    title: "Built from your file",
    body: "Your industry, your time in business and the product you want all change the ask.",
  },
  {
    title: "Only what yours needs",
    body: "If a document isn't on your checklist, we aren't asking for it.",
  },
  {
    title: "New asks come with a reason",
    body: "Anything underwriting adds later arrives with a note explaining why.",
  },
];

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cb-mint";
const BTN = `inline-flex h-14 items-center justify-center gap-2 rounded-lg px-8 font-bold transition-transform hover:scale-[1.03] active:scale-[0.98] ${FOCUS}`;
/** Mint fill takes navy text — white on mint is ~1.9:1. */
const BTN_MINT = `${BTN} bg-cb-mint text-cb-navy`;
const BTN_NAVY = `${BTN} bg-cb-navy text-primary-fixed`;
const BTN_GHOST_DARK = `inline-flex h-14 items-center justify-center rounded-lg border border-white/25 px-8 font-bold text-white transition-colors hover:bg-white/10 ${FOCUS}`;
const NAV_LINK = `font-label text-[11px] font-bold uppercase tracking-[0.18em] text-cb-navy/70 transition-colors hover:text-cb-navy ${FOCUS}`;
const H2 = "font-headline text-4xl font-extrabold leading-[1.02] tracking-tighter sm:text-5xl";

/** Section eyebrow — Inter, uppercase, wide tracking. */
function Eyebrow({ children, tone = "light" }: { children: React.ReactNode; tone?: "light" | "dark" }) {
  return (
    <p
      className={`font-label text-[11px] font-bold uppercase tracking-[0.22em] ${
        tone === "light" ? "text-cb-emerald700" : "text-cb-mint"
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
             links, a text log-in, and one mint button. ──────────────────── */}
      <header className="sticky top-0 z-50 w-full border-b border-black/5 bg-cb-cream/80 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 sm:px-8">
          <Link href="/" className={`group flex items-center ${FOCUS}`} aria-label="Credit Banc">
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
              <Link key={item.href} href={item.href} className={NAV_LINK}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-6 md:flex">
            <Link href="/auth/login" className={NAV_LINK}>
              Log in
            </Link>
            <a
              href={APPLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex h-11 items-center rounded-lg bg-cb-mint px-6 font-label text-[11px] font-bold uppercase tracking-[0.18em] text-cb-navy transition-transform hover:scale-[1.03] active:scale-[0.98] ${FOCUS}`}
            >
              {APPLY_LABEL}
            </a>
          </div>

          <button
            type="button"
            className={`flex h-11 w-11 items-center justify-center md:hidden ${FOCUS}`}
            onClick={() => set_menu_open((v) => !v)}
            aria-label={menu_open ? "Close menu" : "Open menu"}
            aria-expanded={menu_open}
          >
            {menu_open ? <X className="h-6 w-6 text-cb-navy" /> : <Menu className="h-6 w-6 text-cb-navy" />}
          </button>
        </div>

        {menu_open && (
          <div className="border-t border-black/5 px-6 py-6 md:hidden">
            <nav className="flex flex-col">
              {NAV_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => set_menu_open(false)}
                  className="flex h-11 items-center font-label text-xs font-bold uppercase tracking-[0.18em] text-cb-navy"
                >
                  {item.label}
                </Link>
              ))}
              <div className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-5">
                <Link
                  href="/auth/login"
                  onClick={() => set_menu_open(false)}
                  className="inline-flex h-12 items-center justify-center rounded-lg border border-cb-navy/20 font-label text-[11px] font-bold uppercase tracking-[0.18em] text-cb-navy"
                >
                  Log in
                </Link>
                <a
                  href={APPLY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center justify-center rounded-lg bg-cb-mint font-label text-[11px] font-bold uppercase tracking-[0.18em] text-cb-navy"
                >
                  {APPLY_LABEL}
                </a>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main>
        {/* ── Hero. Navy, with the product itself as the picture. ───────── */}
        <section className="relative overflow-hidden bg-cb-navy px-6 py-16 sm:px-8 sm:py-20 lg:flex lg:min-h-[calc(100dvh-5rem)] lg:items-center">
          <div aria-hidden className="absolute inset-0 opacity-[0.07]" style={GRID_OVERLAY} />
          <div
            aria-hidden
            className="absolute -right-40 -top-40 h-[38rem] w-[38rem] animate-aurora rounded-full bg-cb-mint/20 blur-[140px] motion-reduce:animate-none"
          />
          <div aria-hidden className="absolute -bottom-48 -left-40 h-[30rem] w-[30rem] rounded-full bg-cb-emerald700/30 blur-[130px]" />
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cb-mint/40 to-transparent" />

          <div className="relative mx-auto grid w-full max-w-7xl items-center gap-14 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
            <div className="min-w-0">
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: EASE }}
              >
                <h1 className="font-headline text-[clamp(2.6rem,5.6vw,4.75rem)] font-extrabold leading-[0.98] tracking-tighter text-white">
                  Your business funding file,
                  <span className="block text-cb-mint">in one vault.</span>
                </h1>
              </motion.div>

              <Reveal delay={0.15} distance={20}>
                <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/70">
                  Upload each document once, watch your checklist clear, and send a
                  complete file to underwriting in{" "}
                  <span className="font-bold text-white">24&ndash;48 hours</span>. No email threads.
                </p>

                <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
                  <a href={APPLY_URL} target="_blank" rel="noopener noreferrer" className={BTN_MINT}>
                    {APPLY_LABEL}
                  </a>
                  <Link href="/auth/login" className={BTN_GHOST_DARK}>
                    {LOGIN_LABEL}
                  </Link>
                </div>

                <ul className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 text-sm text-white/60 sm:flex-row sm:gap-8">
                  <li className="flex items-center gap-2.5">
                    <FileStack className="h-4 w-4 shrink-0 text-cb-mint" />
                    <span>
                      <span className="font-bold text-white tabular-nums">6&ndash;8 documents</span> in a typical file
                    </span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Lock className="h-4 w-4 shrink-0 text-cb-mint" />
                    Encrypted document storage
                  </li>
                </ul>
              </Reveal>
            </div>

            <Reveal delay={0.2} direction="left" distance={28} className="min-w-0">
              <VaultAppFrame />
            </Reveal>
          </div>
        </section>

        {/* ── How it works. The five stages a file moves through. ───────── */}
        <section id="how-it-works" className="scroll-mt-20 px-6 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-7xl">
            <Reveal>
              <Eyebrow>How it works</Eyebrow>
              <div className="mt-4 grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-end lg:gap-16">
                <h2 className={`${H2} text-cb-navy`}>
                  One file, from first upload{" "}
                  <span className="whitespace-nowrap text-cb-emerald700">to funded.</span>
                </h2>
                <p className="max-w-xl text-xl font-medium leading-relaxed text-cb-navy lg:pb-1.5">
                  You upload. The vault tracks every stage and shows what happens
                  next, so nobody has to call for an update.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.1} className="mt-16">
              <FilePipeline />
            </Reveal>
          </div>
        </section>

        {/* ── Features. White band so the cream cards read as surfaces. ─── */}
        <section id="features" className="scroll-mt-20 border-y border-black/5 bg-white px-6 py-20 sm:px-8 sm:py-28">
          <div className="mx-auto max-w-7xl">
            <Reveal>
              <Eyebrow>Inside the vault</Eyebrow>
              <h2 className={`mt-4 max-w-3xl ${H2} text-cb-navy`}>
                Every document tracked, from upload{" "}
                <span className="whitespace-nowrap text-cb-emerald700">to approval.</span>
              </h2>
            </Reveal>

            <Reveal delay={0.1} className="mt-12">
              <VaultFeatureGrid />
            </Reveal>
          </div>
        </section>

        {/* ── What you need. Navy band; the diagram carries it. ─────────── */}
        <section id="documents" className="relative scroll-mt-20 overflow-hidden bg-cb-navy px-6 py-20 sm:px-8 sm:py-28">
          <div aria-hidden className="absolute inset-0 opacity-[0.06]" style={GRID_OVERLAY} />
          <div aria-hidden className="absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-cb-mint/10 blur-[130px]" />
          <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cb-mint/30 to-transparent" />

          <div className="relative mx-auto max-w-7xl">
            <Reveal>
              <Eyebrow tone="dark">What you need</Eyebrow>
              <div className="mt-4 grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-end lg:gap-16">
                <h2 className={`${H2} text-white`}>
                  No standard list.
                  <br />
                  <span className="text-cb-mint">Just yours.</span>
                </h2>
                <p className="max-w-xl text-lg leading-relaxed text-white/70 lg:pb-1.5">
                  Two businesses asking for the same amount rarely need the same
                  paperwork. Your advisor requests only the documents your file
                  needs, and you upload each one once.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.1} className="mt-12">
              <ChecklistDiagram />
            </Reveal>

            <Reveal delay={0.15} className="mt-10">
              <dl className="grid gap-8 md:grid-cols-3">
                {CHECKLIST_POINTS.map((point) => (
                  <div key={point.title} className="border-t border-white/20 pt-5">
                    <dt className="font-headline text-lg font-extrabold tracking-tight text-white">{point.title}</dt>
                    <dd className="mt-2 text-[15px] leading-relaxed text-white/70">{point.body}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-10 flex items-center gap-3 text-sm text-white/70">
                <Lock className="h-4 w-4 shrink-0 text-cb-mint" />
                Encrypted storage, access you control, and nothing leaves your vault without your say-so.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── Referral program. A cream breather between the dark and green
               bands; the program has its own page, so this is an invitation. */}
        <section id="affiliate" className="scroll-mt-20 px-6 py-20 sm:px-8 sm:py-28">
          <Reveal className="mx-auto max-w-7xl">
            <div className="grid items-center gap-10 rounded-3xl border border-black/5 bg-white p-8 shadow-[0_32px_70px_-50px_rgba(0,3,33,0.45)] sm:p-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
              <div>
                <p className="flex items-center gap-2 font-label text-[11px] font-bold uppercase tracking-[0.22em] text-cb-emerald700">
                  <Gift className="h-4 w-4" />
                  I Know Someone Club
                </p>
                <h2 className="mt-4 font-headline text-3xl font-extrabold leading-[1.05] tracking-tighter text-cb-navy sm:text-4xl">
                  A $500 gift card for every{" "}
                  <span className="whitespace-nowrap text-cb-emerald700">funded referral.</span>
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-relaxed text-on-surface-variant">
                  Share your referral link. When a business owner you send us gets
                  funded, you pick a $500 gift card. Free to join, no limit on
                  referrals.
                </p>
                <Link href="/affiliate" className={`mt-8 ${BTN_NAVY}`}>
                  Join the program
                </Link>
              </div>

              {/* The reward, drawn as the card it is. */}
              <div
                aria-hidden
                className="relative mx-auto flex aspect-[1.586] w-full max-w-sm flex-col justify-between overflow-hidden rounded-2xl p-6 text-white shadow-[0_40px_70px_-35px_rgba(13,59,42,0.75)]"
                style={{ background: BAND_GRADIENT.deepest }}
              >
                <div className="absolute inset-0 opacity-[0.1]" style={GRID_OVERLAY} />
                <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cb-mint/30 blur-3xl" />
                <div className="relative flex items-center justify-between">
                  <span className="font-label text-[10px] font-bold uppercase tracking-[0.22em] text-white/80">Gift card</span>
                  <Gift className="h-5 w-5 text-cb-mint" />
                </div>
                <div className="relative">
                  <p className="font-headline text-6xl font-extrabold leading-none tracking-tighter tabular-nums">$500</p>
                  <p className="mt-2 text-sm text-white/75">Your choice of card</p>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── Close. Green band, matching the site's final call. ────────── */}
        <section className="relative overflow-hidden px-6 py-20 text-center sm:px-8 sm:py-28" style={{ background: BAND_GRADIENT.deep }}>
          <div aria-hidden className="absolute inset-0 opacity-[0.07]" style={GRID_OVERLAY} />
          <Reveal className="relative mx-auto max-w-3xl">
            <h2 className={`${H2} text-white md:text-6xl`}>Your vault is set up the day you apply.</h2>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/80">
              Already have one? Log in and pick up exactly where your checklist left off.
            </p>

            <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
              <a href={APPLY_URL} target="_blank" rel="noopener noreferrer" className={BTN_MINT}>
                {APPLY_LABEL}
              </a>
              <Link href="/auth/login" className={BTN_GHOST_DARK}>
                {LOGIN_LABEL}
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <BrandFooter />
    </div>
  );
}
