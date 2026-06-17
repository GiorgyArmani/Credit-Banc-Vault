"use client";

// src/app/error.tsx
//
// Route-segment error boundary. Catches render/runtime crashes that unmount the
// React tree (so the in-app modal can't show) and renders a clear, copyable
// failure screen instead of a blank page — making bugs easy to report/debug.

import { useEffect, useState } from "react";
import { AlertCircle, Copy, CheckCircle2, Mail, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

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
    <div className="min-h-screen bg-red-950/5 flex items-center justify-center p-4">
      <div className="bg-white rounded-[3rem] shadow-2xl max-w-lg w-full p-10 md:p-12 relative overflow-hidden border border-red-50">
        <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-full blur-3xl -mr-10 -mt-10" />

        <div className="text-center mb-8 relative z-10">
          <div className="mx-auto w-20 h-20 bg-red-50 rounded-[2rem] flex items-center justify-center mb-6 border border-red-100 shadow-inner">
            <AlertCircle className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-3xl font-black text-red-950 uppercase tracking-tighter mb-2">
            Something broke on this page
          </h2>
          <p className="text-red-950/40 font-bold">
            Try again, or copy the details below and send them to support.
          </p>
        </div>

        <div className="bg-red-50/60 rounded-[2rem] p-6 mb-6 border border-red-100 relative z-10">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-900/40 mb-3">
            What happened
          </p>
          <p className="text-sm font-bold text-red-950 break-words select-all whitespace-pre-wrap mb-4">
            {error.message || "Unknown error"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] font-bold text-red-900/50 select-all border-t border-red-100 pt-3">
            <span className="truncate">Page: {where || "—"}</span>
            {error.digest && (
              <span className="sm:text-right truncate">Ref: {error.digest}</span>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 relative z-10">
          <Button
            type="button"
            variant="outline"
            onClick={copy}
            className="flex-1 h-14 border-2 border-red-100 text-red-950 font-black rounded-2xl hover:bg-red-50 transition-all active:scale-95"
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-5 h-5 mr-2" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-5 h-5 mr-2" /> Copy details
              </>
            )}
          </Button>
          <a
            href={mailto}
            className="flex-1 h-14 inline-flex items-center justify-center gap-2 border-2 border-red-100 text-red-950 font-black rounded-2xl hover:bg-red-50 transition-all active:scale-95"
          >
            <Mail className="w-5 h-5" /> Email support
          </a>
          <Button
            type="button"
            onClick={() => reset()}
            className="flex-1 h-14 bg-red-500 hover:bg-red-600 text-white font-black rounded-2xl shadow-xl shadow-red-500/20 transition-all active:scale-95"
          >
            <RotateCcw className="w-5 h-5 mr-2" /> Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
