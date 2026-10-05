// src/components/marketing/brand-chrome.tsx
//
// The shared creditbanc.io section grammar: sticky cream header, navy footer
// (mirrors the live creditbanc.io footer),
// and the cream + aurora page shell. /affiliate and /terms had hand-rolled
// copies of all three; every public surface now imports these instead so the
// grammar only has to be corrected in one place.
//
// See docs/design-system-import.md, [[brand_design_system]].

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { Facebook, Instagram, Linkedin, Mail, Star, Youtube, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cream page background with the mint gradient wash and two aurora glows.
 * Wrap the whole page in it — sections render inside `relative z-10`.
 */
export function BrandBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("absolute inset-0 pointer-events-none overflow-hidden", className)}>
      <div className="absolute inset-0 bg-gradient-to-br from-cb-mint/15 via-cb-cream to-white" />
      <div className="absolute top-0 left-1/4 w-[55%] h-[55%] bg-cb-mint/10 blur-[130px] rounded-full animate-aurora" />
      <div
        className="absolute bottom-0 right-1/4 w-[45%] h-[45%] bg-cb-mint/5 blur-[130px] rounded-full animate-aurora"
        style={{ animationDelay: "-4s" }}
      />
    </div>
  );
}

/**
 * Sticky brand header. `action` is the right-hand slot (a login link, a CTA, or
 * nothing at all on surfaces handed to outsiders).
 */
export function BrandHeader({
  action,
  href = "/",
  compact = false,
}: {
  action?: ReactNode;
  /** Where the logo links. Pass `null`-ish routes nowhere by using "/" default. */
  href?: string;
  /** Shorter bar for auth/utility pages. */
  compact?: boolean;
}) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-black/5 bg-cb-cream/80 backdrop-blur-md">
      <div
        className={cn(
          "max-w-6xl mx-auto px-4 flex items-center justify-between",
          compact ? "h-16" : "h-20"
        )}
      >
        <Link href={href} className="flex items-center group">
          <Image
            src="/powered-by-shield.png"
            alt="Credit Banc — Powered by Shield Advisory Group"
            width={1128}
            height={191}
            priority
            className={cn(
              "w-auto transition-transform group-hover:scale-105",
              compact ? "h-9" : "h-12"
            )}
          />
        </Link>
        {action}
      </div>
    </header>
  );
}

/**
 * The creditbanc.io footer, mirrored from the live site (Oct 2026): brand
 * column (logo, blurb, socials) + Programs / Company / Resources link columns,
 * then a hairline and a bottom bar. Links point at creditbanc.io — this app has
 * no pages of its own for them — except Terms, which is ours (/terms).
 * Navy is reserved for this.
 */
const FOOTER_SITE = "https://www.creditbanc.io";

const FOOTER_COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Programs",
    links: [
      { label: "SBA Loans", href: `${FOOTER_SITE}/sba-loans` },
      { label: "Real Estate Loans", href: `${FOOTER_SITE}/real-estate-financing` },
      { label: "Small Business Funding", href: `${FOOTER_SITE}/small-business-funding` },
      { label: "Our Process", href: `${FOOTER_SITE}/about#process` },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Us", href: `${FOOTER_SITE}/about` },
      { label: "In the Spotlight", href: `${FOOTER_SITE}/about#spotlight` },
      { label: "Call Us — 321-334-5099", href: "tel:+13213345099" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: `${FOOTER_SITE}/blog` },
      { label: "Apply for Funding", href: `${FOOTER_SITE}/apply-now` },
      { label: "Privacy Policy", href: `${FOOTER_SITE}/privacypolicy` },
    ],
  },
];

const FOOTER_SOCIALS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Facebook", href: "https://www.facebook.com/creditbanc", icon: Facebook },
  { label: "Instagram", href: "https://www.instagram.com/credit_banc/", icon: Instagram },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/credit-banc", icon: Linkedin },
  { label: "YouTube", href: "https://www.youtube.com/@Credit_Banc", icon: Youtube },
  { label: "Trustpilot", href: "https://www.trustpilot.com/review/creditbanc.io", icon: Star },
];

/** External links open in a new tab; tel:/mailto: and in-app paths don't. */
function FooterLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      className={className}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

