"use client";

import { useMemo, useRef, useState } from "react";
import { motion, type Variants } from "framer-motion";
import Script from "next/script";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Stepper, { Step, type StepperHandle } from "@/components/ui/stepper";
import { formatPhoneInput, isValidUsPhone, toE164 } from "@/lib/phone";
import { CalendarCheck, CheckCircle2, Gift } from "lucide-react";
import {
  LOAN_AMOUNT_OPTIONS,
  FICO_OPTIONS,
  REVENUE_OPTIONS,
  TIME_IN_BUSINESS_OPTIONS,
} from "@/lib/referral-prequal";

const DISQUALIFY_URL =
  process.env.NEXT_PUBLIC_DISQUALIFY_REDIRECT_URL || "https://www.creditbanc.io/thanks-for-applying";

// The GHL / LeadConnector booking widget this funnel books into. Defaults to
// the Credit Banc calendar; override with a widget url via env if it changes.
// Keep IFRAME_ID exactly as GHL generated it so its resize script
// (form_embed.js) keeps matching this calendar.
const ENV_BOOKING = process.env.NEXT_PUBLIC_GHL_BOOKING_URL || "";
const BOOKING_BASE = /widget\/booking\//i.test(ENV_BOOKING)
  ? ENV_BOOKING
  : "https://api.leadconnectorhq.com/widget/booking/89A9rcz6364CmH0L4kty";
const IFRAME_ID = "k89CF4AvNra7oJmpI2vl_1780932488552";
// Human booking page — used only as the "calendar not loading" safety link.
const BOOK_PAGE_URL = "https://creditbanc.io/book-with-creditbanc";
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

type ChoiceKey = "loan_amount" | "fico_band" | "monthly_revenue" | "time_in_business";
type Choice = { key: ChoiceKey; title: string; sub?: string; options: readonly string[] };

// Conversational order: warm up with an easy question, save contact for last.
const CHOICE_STEPS: Choice[] = [
  { key: "loan_amount", title: "How much funding are you looking for?", options: LOAN_AMOUNT_OPTIONS },
  { key: "monthly_revenue", title: "Roughly how much does your business bring in each month?", options: REVENUE_OPTIONS },
  { key: "fico_band", title: "And where's your personal credit these days?", sub: "A ballpark is fine.", options: FICO_OPTIONS },
  { key: "time_in_business", title: "How long have you been in business?", options: TIME_IN_BUSINESS_OPTIONS },
];

// Step map (1-based): 1 name · 2 business · 3..6 choices · 7 contact
const NAME_STEP = 1;
const BUSINESS_STEP = 2;
const FIRST_CHOICE_STEP = 3;
const CONTACT_STEP = FIRST_CHOICE_STEP + CHOICE_STEPS.length; // 7

