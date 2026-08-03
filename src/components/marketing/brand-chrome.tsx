// src/components/marketing/brand-chrome.tsx
//
// The shared creditbanc.io section grammar: sticky cream header, navy footer,
// and the cream + aurora page shell. /affiliate and /terms had hand-rolled
// copies of all three; every public surface now imports these instead so the
// grammar only has to be corrected in one place.
//
// See docs/design-system-import.md, [[brand_design_system]].

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
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

/** Navy footer with the mint hairline glow. Navy is reserved for this. */
export function BrandFooter() {
  return (
    <footer className="bg-cb-navy text-white py-16 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cb-mint/30 to-transparent"
      />

      <div className="max-w-6xl mx-auto px-4 relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
          <p className="text-white/30 text-xs font-bold uppercase tracking-[0.3em] text-center sm:text-left">
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
          <Image src="/CBLOGOWHITE.png" alt="Credit Banc" width={1000} height={200} className="h-8 w-auto" />
        </a>
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