export function BrandFooter() {
  const link = "text-sm text-slate-400 transition-colors hover:text-white";
  const fine = "text-[13px] text-slate-400 transition-colors hover:text-white";

  return (
    <footer className="relative overflow-hidden bg-cb-navy text-white">
      <div className="relative z-10 mx-auto max-w-6xl px-4 pt-16 sm:pt-20">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <div>
            <a
              href={FOOTER_SITE}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="creditbanc.io"
              className="inline-flex transition-opacity hover:opacity-80"
            >
              <Image src="/CBLOGOWHITE.png" alt="Credit Banc" width={1000} height={200} className="h-8 w-auto" />
            </a>
            <p className="mt-6 max-w-xs text-sm leading-relaxed text-slate-400">
              Credit Banc helps business owners compare financing options across working capital, SBA, and real
              estate, with Advisors who guide the process from start to finish.
            </p>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.1em] text-white">Follow us</p>
            <div className="mt-4 flex gap-3">
              {FOOTER_SOCIALS.map(({ label, href, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-slate-300 transition-colors hover:bg-cb-mint hover:text-cb-navy"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-bold uppercase tracking-[0.1em] text-white">{col.title}</p>
              <ul className="mt-6 space-y-4">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <FooterLink href={l.href} className={link}>
                      {l.label}
                    </FooterLink>
                  </li>
                ))}
                {col.title === "Resources" && (
                  <li>
                    <a
                      href="mailto:support@creditbanc.io"
                      className={`${link} inline-flex items-center gap-2.5`}
                    >
                      <Mail className="h-4 w-4 text-cb-mint" />
                      support@creditbanc.io
                    </a>
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-white/10 py-8 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-[13px] text-slate-400">
            Need to contact us? Please email the team at{" "}
            <a href="mailto:support@creditbanc.io" className="font-semibold text-white hover:text-cb-mint">
              support@creditbanc.io
            </a>
            .
          </p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <FooterLink href="/terms" className={fine}>
              Terms
            </FooterLink>
            <FooterLink href={`${FOOTER_SITE}/privacypolicy`} className={fine}>
              Privacy Policy
            </FooterLink>
            <FooterLink href={`${FOOTER_SITE}/apply-now`} className={fine}>
              Apply for Funding
            </FooterLink>
            <p className="text-[13px] text-slate-400">
              Copyright {new Date().getFullYear()}. Credit Banc. All Rights Reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Centered shell for auth and other single-card utility pages: cream backdrop,
 * aurora glows, compact header, navy footer. `width` sizes the card column.
 */
export function BrandAuthShell({
  children,
  width = "sm",
  headerAction,
  showFooter = true,
}: {
  children: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  headerAction?: ReactNode;
  showFooter?: boolean;
}) {
  const widths = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  } as const;

  return (
    <div className="min-h-screen flex flex-col bg-cb-cream font-body text-cb-ink">
      <BrandHeader compact action={headerAction} />
      <main className="relative flex-1 flex items-center justify-center px-4 py-16 md:py-20">
        <BrandBackdrop />
        <div className={cn("relative z-10 w-full", widths[width])}>{children}</div>
      </main>
      {showFooter && <BrandFooter />}
    </div>
  );
}

/**
 * CTA class recipes. These are the marketing site's three button treatments —
 * use them for public-surface calls to action instead of restyling shadcn
 * `Button` inline (Radix behavior stays intact; only the skin changes).
 */
export const CTA = {
  /** On light: navy fill, pale-mint text. The primary action. */
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-cb-navy px-8 py-4 font-bold text-primary-fixed transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  /** Compact/nav: gradient fill, uppercase. */
  gradient:
    "signature-gradient inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-bold uppercase tracking-widest text-white shadow-lg transition-transform hover:scale-[1.03] active:scale-[0.98]",
  /** On dark or green bands: mint fill, navy text. */
  onDark:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-cb-mint px-7 py-3.5 text-sm font-bold uppercase tracking-widest text-cb-navy transition-transform hover:scale-[1.03] active:scale-[0.98]",
  /** Secondary on dark. */
  ghostOnDark:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-white/25 px-7 py-3.5 text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-white/10",
  /** Secondary on light. */
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-black/10 px-7 py-3.5 text-sm font-bold uppercase tracking-widest text-cb-ink transition-colors hover:bg-black/[0.03]",
} as const;

/**
 * Form field skins. Applied via `className` on the shadcn primitives so Radix
 * behavior and a11y stay intact — see docs/design-system-import.md §7.
 */
export const FIELD = {
  label: "font-label text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray",
  input: "h-12 rounded-xl border-black/10 bg-white px-4 font-medium placeholder:text-cb-gray/60 focus-visible:ring-cb-mint/40",
  /** Same, with room for a leading icon at `left-4`. */
  inputWithIcon:
    "h-12 rounded-xl border-black/10 bg-white pl-11 pr-4 font-medium placeholder:text-cb-gray/60 focus-visible:ring-cb-mint/40",
  icon: "pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-cb-gray",
  error:
    "rounded-xl border border-error-container bg-error-container/40 p-4 text-sm font-semibold text-on-error-container",
} as const;

/** The standard white-on-cream card. Hairline, not a heavy border. */
export function BrandCard({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-black/5 bg-white shadow-xl",
        padded && "p-8 md:p-10",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Mint icon tile, the standard pairing for a heading or a status message. */
export function BrandIconTile({
  children,
  className,
  size = "md",
}: {
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-8 w-8 rounded-lg",
    md: "h-12 w-12 rounded-xl",
    lg: "h-16 w-16 rounded-2xl",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-cb-mint/10 text-cb-mint",
        sizes[size],
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * Centered status/notice page body: icon tile, headline, supporting copy, and
 * whatever actions the caller passes. Used by the auth success/error screens so
 * they stop drifting apart from one another.
 */
export function BrandNotice({
  icon,
  eyebrow,
  title,
  children,
  actions,
  tone = "brand",
}: {
  icon?: ReactNode;
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  tone?: "brand" | "error";
}) {
  return (
    <BrandCard className="text-center">
      {icon && (
        <BrandIconTile
          size="lg"
          className={cn("mb-7", tone === "error" && "bg-error-container text-error")}
        >
          {icon}
        </BrandIconTile>
      )}
      {eyebrow && <Eyebrow className={cn("mb-3", tone === "error" && "text-error")}>{eyebrow}</Eyebrow>}
      <h1 className="font-headline text-3xl md:text-4xl font-extrabold tracking-tight leading-tight text-cb-ink">
        {title}
      </h1>
      {children && <div className="mt-4 text-[15px] leading-relaxed text-cb-ink/70">{children}</div>}
      {actions && <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">{actions}</div>}
    </BrandCard>
  );
}

/** Eyebrow label. `font-label text-xs font-bold uppercase tracking-[0.3em]`. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("font-label text-xs font-bold uppercase tracking-[0.3em] text-cb-mint", className)}>
      {children}
    </p>
  );
}
