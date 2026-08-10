"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";
import { completePartnerOnboarding } from "../actions";

/**
 * Set-password form for the referral-partner welcome step.
 *
 * Both fields are one input type toggled together — a partner setting a password
 * for the first time on a link they got by email benefits far more from seeing
 * what they typed than from the confirm field being masked.
 *
 * router.refresh() before push: the dashboard reads password_set_at server-side
 * and would bounce straight back here off a stale cache otherwise.
 */
export function PartnerWelcomeForm({ email }: { email: string }) {
  const router = useRouter();
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const tooShort = pwd.length > 0 && pwd.length < 8;
  const mismatch = confirm.length > 0 && pwd !== confirm;
  const canSubmit = pwd.length >= 8 && pwd === confirm && !isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);

    startTransition(async () => {
      const res = await completePartnerOnboarding(pwd);
      if (!res.success) {
        setError(res.error || "Could not set your password.");
        return;
      }
      router.refresh();
      router.push("/partner/dashboard");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {email && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray mb-1.5">
            Your account
          </label>
          <div className="rounded-xl border border-black/5 bg-cb-cream/60 px-4 py-3 text-sm font-semibold text-cb-ink/60">
            {email}
          </div>
        </div>
      )}

      <div>
        <label
          htmlFor="partner-pwd"
          className="block text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray mb-1.5"
        >
          Create a password
        </label>
        <div className="relative">
          <input
            id="partner-pwd"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 pr-11 text-sm font-medium text-cb-ink focus:outline-none focus:ring-2 focus:ring-cb-mint/40"
            placeholder="At least 8 characters"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-cb-ink/30 hover:text-cb-ink/60"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {tooShort && (
          <p className="mt-1.5 text-xs font-semibold text-amber-600">
            A little longer — 8 characters minimum.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="partner-pwd-confirm"
          className="block text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray mb-1.5"
        >
          Confirm password
        </label>
        <input
          id="partner-pwd-confirm"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-cb-ink focus:outline-none focus:ring-2 focus:ring-cb-mint/40"
        />
        {mismatch && (
          <p className="mt-1.5 text-xs font-semibold text-amber-600">
            These don&apos;t match yet.
          </p>
        )}
      </div>

      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-cb-navy px-6 py-3.5 font-bold text-white shadow-lg transition-all hover:bg-cb-navy/90 active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Setting it up…
          </>
        ) : (
          <>
            Go to my dashboard <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}
