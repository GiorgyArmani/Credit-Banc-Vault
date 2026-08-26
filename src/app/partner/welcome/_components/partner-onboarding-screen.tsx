// The onboarding card itself, presentational.
//
// Rendered from TWO places, which is why it is extracted:
//
//   /partner/welcome        — the invite link's landing page.
//   /partner/layout.tsx     — as a TAKEOVER, when a partner_advisor still owes
//                             us a phone number, a W-9 or a voided check. The layout renders
//                             this instead of `children`, so every /partner/*
//                             URL shows the gate.
//
// The takeover is why there is no redirect: a layout cannot see the pathname,
// so a redirect to /partner/welcome would fire on /partner/welcome too and
// loop. Rendering in place has no such edge, and it also means the partner
// cannot click past the gate into a half-open deal desk.

import { PartnerOnboardingWizard } from "./partner-onboarding-wizard";

export interface PartnerOnboardingScreenProps {
  email: string;
  firstName: string;
  isDealDesk: boolean;
  passwordSet: boolean;
  phone: string | null;
  phoneSet: boolean;
  w9Signed: boolean;
  voidedCheckFilename: string | null;
}

export function PartnerOnboardingScreen({
  email,
  firstName,
  isDealDesk,
  passwordSet,
  phone,
  phoneSet,
  w9Signed,
  voidedCheckFilename,
}: PartnerOnboardingScreenProps) {
  return (
    <div className="mx-auto max-w-xl px-4 py-14 md:py-20">
      <div className="rounded-3xl border border-black/5 bg-white p-8 shadow-sm md:p-10">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-cb-mint">
          Referral Partner Program
        </p>
        <h1 className="font-manrope text-3xl font-extrabold tracking-tight text-cb-ink">
          Welcome, {firstName}.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-cb-ink/60">
          {isDealDesk
            ? "A few things before you start submitting deals — how your clients reach you, your W-9, and where to send your commission."
            : "One thing before you go in: choose a password."}
        </p>

        <div className="mt-8">
          <PartnerOnboardingWizard
            email={email}
            firstName={firstName}
            isDealDesk={isDealDesk}
            passwordSet={passwordSet}
            phone={phone}
            phoneSet={phoneSet}
            w9Signed={w9Signed}
            voidedCheckFilename={voidedCheckFilename}
          />
        </div>

        <ul className="mt-9 space-y-2.5 border-t border-black/5 pt-7 text-sm text-cb-ink/55">
          {isDealDesk ? (
            <>
              <li className="flex gap-2.5">
                <span className="font-bold text-cb-mint">1.</span>
                Start a client file yourself, or share your referral link.
              </li>
              <li className="flex gap-2.5">
                <span className="font-bold text-cb-mint">2.</span>
                Work the deal through your own desk — documents, lenders, pipeline.
              </li>
              <li className="flex gap-2.5">
                <span className="font-bold text-cb-mint">3.</span>
                Get paid on every file that funds.
              </li>
            </>
          ) : (
            <>
              <li className="flex gap-2.5">
                <span className="font-bold text-cb-mint">1.</span>
                Share your personal referral link.
              </li>
              <li className="flex gap-2.5">
                <span className="font-bold text-cb-mint">2.</span>
                We take it from there — paperwork, lenders, follow-up.
              </li>
              <li className="flex gap-2.5">
                <span className="font-bold text-cb-mint">3.</span>
                Track every referral&apos;s progress from your dashboard.
              </li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}
