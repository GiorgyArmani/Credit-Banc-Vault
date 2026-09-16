"use client";

// Partner+ onboarding: password → phone → photo → W-9 → voided check.
//
// Rendered by /desk/layout.tsx as a TAKEOVER while any step is outstanding, so
// this component owns the whole screen rather than sitting inside a card.
//
// ONE STEP PER SCREEN, with progress shown as a ledger of what is on file
// rather than a stepper. A broker's unit of work is an assembled file, so
// "phone: on file / photo: needed" is the reading they already do all day —
// and unlike dots, it says what is actually outstanding.
//
// Steps are DERIVED from what is already done, so a rep who closes the tab
// halfway lands back exactly where they left off. `viewing` overrides that
// derivation in one direction only: a rep can go BACK to a finished step to fix
// a typo, which the old stepper made impossible.
//
// The server enforces the same order in finishDeskOnboarding via
// missingOnboardingRequirement — this is the convenient version of the gate,
// never the authority.
//
// The W-9, voided-check and photo steps are shared components that partners and
// internal advisors use too; only the actions differ.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { formatPhoneInput, isValidUsPhone } from "@/lib/phone";
import { W9SignStep } from "@/components/onboarding/w9-sign-step";
import { VoidedCheckStep } from "@/components/onboarding/voided-check-step";
import { ProfilePhotoStep } from "@/components/onboarding/profile-photo-step";
import {
  checkDeskW9,
  finishDeskOnboarding,
  saveDeskContactPhone,
  saveDeskProfilePhoto,
  setDeskPassword,
  startDeskW9,
  uploadDeskVoidedCheck,
} from "../actions";

export interface DeskOnboardingWizardProps {
  email: string;
  firstName: string;
  fullName: string;
  passwordSet: boolean;
  phone: string | null;
  phoneSet: boolean;
  profilePicUrl: string | null;
  w9Signed: boolean;
  voidedCheckFilename: string | null;
}

type StepKey = "password" | "phone" | "photo" | "w9" | "check";

/** Effort ascends: 30 seconds of typing before three minutes of paperwork. */
const STEPS: { key: StepKey; ledger: string; question: string; why: string }[] = [
  {
    key: "password",
    ledger: "Password",
    question: "Set your password",
    why: "You got in with an emailed link. Pick a password and you can sign in directly from now on.",
  },
  {
    key: "phone",
    ledger: "Phone",
    question: "What number should your clients call?",
    why: "Every client you bring on sees you as their advisor. This is the number that shows on their portal.",
  },
  {
    key: "photo",
    ledger: "Photo",
    question: "Put a face on your advisor card",
    why: "Your clients see this beside your name on every deal you bring in.",
  },
  {
    key: "w9",
    ledger: "W-9",
    question: "We need your W-9 on file",
    why: "It has to be signed before we can pay you on a funded deal. It opens right here.",
  },
  {
    key: "check",
    ledger: "Voided check",
    question: "Where should we send your commission?",
    why: "A photo of a voided business check works, or a bank letter with your account details.",
  },
];

const LABEL = "mb-1.5 block text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray";
const INPUT =
  "w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-cb-ink focus:outline-none focus:ring-2 focus:ring-cb-mint/40";
const PRIMARY =
  "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cb-navy px-6 py-4 font-bold text-white shadow-lg transition-colors hover:bg-cb-navy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-mint focus-visible:ring-offset-2 disabled:opacity-40";

