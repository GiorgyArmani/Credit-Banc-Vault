"use client";

import { useEffect, useRef } from "react";
import { FileSignature, X, ExternalLink } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { PendingContract } from "./use-pending-contracts";

interface SignContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: PendingContract[];
  initialIndex?: number;
  onRefresh?: () => void;
  /** Called with the funding_deal id the moment a contract is signed, so the
   *  caller can hide it immediately (DB completion flag is async). */
  onCompleted?: (fundingDealId: string) => void;
}

declare global {
  interface Window {
    SignWellEmbed: any;
  }
}

// The SDK renders into this element when given `containerId`, so the signing
// experience sits inside our styled dialog instead of Signwell's full-page
// overlay. Still NOT a raw <iframe src> — the SDK manages the embed, so the
// hosted page's X-Frame-Options never applies.
const EMBED_CONTAINER_ID = "signwell-embed-host";

let signwellScriptPromise: Promise<void> | null = null;
function loadSignwellScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.SignWellEmbed) return Promise.resolve();
  if (signwellScriptPromise) return signwellScriptPromise;
  signwellScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://static.signwell.com/assets/embedded.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      signwellScriptPromise = null;
      reject(new Error("Failed to load SignWell embed script"));
    };
    document.body.appendChild(s);
  });
  return signwellScriptPromise;
}

/**
 * Signing surface for an ADDITIONAL business's contract. Renders a styled
 * dialog and hosts the Signwell Embed SDK inside it (via containerId).
 * Completion is recorded in-app via /api/onboarding/sync-business-contract
 * (webhook is the prod backstop); on completed/closed we refresh the pending
 * list so a signed business drops out.
 */
export function SignContractDialog({
  open,
  onOpenChange,
  pending,
  initialIndex = 0,
  onRefresh,
  onCompleted,
}: SignContractDialogProps) {
  const embedRef = useRef<any>(null);
  const current = pending[Math.min(initialIndex, pending.length - 1)] ?? null;

  useEffect(() => {
    if (!open || !current?.contract_url) return;
    let cancelled = false;
    const url = current.contract_url;
    const dealId = current.funding_deal_id;

    loadSignwellScript()
      .then(() => {
        if (cancelled) return;
        // Wait a tick so the dialog's container div is in the DOM.
        const host = document.getElementById(EMBED_CONTAINER_ID);
        if (!window.SignWellEmbed || !host) {
          window.open(url, "_blank");
          onOpenChange(false);
          return;
        }
        const embed = new window.SignWellEmbed({
          url,
          containerId: EMBED_CONTAINER_ID,
          events: {
            completed: async () => {
              // Record completion in-app (PDF download + business-scoped doc +
              // funding_deal flag) so it doesn't depend on the webhook.
              const docId = new URLSearchParams(url.split("?")[1] ?? "").get("doc_id");
              if (docId) {
                try {
                  await fetch("/api/onboarding/sync-business-contract", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ documentId: docId }),
                  });
                } catch (err) {
                  console.error("business-contract sync failed (webhook will backstop):", err);
                }
              }
              try { embedRef.current?.close(); } catch { /* noop */ }
              embedRef.current = null;
              onCompleted?.(dealId); // hide immediately — DB flag is async
              onRefresh?.();
              onOpenChange(false);
            },
            closed: () => {
              embedRef.current = null;
              onRefresh?.();
              onOpenChange(false);
            },
            error: (e: any) => {
              console.error("❌ SignWell embed error:", e);
              toast.error("There was an error loading the application. Try 'Open in new tab'.");
            },
          },
        });
        embedRef.current = embed;
        embed.open();
      })
      .catch((err) => {
        console.error(err);
        window.open(url, "_blank");
        onOpenChange(false);
      });

    return () => {
      cancelled = true;
      if (embedRef.current) {
        try { embedRef.current.close(); } catch { /* noop */ }
        embedRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialIndex]);

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl p-0 overflow-hidden rounded-3xl gap-0">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200 px-6 py-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0">
              <FileSignature className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-black text-amber-950 uppercase tracking-tight truncate">
                Sign Your Application — {current.business_name}
              </h2>
              <p className="text-sm text-amber-900/70 font-bold mt-0.5">
                Your advisor added this business to your file. Sign below to continue.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            title="I'll sign later"
            className="p-2 rounded-lg hover:bg-amber-100 text-amber-700 transition-colors flex-shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Embed host — the Signwell SDK injects the signing UI here */}
        <div
          id={EMBED_CONTAINER_ID}
          className="bg-slate-50 w-full"
          style={{ height: "min(74vh, 700px)" }}
        />

        {/* Footer */}
        <div className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs font-bold uppercase tracking-widest text-slate-600"
          >
            I'll sign later
          </Button>
          <Button
            asChild
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold uppercase tracking-widest"
          >
            <a href={current.contract_url} target="_blank" rel="noopener noreferrer">
              Open in new tab <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
