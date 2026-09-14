"use client";

// Collects identity, then sends the browser to Stripe Checkout. Nothing is
// created in our database here — the identity rides on the Stripe Customer.

import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CTA, FIELD } from "@/components/marketing/brand-chrome";
import { formatPhoneInput, isValidUsPhone } from "@/lib/phone";

export function PartnerPlusSignupForm() {
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "", company_name: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: key === "phone" ? formatPhoneInput(e.target.value) : e.target.value }));

  const canSubmit =
    form.first_name.trim() && form.last_name.trim() && form.email.includes("@") && isValidUsPhone(form.phone);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
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
        setError(data.error ?? "We couldn't start checkout. Please try again.");
        setSubmitting(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("We couldn't start checkout. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="pp-first">
          <Input id="pp-first" autoComplete="given-name" value={form.first_name} onChange={set("first_name")} className={FIELD.input} required />
        </Field>
        <Field label="Last name" htmlFor="pp-last">
          <Input id="pp-last" autoComplete="family-name" value={form.last_name} onChange={set("last_name")} className={FIELD.input} required />
        </Field>
      </div>
      <Field label="Work email" htmlFor="pp-email">
        <Input id="pp-email" type="email" autoComplete="email" value={form.email} onChange={set("email")} className={FIELD.input} required />
      </Field>
      <Field label="Phone" htmlFor="pp-phone">
        <Input
          id="pp-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={14}
          placeholder="(555) 123-4567"
          value={form.phone}
          onChange={set("phone")}
          className={FIELD.input}
          required
        />
      </Field>
      <Field label="Company (optional)" htmlFor="pp-company">
        <Input id="pp-company" autoComplete="organization" value={form.company_name} onChange={set("company_name")} className={FIELD.input} />
      </Field>

      {error && <div className={FIELD.error}>{error}</div>}

      <button type="submit" disabled={!canSubmit || submitting} className={`${CTA.primary} w-full`}>
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Starting checkout…
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

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={FIELD.label}>
        {label}
      </label>
      {children}
    </div>
  );
}
