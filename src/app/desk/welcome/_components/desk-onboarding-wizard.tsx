"use client";

// Partner+ onboarding, on one screen: password → phone → W-9 → voided check.
//
// Rendered by /desk/layout.tsx as a TAKEOVER while any step is outstanding.
// Steps are DERIVED from what is already done, so a rep who closes the tab
// halfway lands back exactly where they left off. The server enforces the same
// order in finishDeskOnboarding — this is the convenient version of the gate.
//
// The W-9 and voided-check steps are the shared components partners and
// internal advisors use; only the actions differ.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Eye, EyeOff, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { formatPhoneInput, isValidUsPhone } from "@/lib/phone";
import { W9SignStep } from "@/components/onboarding/w9-sign-step";
import { VoidedCheckStep } from "@/components/onboarding/voided-check-step";
import {
  checkDeskW9,
  finishDeskOnboarding,
  saveDeskContactPhone,
  setDeskPassword,
  startDeskW9,
  uploadDeskVoidedCheck,
} from "../actions";

export interface DeskOnboardingWizardProps {
  email: string;
  firstName: string;
  passwordSet: boolean;
  phone: string | null;
  phoneSet: boolean;
  w9Signed: boolean;
  voidedCheckFilename: string | null;
}

type StepKey = "password" | "phone" | "w9" | "check";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "password", label: "Password" },
  { key: "phone", label: "Phone" },
  { key: "w9", label: "W-9" },
  { key: "check", label: "Voided check" },
];

const LABEL = "mb-1.5 block text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray";
const INPUT =
  "w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-cb-ink focus:outline-none focus:ring-2 focus:ring-cb-mint/40";

