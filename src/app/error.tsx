"use client";

// src/app/error.tsx
//
// Route-segment error boundary. Catches render/runtime crashes that unmount the
// React tree (so the in-app modal can't show) and renders a clear, copyable
// failure screen instead of a blank page — making bugs easy to report/debug.

import { useEffect, useState } from "react";
import { AlertCircle, Copy, CheckCircle2, Mail, RotateCcw } from "lucide-react";

const SUPPORT_EMAIL = "support@creditbanc.io";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Mirror to the console so it lands in any captured logs too.
    console.error("[RouteError]", error);
  }, [error]);

  const where = typeof window !== "undefined" ? window.location.pathname : "";
  const report = [
    "[Credit Banc Vault crash report]",
    error.digest ? `Digest: ${error.digest}` : null,
    `Page: ${where || "—"}`,
    `Message: ${error.message || "Unknown error"}`,
    error.stack ? `\nStack:\n${error.stack}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the block below is select-all as a fallback.
    }
  };

  const mailto =
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(`Vault crash ${error.digest || ""}`.trim())}` +
    `&body=${encodeURIComponent(report)}`;

  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-black/5 bg-white p-8 shadow-xl md:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-error-container blur-3xl"
        />

        <div className="relative z-10 mb-8 text-center">
          <span className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-error-container text-error">
            <AlertCircle className="h-8 w-8" />
          </span>
          <h2 className="font-headline text-3xl font-extrabold tracking-tight text-cb-ink">
            Something broke on this page
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-cb-ink/60">
            Try again, or copy the details below and send them to support.
          </p>
        </div>

        <div className="relative z-10 mb-6 rounded-2xl border border-error-container bg-error-container/30 p-6">
          <p className="mb-3 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-on-error-container/60">
            What happened
          </p>
          <p className="mb-4 select-all whitespace-pre-wrap break-words text-sm font-semibold text-on-error-container">
            {error.message || "Unknown error"}
          </p>
          <div className="grid select-all grid-cols-1 gap-1 border-t border-error-container pt-3 text-[11px] font-semibold text-on-error-container/60 sm:grid-cols-2">
            <span className="truncate">Page: {where || "—"}</span>
            {error.digest && (
              <span className="truncate sm:text-right">Ref: {error.digest}</span>
            )}
          </div>
        </div>

        <div className="relative z-10 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={copy}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-black/10 px-5 py-3.5 text-sm font-bold text-cb-ink transition-colors hover:bg-black/[0.03]"
          >
            {copied ? (
              <>
                <CheckCircle2 className="h-4 w-4" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copy details
              </>
            )}
          </button>
          <a
            href={mailto}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-black/10 px-5 py-3.5 text-sm font-bold text-cb-ink transition-colors hover:bg-black/[0.03]"
          >
            <Mail className="h-4 w-4" /> Email support
          </a>
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-cb-navy px-5 py-3.5 text-sm font-bold text-primary-fixed transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      </div>
    </div>
  );
}
