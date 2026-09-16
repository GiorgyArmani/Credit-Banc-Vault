"use client";

// Collects identity, then sends the browser to Stripe Checkout. Nothing is
// created in our database here — the identity rides on the Stripe Customer.
//
// The submit button is NEVER disabled for an incomplete form. It used to be,
// and CTA.primary's disabled skin (navy at 50% opacity) turned the page's one
// call to action into a grey slab on first paint — before anyone had typed a
// thing. Now it stays full-strength; a submit with gaps marks the fields inline
// and moves focus to the first one. It only disables while checkout is starting.
//
// Client rules mirror SignupSchema in /api/billing/partner-plus/checkout. They
// exist for a useful message before the round trip; the server stays the
// authority and its error still surfaces below the fields.

import { useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CTA, FIELD } from "@/components/marketing/brand-chrome";
import { cn } from "@/lib/utils";
import { formatPhoneInput, isValidUsPhone } from "@/lib/phone";

type Form = { first_name: string; last_name: string; email: string; phone: string; company_name: string };
type Required = Exclude<keyof Form, "company_name">;

const ORDER: Required[] = ["first_name", "last_name", "email", "phone"];

function validate(form: Form): Partial<Record<Required, string>> {
  const errors: Partial<Record<Required, string>> = {};
  if (!form.first_name.trim()) errors.first_name = "Add your first name.";
  if (!form.last_name.trim()) errors.last_name = "Add your last name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Enter a valid email.";
  if (!isValidUsPhone(form.phone)) errors.phone = "Enter a 10-digit US phone number.";
  return errors;
}

export function PartnerPlusSignupForm() {
  const [form, setForm] = useState<Form>({ first_name: "", last_name: "", email: "", phone: "", company_name: "" });
  // Errors only show after a submit attempt — nobody wants to be told a field
  // is wrong before they have reached it.
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const refs = useRef<Partial<Record<Required, HTMLInputElement | null>>>({});

  const errors = attempted ? validate(form) : {};

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: key === "phone" ? formatPhoneInput(e.target.value) : e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const found = validate(form);
    const firstBad = ORDER.find((k) => found[k]);
    if (firstBad) {
      setAttempted(true);
      refs.current[firstBad]?.focus();
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/billing/partner-plus/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "We couldn't start checkout. Try again.");
        setSubmitting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("We couldn't start checkout. Try again.");
      setSubmitting(false);
    }
  };

  const input = (key: Required) => ({
    ref: (el: HTMLInputElement | null) => {
      refs.current[key] = el;
    },
    value: form[key],
    onChange: set(key),
    "aria-invalid": !!errors[key] || undefined,
    "aria-describedby": errors[key] ? `pp-${key}-error` : undefined,
    className: cn(FIELD.input, errors[key] && "border-error focus-visible:ring-error/30"),
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" htmlFor="pp-first" error={errors.first_name} errorId="pp-first_name-error">
          <Input id="pp-first" autoComplete="given-name" {...input("first_name")} />
        </Field>
        <Field label="Last name" htmlFor="pp-last" error={errors.last_name} errorId="pp-last_name-error">
          <Input id="pp-last" autoComplete="family-name" {...input("last_name")} />
        </Field>
      </div>
      <Field label="Work email" htmlFor="pp-email" error={errors.email} errorId="pp-email-error">
        <Input id="pp-email" type="email" autoComplete="email" {...input("email")} />
      </Field>
      <Field label="Phone" htmlFor="pp-phone" error={errors.phone} errorId="pp-phone-error">
        <Input
          id="pp-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={14}
          placeholder="(555) 123-4567"
          {...input("phone")}
        />
      </Field>
      <Field label="Company (optional)" htmlFor="pp-company">
        <Input
          id="pp-company"
          autoComplete="organization"
          value={form.company_name}
          onChange={set("company_name")}
          className={FIELD.input}
        />
      </Field>

      {error && (
        <div role="alert" className={FIELD.error}>
          {error}
        </div>
      )}

      <button type="submit" disabled={submitting} className={cn(CTA.primary, "h-14 w-full py-0 text-base")}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Starting checkout&hellip;
          </>
        ) : (
          "Continue to payment"
        )}
      </button>
      <p className="flex items-center justify-center gap-2 text-xs text-cb-gray">
        <Lock className="h-3.5 w-3.5" /> Secure checkout by Stripe. Cancel anytime.
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  error,
  errorId,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  errorId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={FIELD.label}>
        {label}
      </label>
      {children}
      {error && (
        <p id={errorId} className="text-xs font-semibold text-error">
          {error}
        </p>
      )}
    </div>
  );
}