export function DeskOnboardingWizard(props: DeskOnboardingWizardProps) {
  const router = useRouter();
  const [finishing, startFinishing] = useTransition();

  const [done, setDone] = useState<Record<StepKey, boolean>>({
    password: props.passwordSet,
    phone: props.phoneSet,
    photo: !!props.profilePicUrl,
    w9: props.w9Signed,
    check: !!props.voidedCheckFilename,
  });

  // What the ledger shows beside a finished row — the value itself where there
  // is one, so the ledger reports the file's contents, not just its progress.
  const [detail, setDetail] = useState<Partial<Record<StepKey, string>>>({
    phone: props.phoneSet && props.phone ? props.phone : undefined,
    check: props.voidedCheckFilename ?? undefined,
  });

  /** Set only when the rep navigates back to a step they already finished. */
  const [viewing, setViewing] = useState<StepKey | null>(null);

  const firstOpen = STEPS.find((s) => !done[s.key])?.key ?? null;
  const current = viewing ?? firstOpen;

  const advance = (from: Record<StepKey, boolean>) =>
    setViewing(STEPS.find((s) => !from[s.key])?.key ?? null);

  const mark = (key: StepKey, note?: string) => {
    const next = { ...done, [key]: true };
    setDone(next);
    if (note) setDetail((d) => ({ ...d, [key]: note }));
    advance(next);
  };

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

  const step = current ? STEPS.find((s) => s.key === current)! : null;
  const revisiting = !!current && done[current];

  // The greeting folds into the first headline rather than sitting above it as
  // a label — a rep who has already started does not need welcoming again.
  const untouched = STEPS.every((s) => !done[s.key]);
  const heading =
    step?.key === "password" && untouched
      ? `Welcome, ${props.firstName}. Let's set your password.`
      : step?.question;

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-[1fr_15rem] md:gap-14 md:py-20">
      <div className="min-w-0">
        {step ? (
          <>
            {revisiting && (
              <button
                type="button"
                onClick={() => advance(done)}
                className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-cb-ink/50 transition-colors hover:text-cb-ink"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to setup
              </button>
            )}

            <h1
              className="max-w-[34ch] font-manrope text-3xl font-extrabold leading-[1.1] tracking-tight text-cb-ink sm:text-4xl"
              aria-live="polite"
            >
              {heading}
            </h1>
            <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-cb-ink/60">{step.why}</p>

            <div className="mt-9">
              {current === "password" && (
                <PasswordStep email={props.email} onDone={() => mark("password")} />
              )}
              {current === "phone" && (
                <PhoneStep
                  existingPhone={props.phone}
                  onDone={(saved) => mark("phone", saved)}
                />
              )}
              {current === "photo" && (
                <ProfilePhotoStep
                  name={props.fullName}
                  existingUrl={props.profilePicUrl}
                  onSaved={() => mark("photo", "Added")}
                  upload={saveDeskProfilePhoto}
                />
              )}
              {current === "w9" && (
                <W9SignStep
                  alreadySigned={done.w9}
                  onSigned={() => mark("w9", "Signed")}
                  actions={{ start: startDeskW9, check: checkDeskW9 }}
                />
              )}
              {current === "check" && (
                <VoidedCheckStep
                  existingFilename={props.voidedCheckFilename}
                  onUploaded={() => mark("check", "Uploaded")}
                  upload={uploadDeskVoidedCheck}
                  description="This is where your commission gets deposited. A photo of a voided business check is fine, or a bank letter with your account details. PDF or image, up to 15MB."
                />
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="max-w-[30ch] font-manrope text-3xl font-extrabold leading-[1.1] tracking-tight text-cb-ink sm:text-4xl">
              Your desk is ready, {props.firstName}.
            </h1>
            <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-cb-ink/60">
              Everything we need is on file. Bring on your first client whenever you want — our
              underwriting team works the back end and closes.
            </p>
            <button type="button" onClick={finish} disabled={finishing} className={`${PRIMARY} mt-9 sm:w-auto`}>
              {finishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Opening your desk&hellip;
                </>
              ) : (
                "Open my desk"
              )}
            </button>
          </>
        )}
      </div>

      <Ledger done={done} detail={detail} current={current} onRevisit={setViewing} />
    </div>
  );
}

/**
 * What is on file, and what is not. Doubles as the back-navigation: a finished
 * row is a button, an outstanding one is inert — nothing invites a rep into a
 * step they cannot complete yet.
 */
function Ledger({
  done,
  detail,
  current,
  onRevisit,
}: {
  done: Record<StepKey, boolean>;
  detail: Partial<Record<StepKey, string>>;
  current: StepKey | null;
  onRevisit: (key: StepKey) => void;
}) {
  const outstanding = STEPS.filter((s) => !done[s.key]).length;

  return (
    <aside className="md:pt-2">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-cb-ink/35">
        {outstanding === 0 ? "All on file" : `${outstanding} still needed`}
      </p>
      <ul className="mt-4 space-y-px">
        {STEPS.map((s) => {
          const complete = done[s.key];
          const active = current === s.key;
          const note = detail[s.key];

          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={!complete || active}
                onClick={() => onRevisit(s.key)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-mint ${
                  active ? "bg-cb-ink/[0.04]" : complete ? "hover:bg-cb-ink/[0.04]" : ""
                } disabled:cursor-default`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
                    complete ? "bg-cb-mint text-cb-ink" : active ? "bg-cb-ink" : "bg-black/[0.07]"
                  }`}
                >
                  {complete && <Check className="h-3 w-3" strokeWidth={3.5} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm font-semibold ${
                      complete || active ? "text-cb-ink" : "text-cb-ink/35"
                    }`}
                  >
                    {s.ledger}
                  </span>
                  {complete && note && (
                    <span className="block truncate text-xs text-cb-ink/45">{note}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 px-3 text-xs leading-relaxed text-cb-ink/35">
        Your subscription is already active. This is the last of the setup.
      </p>
    </aside>
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
    <form onSubmit={submit} className="max-w-md space-y-5">
      <div>
        <span className={LABEL}>Your account</span>
        <div className="rounded-xl border border-black/5 bg-white px-4 py-3 text-sm font-semibold text-cb-ink/60">
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
      <button type="submit" disabled={!canSubmit} className={PRIMARY}>
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Setting it up&hellip;
          </>
        ) : (
          "Save my password"
        )}
      </button>
    </form>
  );
}

function PhoneStep({
  existingPhone,
  onDone,
}: {
  existingPhone: string | null;
  onDone: (saved: string) => void;
}) {
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
      onDone(res.phone ?? phone);
    });
  };

  return (
    <form onSubmit={submit} className="max-w-md space-y-5">
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
      <button type="submit" disabled={!valid || saving} className={PRIMARY}>
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Saving&hellip;
          </>
        ) : (
          "Save my number"
        )}
      </button>
    </form>
  );
}
