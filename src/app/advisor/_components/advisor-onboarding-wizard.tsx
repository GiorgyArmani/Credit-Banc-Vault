"use client";

// Internal-advisor onboarding: two steps, one screen.
//
// Password, phone and photo were already collected by the invite signup. What
// finance still needs before an advisor can be paid on a funded file is a
// signed W-9 and a voided check — so those two are the whole wizard.
//
// Steps are DERIVED from what is already done, so an advisor who closes the tab
// halfway lands back exactly where they left off. The server enforces the same
// order; this is the convenient version of the gate, not the gate itself.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { W9SignStep } from "@/components/onboarding/w9-sign-step";
import { VoidedCheckStep } from "@/components/onboarding/voided-check-step";
import {
  checkAdvisorW9,
  finishAdvisorOnboarding,
  startAdvisorW9,
  uploadAdvisorVoidedCheck,
} from "../onboarding/actions";

type StepKey = "w9" | "check";

export function AdvisorOnboardingWizard({
  firstName,
  w9Signed,
  voidedCheckFilename,
}: {
  firstName: string;
  w9Signed: boolean;
  voidedCheckFilename: string | null;
}) {
  const router = useRouter();
  const [finishing, startFinishing] = useTransition();
  const [doneW9, setDoneW9] = useState(w9Signed);
  const [doneCheck, setDoneCheck] = useState(!!voidedCheckFilename);

  const steps = useMemo<{ key: StepKey; label: string }[]>(
    () => [
      { key: "w9", label: "W-9" },
      { key: "check", label: "Voided check" },
    ],
    []
  );
  const doneByKey: Record<StepKey, boolean> = { w9: doneW9, check: doneCheck };
  const current = steps.find((s) => !doneByKey[s.key])?.key ?? null;
  const allDone = current === null;

  const finish = () => {
    startFinishing(async () => {
      const res = await finishAdvisorOnboarding();
      if (!res.success) {
        toast.error(res.error ?? "Could not finish onboarding.");
        return;
      }
      router.push("/advisor/dashboard");
      router.refresh();
    });
  };

  return (
    <div className="space-y-8">
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
              {i < steps.length - 1 && <span className="h-px flex-1 bg-black/10" aria-hidden />}
            </li>
          );
        })}
      </ol>

      {current === "w9" && (
        <W9SignStep
          alreadySigned={doneW9}
          onSigned={() => setDoneW9(true)}
          actions={{ start: startAdvisorW9, check: checkAdvisorW9 }}
          description="Finance needs it on file before you can be paid on a funded deal. It opens right here — fill in your own details, sign, and you're done."
        />
      )}

      {current === "check" && (
        <VoidedCheckStep
          existingFilename={voidedCheckFilename}
          onUploaded={() => setDoneCheck(true)}
          upload={uploadAdvisorVoidedCheck}
          description="This is where your payouts get deposited. A photo of a voided check is fine, or a bank letter with your account details. PDF or image, up to 15MB."
        />
      )}

      {allDone && (
        <div className="space-y-6">
          <div>
            <h2 className="font-manrope text-xl font-extrabold tracking-tight text-cb-ink">
              You&apos;re all set, {firstName}.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-cb-ink/60">
              Your paperwork is on file. Your workspace is open.
            </p>
          </div>
          <Button
            onClick={finish}
            disabled={finishing}
            className="w-full rounded-xl bg-cb-ink py-6 font-semibold text-cb-mint hover:bg-cb-ink/90"
          >
            {finishing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening your workspace&hellip;
              </>
            ) : (
              "Go to my workspace"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
