// The internal-advisor onboarding card. Rendered by /advisor/layout.tsx as a
// TAKEOVER: while a staff advisor still owes a W-9 or a voided check, every
// /advisor/* URL shows this instead of the workspace. There is no separate
// route for it and no redirect — a layout cannot read the pathname, so a
// redirect would loop on its own target, and rendering in place also means
// there is no half-open workspace to click into.

import Image from "next/image";
import { Toaster } from "sonner";
import { LogoutButton } from "@/components/logout-button";
import { AdvisorOnboardingWizard } from "./advisor-onboarding-wizard";

export function AdvisorOnboardingScreen({
  firstName,
  w9Signed,
  voidedCheckFilename,
}: {
  firstName: string;
  w9Signed: boolean;
  voidedCheckFilename: string | null;
}) {
  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink">
      <header className="sticky top-0 z-40 border-b border-black/5 bg-cb-cream/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Image
            src="/powered-by-shield.png"
            alt="Credit Banc — Powered by Shield Advisory Group"
            width={266}
            height={45}
            priority
            className="h-9 w-auto"
          />
          <LogoutButton />
        </div>
      </header>
      <main>
        <div className="mx-auto max-w-xl px-4 py-14 md:py-20">
          <div className="rounded-3xl border border-black/5 bg-white p-8 shadow-sm md:p-10">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-cb-mint">
              Advisor onboarding
            </p>
            <h1 className="font-manrope text-3xl font-extrabold tracking-tight text-cb-ink">
              Welcome aboard, {firstName}.
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-cb-ink/60">
              Two things before your workspace opens — your W-9, and where to send your
              payouts.
            </p>

            <div className="mt-8">
              <AdvisorOnboardingWizard
                firstName={firstName}
                w9Signed={w9Signed}
                voidedCheckFilename={voidedCheckFilename}
              />
            </div>

            <ul className="mt-9 space-y-2.5 border-t border-black/5 pt-7 text-sm text-cb-ink/55">
              <li className="flex gap-2.5">
                <span className="font-bold text-cb-mint">1.</span>
                Both documents go straight to a private vault — nobody outside finance sees them.
              </li>
              <li className="flex gap-2.5">
                <span className="font-bold text-cb-mint">2.</span>
                You can close this tab mid-way; you&apos;ll pick up where you left off.
              </li>
              <li className="flex gap-2.5">
                <span className="font-bold text-cb-mint">3.</span>
                Questions? Reach out to your admin — they can see what&apos;s outstanding.
              </li>
            </ul>
          </div>
        </div>
      </main>
      <Toaster position="top-right" richColors />
    </div>
  );
}
