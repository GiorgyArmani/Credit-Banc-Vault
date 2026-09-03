"use client";

// W-9 signing step, shared by the partner deal-desk onboarding and the internal
// advisor onboarding. The caller supplies the two server actions — one that
// creates/resumes the SignWell document and returns the embedded signing URL,
// one that asks the server whether it is signed — so the component knows
// nothing about which table the row lives in.
//
// The SERVER's answer is the truth about whether it's signed. The embed's
// `completed` event only tells us to go ask.
//
// NEVER a raw <iframe src> — SignWell's hosted page sets X-Frame-Options, so
// the SDK is the only thing that works ([[signwell_embed_and_business_contract_sync]]).

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, FileSignature, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

declare global {
  interface Window {
    SignWellEmbed: any;
  }
}

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

export interface W9SignStepActions {
  /** Create or resume the W-9; returns the embedded signing URL. */
  start: () => Promise<{ success: boolean; url?: string; error?: string }>;
  /** Ask the server whether SignWell reports it signed (and record it if so). */
  check: () => Promise<{ success: boolean; signed: boolean; error?: string }>;
}

export function W9SignStep({
  alreadySigned,
  onSigned,
  actions,
  description = "We need it on file before we can pay you on a funded deal. It opens right here — fill in your own details, sign, and you're done.",
}: {
  alreadySigned: boolean;
  onSigned: () => void;
  actions: W9SignStepActions;
  description?: string;
}) {
  const [signed, setSigned] = useState(alreadySigned);
  const [opening, setOpening] = useState(false);
  const [checking, setChecking] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const embedRef = useRef<any>(null);

  const verify = useCallback(
    async (opts?: { loud?: boolean }) => {
      setChecking(true);
      try {
        const res = await actions.check();
        if (res.signed) {
          setSigned(true);
          toast.success("W-9 received.");
          onSigned();
          return true;
        }
        if (opts?.loud) {
          toast.info(res.error ?? "We haven't got the signed W-9 yet.");
        }
        return false;
      } finally {
        setChecking(false);
      }
    },
    [actions, onSigned]
  );

  // One check on mount: the webhook may already have recorded a signature made
  // in a tab that was closed before the embed could report it.
  useEffect(() => {
    if (alreadySigned) return;
    void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear the embed down if the step unmounts mid-signature.
  useEffect(() => {
    return () => {
      if (embedRef.current) {
        try {
          embedRef.current.close();
        } catch {
          /* noop */
        }
        embedRef.current = null;
      }
    };
  }, []);

  const handleSign = async () => {
    setOpening(true);
    try {
      let signingUrl = url;
      if (!signingUrl) {
        const res = await actions.start();
        if (!res.success || !res.url) {
          toast.error(res.error ?? "Could not open the W-9.");
          return;
        }
        signingUrl = res.url;
        setUrl(signingUrl);
      }

      try {
        await loadSignwellScript();
      } catch {
        // SDK blocked or offline — a new tab still gets them signed.
        window.open(signingUrl, "_blank", "noopener");
        return;
      }

      if (!window.SignWellEmbed) {
        window.open(signingUrl, "_blank", "noopener");
        return;
      }

      const embed = new window.SignWellEmbed({
        url: signingUrl,
        events: {
          completed: async () => {
            try {
              embedRef.current?.close();
            } catch {
              /* noop */
            }
            embedRef.current = null;
            // The embed says done; the server decides. SignWell can take a
            // moment to flip the document to `completed`, so retry briefly
            // before falling back to the manual button.
            for (let attempt = 0; attempt < 5; attempt++) {
              if (await verify()) return;
              await new Promise((r) => setTimeout(r, 1500));
            }
            toast.info("Signature sent. Tap “I’ve signed it” in a moment to confirm.");
          },
          closed: () => {
            embedRef.current = null;
            void verify();
          },
          error: (e: any) => {
            console.error("SignWell embed error:", e);
            toast.error("The signing window failed to load. Try “open in a new tab”.");
          },
        },
      });
      embedRef.current = embed;
      embed.open();
    } finally {
      setOpening(false);
    }
  };

  if (signed) {
    return (
      <div className="flex items-start gap-4 rounded-2xl border border-cb-mint/30 bg-cb-mint/5 p-6">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-cb-mint" />
        <div>
          <p className="font-semibold text-cb-ink">Your W-9 is signed.</p>
          <p className="mt-1 text-sm text-cb-ink/60">
            We have it on file — nothing else to do here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4 rounded-2xl border border-black/5 bg-cb-cream/60 p-6">
        <FileSignature className="mt-0.5 h-6 w-6 shrink-0 text-cb-mint" />
        <div className="min-w-0">
          <p className="font-semibold text-cb-ink">Sign your W-9</p>
          <p className="mt-1 text-sm leading-relaxed text-cb-ink/60">{description}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={handleSign}
          disabled={opening}
          className="rounded-xl bg-cb-ink px-6 py-6 font-semibold text-cb-mint hover:bg-cb-ink/90"
        >
          {opening ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening&hellip;
            </>
          ) : (
            <>
              <FileSignature className="mr-2 h-4 w-4" /> Sign the W-9
            </>
          )}
        </Button>

        <Button
          variant="outline"
          onClick={() => verify({ loud: true })}
          disabled={checking}
          className="rounded-xl border-black/10 px-5 py-6 font-semibold text-cb-ink/70"
        >
          {checking ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking&hellip;
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" /> I&apos;ve signed it
            </>
          )}
        </Button>

        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-cb-ink/50 underline underline-offset-4 hover:text-cb-ink"
          >
            Open in a new tab <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
