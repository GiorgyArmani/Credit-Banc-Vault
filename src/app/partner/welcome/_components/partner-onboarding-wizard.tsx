"use client";

// Partner onboarding, all of it, on one screen.
//
// Two shapes, one component:
//
//   referral_partner  — set a password. That's the whole thing; they share a
//                       link and we owe them a commission.
//   partner_advisor   — set a password, give a contact number, sign a W-9,
//                       upload a voided check. They submit deals and get paid
//                       on funded files, which makes them a payee we report on,
//                       so the deal desk stays shut until the paperwork is in —
//                       and their clients see them as their advisor, which is
//                       why the phone number is asked for here and not left to
//                       an admin to chase later.
//
// Steps are DERIVED from what is already done, not stepped through blindly, so
// a partner who closes the tab halfway lands back exactly where they left off.
// The server enforces the same order — this is the convenient version of the
// gate, not the gate itself.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { PartnerWelcomeForm } from "./partner-welcome-form";
import { PartnerPhoneStep } from "./partner-phone-step";
import { W9SignStep } from "@/components/onboarding/w9-sign-step";
import { VoidedCheckStep } from "@/components/onboarding/voided-check-step";
import {
  checkPartnerW9,
  finishPartnerAdvisorOnboarding,
  startPartnerW9,
  uploadPartnerVoidedCheck,
} from "../actions";

export interface PartnerOnboardingWizardProps {
  email: string;
  firstName: string;
  /** Deal-desk partner? Decides whether the W-9 / voided check steps exist. */
  isDealDesk: boolean;
  passwordSet: boolean;
  /** Whatever is on the partner record — pre-fills the step, never skips it. */
  phone: string | null;
  /** True only for a phone we would actually put in front of a client. */
  phoneSet: boolean;
  w9Signed: boolean;
  voidedCheckFilename: string | null;
}

type StepKey = "password" | "phone" | "w9" | "check";

export function PartnerOnboardingWizard({
  email,
  firstName,
  isDealDesk,
  passwordSet,
  phone,
  phoneSet,
  w9Signed,
  voidedCheckFilename,
}: PartnerOnboardingWizardProps) {
  const router = useRouter();
  const [finishing, startFinishing] = useTransition();

  const [donePassword, setDonePassword] = useState(passwordSet);
  const [donePhone, setDonePhone] = useState(phoneSet);
  const [doneW9, setDoneW9] = useState(w9Signed);
  const [doneCheck, setDoneCheck] = useState(!!voidedCheckFilename);

  const steps = useMemo<{ key: StepKey; label: string }[]>(
    () =>
      isDealDesk
        ? [
            { key: "password", label: "Password" },
            { key: "phone", label: "Phone" },
            { key: "w9", label: "W-9" },
            { key: "check", label: "Voided check" },
          ]
        : [{ key: "password", label: "Password" }],
    [isDealDesk]
  );

  const doneByKey: Record<StepKey, boolean> = {
    password: donePassword,
    phone: donePhone,
    w9: doneW9,
    check: doneCheck,
  };

  // The first unfinished step IS the current step. No "next" button to get out
  // of sync with, and completing something out of order just moves the cursor.
  const current = steps.find((s) => !doneByKey[s.key])?.key ?? null;
  const allDone = current === null;

  const finish = () => {
    startFinishing(async () => {
      // A referrals-only partner has nothing to stamp — the password step
      // already recorded everything there is to record.
      if (!isDealDesk) {
        router.push("/partner/dashboard");
        return;
      }
      const res = await finishPartnerAdvisorOnboarding();
      if (!res.success) {
        toast.error(res.error ?? "Could not finish onboarding.");
        return;
      }
      router.push("/partner/deals");
      router.refresh();
    });
  };

  return (
    <div className="space-y-8">
      {/* Progress rail. One dot per step, filled as they land. */}
      {steps.length > 1 && (
        <ol className="flex items-center gap-3">
          {steps.map((s, i) => {
            const done = doneByKey[s.key];
            const active = current === s.key;
            return (
              <li key={s.key} className="flex flex-1 items-center gap-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                    done
                      ? "bg-cb-mint text-cb-ink"
                      : active
                        ? "bg-cb-ink text-cb-mint"
                        : "bg-black/5 text-cb-ink/40"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span
                  className={`hidden text-xs font-bold uppercase tracking-[0.14em] sm:inline ${
                    active ? "text-cb-ink" : "text-cb-ink/40"
                  }`}
                >
                  {s.label}
                </span>
                {i < steps.length - 1 && (
                  <span className="h-px flex-1 bg-black/10" aria-hidden />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {current === "password" && (
        <div className="space-y-5">
          <div>
            <h2 className="font-manrope text-xl font-extrabold tracking-tight text-cb-ink">
              Choose a password
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-cb-ink/60">
              After this you can sign in any time at{" "}
              <span className="font-semibold text-cb-ink/80">vault.creditbanc.io</span>{" "}
              without waiting on an email link.
            </p>
          </div>
          <PartnerWelcomeForm
            email={email}
            // A deal-desk partner still has paperwork after this, so the form
            // hands control back here instead of bouncing to the dashboard.
            onComplete={isDealDesk ? () => setDonePassword(true) : undefined}
          />
        </div>
      )}

      {current === "phone" && (
        <div className="space-y-5">
          <div>
            <h2 className="font-manrope text-xl font-extrabold tracking-tight text-cb-ink">
              Your contact number
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-cb-ink/60">
              Clients you bring on see you as their advisor — this is the number
              they get.
            </p>
          </div>
          <PartnerPhoneStep
            existingPhone={phone}
            onSaved={() => setDonePhone(true)}
          />
        </div>
      )}

      {current === "w9" && (
        <W9SignStep
          alreadySigned={doneW9}
          onSigned={() => setDoneW9(true)}
          actions={{ start: startPartnerW9, check: checkPartnerW9 }}
        />
      )}

      {current === "check" && (
        <VoidedCheckStep
          existingFilename={voidedCheckFilename}
          onUploaded={() => setDoneCheck(true)}
          upload={uploadPartnerVoidedCheck}
          description="This is where your commission gets deposited. A photo of a voided business check is fine, or a bank letter with your account details. PDF or image, up to 15MB."
        />
      )}

      {allDone && (
        <div className="space-y-6">
          <div>
            <h2 className="font-manrope text-xl font-extrabold tracking-tight text-cb-ink">
              You&apos;re all set, {firstName}.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-cb-ink/60">
              {isDealDesk
                ? "Your paperwork is on file. The deal desk is open — start a client whenever you're ready."
                : "Your account is ready. Share your link and we'll take it from there."}
            </p>
          </div>
          <Button
            onClick={finish}
            disabled={finishing}
            className="w-full rounded-xl bg-cb-ink py-6 font-semibold text-cb-mint hover:bg-cb-ink/90"
          >
            {finishing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening your portal&hellip;
              </>
            ) : (
              "Go to my portal"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
