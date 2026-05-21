"use client";

import { useState } from "react";
import { FileSignature, ChevronRight, ChevronLeft, X, ExternalLink, RefreshCw } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PendingContract } from "./use-pending-contracts";

interface SignContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: PendingContract[];
  initialIndex?: number;
  onRefresh?: () => void;
}

/**
 * Shared in-house Signwell signing surface. Embeds the signing iframe
 * directly so the client never leaves the app. Used by both the auto-open
 * PendingContractsModal (on dashboard mount) and the explicit "Sign Contract"
 * button on PendingContractsBanner — keeping a single implementation prevents
 * the two paths from drifting.
 */
export function SignContractDialog({
  open,
  onOpenChange,
  pending,
  initialIndex = 0,
  onRefresh,
}: SignContractDialogProps) {
  const [index, setIndex] = useState(initialIndex);
  const [iframeKey, setIframeKey] = useState(0);

  if (pending.length === 0) return null;
  const safeIndex = Math.min(index, pending.length - 1);
  const current = pending[safeIndex];
  if (!current) return null;

  const goPrev = () => {
    setIndex(i => Math.max(0, i - 1));
    setIframeKey(k => k + 1);
  };
  const goNext = () => {
    setIndex(i => Math.min(pending.length - 1, i + 1));
    setIframeKey(k => k + 1);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl p-0 overflow-hidden rounded-3xl">
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200 px-6 py-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0">
              <FileSignature className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-black text-amber-950 uppercase tracking-tight truncate">
                Sign Your Contract — {current.business_name}
              </h2>
              <p className="text-sm text-amber-900/70 font-bold mt-0.5">
                Your advisor added this business to your file. Sign below to continue.
                {pending.length > 1 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-amber-700">
                    <span className="opacity-70">·</span>
                    <span>{safeIndex + 1} of {pending.length}</span>
                  </span>
                )}
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

        <div className="relative bg-slate-50" style={{ height: "min(70vh, 680px)" }}>
          <iframe
            key={iframeKey}
            src={current.contract_url}
            title={`Signwell contract — ${current.business_name}`}
            className="absolute inset-0 w-full h-full border-0"
            allow="camera; microphone; clipboard-write"
          />
        </div>

        <div className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            {pending.length > 1 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goPrev}
                  disabled={safeIndex === 0}
                  className="text-xs font-bold uppercase tracking-widest"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goNext}
                  disabled={safeIndex >= pending.length - 1}
                  className="text-xs font-bold uppercase tracking-widest"
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </>
            )}
            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                title="Refresh status — use after signing if the dialog doesn't close on its own"
                className="text-xs font-bold uppercase tracking-widest"
              >
                <RefreshCw className="h-4 w-4 mr-1" /> Refresh
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