export function AffiliateLeadForm({
  code,
  affiliateFirstName,
  onQualified,
  showHero = true,
}: {
  code: string;
  affiliateFirstName?: string | null;
  /**
   * Fired once the lead qualifies and the booking calendar takes over. The
   * landing page uses it to retire its "see if you pre-qualify" CTAs — they'd
   * be pointing at a calendar the visitor has already earned.
   */
  onQualified?: () => void;
  /**
   * The form ships with its own hero for surfaces that drop it in bare. The
   * /r/<code> landing page renders its own hero at the top of the page and the
   * form at the bottom, so it turns this off.
   */
  showHero?: boolean;
}) {
  const stepperRef = useRef<StepperHandle>(null);
  const [currentStep, setCurrentStep] = useState(1);

  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState(""); // honeypot
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [qualified, setQualified] = useState(false);

  const firstName = name.trim().split(/\s+/)[0] || "";
  // A partial phone is the one thing that breaks the whole downstream chain
  // (GHL match, SMS, advisor callback), so it gates the step.
  const contactValid = isValidUsPhone(phone) && !!email.trim();
  const greetingName = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : "";

  // Prefilled GHL booking widget url — GHL fills the booking form from these
  // params so the client never re-types what the pre-qual already captured.
  const bookingSrc = useMemo(() => {
    const [first, ...rest] = name.trim().split(/\s+/);
    const url = new URL(BOOKING_BASE);
    if (first) url.searchParams.set("first_name", first);
    const last = rest.join(" ");
    if (last) url.searchParams.set("last_name", last);
    if (email.trim()) url.searchParams.set("email", email.trim().toLowerCase());
    // GHL's booking widget expects E.164 — hand it the same form we push to the CRM.
    const e164 = toE164(phone);
    if (e164) url.searchParams.set("phone", e164);
    return url.toString();
  }, [name, email, phone]);

  const submit = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/refer/${encodeURIComponent(code)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: name.trim(),
          business_name: businessName.trim(),
          phone: phone.trim(),
          email: email.trim().toLowerCase(),
          loan_amount: answers.loan_amount,
          fico_band: answers.fico_band,
          monthly_revenue: answers.monthly_revenue,
          time_in_business: answers.time_in_business,
          company_website: companyWebsite, // honeypot
        }),
      });

      if (!res.ok) {
        const { message } = await res.json().catch(() => ({ message: "Server error" }));
        throw new Error(message || "Something went wrong");
      }

      const data = await res.json();
      if (data.qualified) {
        setQualified(true);
        onQualified?.();
      } else {
        // Disqualified — send them to the thanks-for-applying page.
        window.location.href = DISQUALIFY_URL;
      }
    } catch (err: any) {
      setError(err?.message || "An error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  // Gate the Continue/Complete button per step.
  const nextDisabled = (() => {
    if (isLoading) return true;
    if (currentStep === NAME_STEP) return !name.trim();
    if (currentStep === BUSINESS_STEP) return false; // optional
    if (currentStep >= FIRST_CHOICE_STEP && currentStep < CONTACT_STEP) {
      return !answers[CHOICE_STEPS[currentStep - FIRST_CHOICE_STEP].key];
    }
    if (currentStep === CONTACT_STEP) return !contactValid;
    return false;
  })();

  const pickOption = (key: ChoiceKey, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    // Auto-advance to the next step — feels like a reply in a conversation.
    stepperRef.current?.next();
  };

  const onEnter = (valid: boolean) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (valid) stepperRef.current?.next();
    }
  };

  // ---- Qualified: embed the GHL booking calendar in-app with prefill ----
  if (qualified) {
    return (
      <div className="relative overflow-hidden rounded-3xl bg-white shadow-xl border border-black/5 p-6 md:p-10">
        {/* soft brand glow behind the headline */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-cb-mint/15 blur-3xl"
        />

        <motion.div className="relative text-center" variants={stagger} initial="hidden" animate="visible">
          <motion.div
            variants={fadeUp}
            className="inline-flex items-center gap-2 rounded-full bg-cb-mint/10 border border-cb-mint/20 px-4 py-1.5 text-sm font-semibold text-cb-ink"
          >
            <CheckCircle2 className="h-4 w-4 text-cb-mint" />
            You&rsquo;re pre-qualified
          </motion.div>

          <motion.h3
            variants={fadeUp}
            className="mt-6 font-manrope text-3xl md:text-4xl font-extrabold tracking-tight text-cb-ink leading-[1.08]"
          >
            {greetingName ? <>Nice work, {greetingName}.</> : <>You&rsquo;re in.</>}{" "}
            <span className="text-cb-mint">Let&rsquo;s grab a time.</span>
          </motion.h3>

          <motion.p variants={fadeUp} className="mt-4 text-base md:text-lg leading-relaxed text-cb-ink/60">
            Pick a slot that works and you&rsquo;ll be on an Advisor&rsquo;s calendar in seconds — we&rsquo;ve
            already carried over your details{" "}
            <span className="italic">(because making you type them twice would be rude).</span>
          </motion.p>
        </motion.div>

        <div className="mt-10 mb-6 flex items-center gap-4">
          <div className="flex-1 h-px bg-black/10" />
          <span className="inline-flex items-center gap-2 font-label text-[11px] font-bold uppercase tracking-[0.22em] text-cb-mint">
            <CalendarCheck className="h-4 w-4" />
            Pick your time
          </span>
          <div className="flex-1 h-px bg-black/10" />
        </div>

        {/* Opacity-only fade (no transform) so the GHL iframe isn't resizing
            inside a moving/transformed container while it loads. */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
          className="w-full overflow-hidden rounded-2xl"
        >
          <iframe
            key={bookingSrc}
            src={bookingSrc}
            id={IFRAME_ID}
            title="Book with Credit Banc"
            scrolling="no"
            style={{ width: "100%", minHeight: "700px", border: "none", overflow: "hidden" }}
          />
        </motion.div>

        

        {/* GHL resize script — auto-fits the booking iframe height. afterInteractive
            so the resize listener attaches before the iframe posts its height. */}
        <Script src="https://link.msgsndr.com/js/form_embed.js" strategy="afterInteractive" />
      </div>
    );
  }

  // Hero shown above the flow for every non-qualified state; hidden once the
  // booking calendar takes over so it isn't redundant with "You're pre-qualified".
  const hero = !showHero ? null : (
    <div className="text-center mb-12">
      <div className="mx-auto w-16 h-16 bg-cb-mint text-cb-navy rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-cb-mint/25">
        <Gift className="h-8 w-8" />
      </div>
      {affiliateFirstName && (
        <div className="inline-flex items-center gap-2 rounded-full bg-white border border-black/5 px-4 py-1.5 mb-8 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-cb-mint">
            Referred by {affiliateFirstName}
          </span>
        </div>
      )}
      <h1 className="font-manrope text-4xl md:text-6xl font-extrabold mb-6 leading-[1.05] tracking-tight text-cb-ink">
        Get the funding <br />
        <span className="text-cb-mint">your business needs.</span>
      </h1>
      <p className="text-xl text-cb-mint font-semibold leading-relaxed max-w-lg mx-auto">
        Fast, simple business funding. Find out in seconds if you pre-qualify — no impact to your credit.
      </p>
    </div>
  );

  // ---- Submitting ----
  if (isLoading) {
    return (
      <>
        {hero}
        <div className="rounded-3xl bg-white shadow-xl border border-black/5 p-12 text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cb-mint mx-auto mb-6" />
          <h3 className="font-manrope text-2xl font-extrabold tracking-tight text-cb-ink">Checking if you qualify…</h3>
          <p className="text-cb-gray font-medium mt-2">Hang tight{firstName ? `, ${firstName}` : ""} — this only takes a second.</p>
        </div>
      </>
    );
  }

  // ---- Error (after final submit) ----
  if (error) {
    return (
      <>
        {hero}
        <div className="rounded-3xl bg-white shadow-xl border border-black/5 p-10 text-center">
          <h3 className="font-manrope text-2xl font-extrabold tracking-tight text-cb-ink mb-2">Hmm, that didn't go through</h3>
          <p className="text-red-500 font-medium mb-8">{error}</p>
          <Button
            onClick={submit}
            className="h-14 px-8 bg-cb-mint hover:bg-cb-mint/90 text-cb-navy font-bold rounded-xl shadow-lg shadow-cb-mint/25 text-lg transition-all hover:scale-[1.02] active:scale-95"
          >
            Try again
          </Button>
        </div>
      </>
    );
  }

  const labelClass = "text-[11px] font-bold uppercase tracking-[0.15em] text-cb-mint/70 ml-1";
  const inputClass =
    "h-14 rounded-xl border-cb-mint/20 bg-white focus:border-cb-mint focus:ring-cb-mint/30 transition-all font-medium px-5";

  return (
    <>
      {hero}
      <Stepper
      ref={stepperRef}
      initialStep={1}
      onStepChange={setCurrentStep}
      onFinalStepCompleted={submit}
      nextButtonText="Continue"
      completeButtonText="See if I qualify"
      backButtonText="Back"
      disableStepIndicators
      nextButtonProps={{ disabled: nextDisabled }}
    >
      {/* 1 — name */}
      <Step>
        {/* No "takes about 30 seconds" line here. It was a promise the form
            can't keep — this is seven steps — and the timing claim now lives
            once, next to the CTAs that lead here. */}
        <h3 className="font-manrope text-2xl md:text-3xl font-extrabold text-cb-ink tracking-tight mb-6">
          First things first — what should we call you?
        </h3>
        <div className="grid gap-2">
          <Label htmlFor="ref-full-name" className={labelClass}>Full Name</Label>
          {/* No autoFocus. Browsers scroll a focused element into view on
              load, and this form now sits at the foot of a long landing page —
              autofocusing it dumped every visitor past the entire pitch and
              straight onto step 1. */}
          <Input
            id="ref-full-name"
            type="text"
            placeholder="Your full name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onEnter(!!name.trim())}
            className={inputClass}
          />
        </div>
      </Step>

      {/* 2 — business (optional) */}
      <Step>
        <h3 className="font-manrope text-2xl md:text-3xl font-extrabold text-cb-ink tracking-tight">
          Nice to meet you{firstName ? `, ${firstName}` : ""}! What's your business called?
        </h3>
        <p className="text-cb-mint font-semibold mt-1 mb-6">No business name yet? Just skip ahead.</p>
        <div className="grid gap-2">
          <Label htmlFor="ref-business" className={labelClass}>Business Name</Label>
          <Input
            id="ref-business"
            type="text"
            placeholder="The name of your business"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            onKeyDown={onEnter(true)}
            className={inputClass}
          />
        </div>
      </Step>

      {/* 3..6 — choice questions */}
      {CHOICE_STEPS.map((choice) => (
        <Step key={choice.key}>
          <h3 className="font-manrope text-2xl md:text-3xl font-extrabold text-cb-ink tracking-tight">
            {choice.title}
          </h3>
          {choice.sub && <p className="text-cb-mint font-semibold mt-1">{choice.sub}</p>}
          <div className="grid gap-3 mt-6">
            {choice.options.map((opt) => {
              const selected = answers[choice.key] === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => pickOption(choice.key, opt)}
                  className={
                    "text-left px-5 py-4 rounded-xl border font-semibold transition-all active:scale-[0.99] " +
                    (selected
                      ? "border-cb-mint bg-cb-mint text-cb-navy shadow-lg shadow-cb-mint/20"
                      : "border-cb-mint/20 bg-white text-cb-ink hover:border-cb-mint hover:bg-cb-mint/5")
                  }
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </Step>
      ))}

      {/* 7 — contact */}
      <Step>
        <h3 className="font-manrope text-2xl md:text-3xl font-extrabold text-cb-ink tracking-tight">
          One last thing{firstName ? `, ${firstName}` : ""}...how do we get ahold of you?
        </h3>
        <p className="text-cb-mint font-semibold mt-1 mb-6">Just your phone and email. We promise not to make this weird.</p>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="ref-phone" className={labelClass}>Phone</Label>
            <Input
              id="ref-phone"
              type="tel"
              inputMode="tel"
              maxLength={14}
              placeholder="(555) 555-5555"
              required
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              className={inputClass}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ref-email" className={labelClass}>Email</Label>
            <Input
              id="ref-email"
              type="email"
              placeholder="Your email address"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={onEnter(contactValid)}
              className={inputClass}
            />
          </div>
          {/* honeypot */}
          <input
            type="text"
            name="company_website"
            tabIndex={-1}
            autoComplete="off"
            value={companyWebsite}
            onChange={(e) => setCompanyWebsite(e.target.value)}
            className="hidden"
            aria-hidden="true"
          />
        </div>
      </Step>
      </Stepper>
    </>
  );
}