export function DeskOnboardingWizard(props: DeskOnboardingWizardProps) {
  const router = useRouter();
  const [finishing, startFinishing] = useTransition();

  const [done, setDone] = useState<Record<StepKey, boolean>>({
    password: props.passwordSet,
    phone: props.phoneSet,
    w9: props.w9Signed,
    check: !!props.voidedCheckFilename,
  });
  const mark = (key: StepKey) => setDone((d) => ({ ...d, [key]: true }));

  const current = STEPS.find((s) => !done[s.key])?.key ?? null;

  const finish = () =>
    startFinishing(async () => {
      const res = await finishDeskOnboarding();
      if (!res.success) {
        toast.error(res.error ?? "Could not finish onboarding.");
        return;
      }
      router.push("/desk/deals");
      router.refresh();
    });

  return (
    <div className="space-y-8">
      <ol className="flex items-center gap-3">
        {STEPS.map((s, i) => {
          const active = current === s.key;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-3">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  done[s.key] ? "bg-cb-mint text-cb-ink" : active ? "bg-cb-ink text-cb-mint" : "bg-black/5 text-cb-ink/40"
                }`}
              >
                {done[s.key] ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span
                className={`hidden text-xs font-bold uppercase tracking-[0.14em] sm:inline ${
                  active ? "text-cb-ink" : "text-cb-ink/40"
                }`}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-black/10" aria-hidden />}
            </li>
          );
        })}
      </ol>

      {current === "password" && <PasswordStep email={props.email} onDone={() => mark("password")} />}
      {current === "phone" && <PhoneStep existingPhone={props.phone} onDone={() => mark("phone")} />}
      {current === "w9" && (
        <W9SignStep
          alreadySigned={done.w9}
          onSigned={() => mark("w9")}
          actions={{ start: startDeskW9, check: checkDeskW9 }}
        />
      )}
      {current === "check" && (
        <VoidedCheckStep
          existingFilename={props.voidedCheckFilename}
          onUploaded={() => mark("check")}
          upload={uploadDeskVoidedCheck}
          description="This is where your commission gets deposited. A photo of a voided business check is fine, or a bank letter with your account details. PDF or image, up to 15MB."
        />
      )}

      {current === null && (
        <div className="space-y-6">
          <div>
            <h2 className="font-manrope text-xl font-extrabold tracking-tight text-cb-ink">
              You&apos;re all set, {props.firstName}.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-cb-ink/60">
              Your paperwork is on file. Your desk is open — start a client whenever you&apos;re ready.
            </p>
          </div>
          <Button
            onClick={finish}
            disabled={finishing}
            className="w-full rounded-xl bg-cb-ink py-6 font-semibold text-cb-mint hover:bg-cb-ink/90"
          >
            {finishing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening your desk&hellip;
              </>
            ) : (
              "Go to my desk"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function PasswordStep({ email, onDone }: { email: string; onDone: () => void }) {
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSubmit = pwd.length >= 8 && pwd === confirm && !pending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const res = await setDeskPassword(pwd);
      if (!res.success) {
        setError(res.error || "Could not set your password.");
        return;
      }
      onDone();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="font-manrope text-xl font-extrabold tracking-tight text-cb-ink">Choose a password</h2>
        <p className="mt-2 text-sm leading-relaxed text-cb-ink/60">
          After this you can sign in any time at{" "}
          <span className="font-semibold text-cb-ink/80">vault.creditbanc.io</span> without an email link.
        </p>
      </div>
      <div>
        <span className={LABEL}>Your account</span>
        <div className="rounded-xl border border-black/5 bg-cb-cream/60 px-4 py-3 text-sm font-semibold text-cb-ink/60">
          {email}
        </div>
      </div>
      <div>
        <label htmlFor="desk-pwd" className={LABEL}>
          Create a password
        </label>
        <div className="relative">
          <input
            id="desk-pwd"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="At least 8 characters"
            className={`${INPUT} pr-11`}
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
        {pwd.length > 0 && pwd.length < 8 && (
          <p className="mt-1.5 text-xs font-semibold text-amber-600">8 characters minimum.</p>
        )}
      </div>
      <div>
        <label htmlFor="desk-pwd-confirm" className={LABEL}>
          Confirm password
        </label>
        <input
          id="desk-pwd-confirm"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={INPUT}
        />
        {confirm.length > 0 && pwd !== confirm && (
          <p className="mt-1.5 text-xs font-semibold text-amber-600">These don&apos;t match yet.</p>
        )}
      </div>
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cb-navy px-6 py-3.5 font-bold text-white shadow-lg transition-all hover:bg-cb-navy/90 disabled:opacity-40"
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Setting it up…
          </>
        ) : (
          <>
            Continue <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}

function PhoneStep({ existingPhone, onDone }: { existingPhone: string | null; onDone: () => void }) {
  const [phone, setPhone] = useState(() => formatPhoneInput(existingPhone ?? ""));
  const [touched, setTouched] = useState(false);
  const [saving, startSaving] = useTransition();
  const valid = isValidUsPhone(phone);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || saving) return;
    startSaving(async () => {
      const res = await saveDeskContactPhone(phone);
      if (!res.success) {
        toast.error(res.error ?? "Could not save your number.");
        return;
      }
      onDone();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <h2 className="font-manrope text-xl font-extrabold tracking-tight text-cb-ink">Your contact number</h2>
        <p className="mt-2 text-sm leading-relaxed text-cb-ink/60">
          Clients you bring on see you as their advisor — this is the number they get.
        </p>
      </div>
      <div className="flex items-start gap-4 rounded-2xl border border-black/5 bg-cb-cream/60 p-6">
        <Phone className="mt-0.5 h-6 w-6 shrink-0 text-cb-mint" />
        <p className="text-sm leading-relaxed text-cb-ink/60">
          Every client you bring on sees this number on their portal. Use the line you actually want them calling.
        </p>
      </div>
      <div>
        <label htmlFor="desk-phone" className={LABEL}>
          Contact phone
        </label>
        <input
          id="desk-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          autoFocus
          maxLength={14}
          value={phone}
          onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
          onBlur={() => setTouched(true)}
          placeholder="(555) 123-4567"
          className={INPUT}
        />
        {touched && phone.length > 0 && !valid && (
          <p className="mt-1.5 text-xs font-semibold text-amber-600">
            That doesn&apos;t look like a complete 10-digit US number.
          </p>
        )}
      </div>
      <Button
        type="submit"
        disabled={!valid || saving}
        className="w-full rounded-xl bg-cb-ink py-6 font-semibold text-cb-mint hover:bg-cb-ink/90"
      >
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving&hellip;
          </>
        ) : (
          "Save and continue"
        )}
      </Button>
    </form>
  );
}
