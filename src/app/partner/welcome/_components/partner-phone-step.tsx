"use client";

// Partner phone step — the number their clients will call.
//
// The odd step out: the W-9 and the voided check are compliance, this one is
// product. A partner_advisor is the advisor of record on every file they work,
// and the client portal shows the client who their advisor is and how to reach
// them. Without a number that card has a blank on it, and the client's only
// route back to a human is the general line.
//
// Pre-filled when an admin already captured a number on the partner record, so
// the common case is a glance and a click rather than typing. It is still a
// step and not a silent default: a number typed into a CRM months ago is
// exactly the kind of thing worth confirming before clients start dialling it.

import { useState, useTransition } from "react";
import { Phone } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPhoneInput, isValidUsPhone } from "@/lib/phone";
import { toast } from "@/lib/toast";
import { savePartnerContactPhone } from "../actions";

export function PartnerPhoneStep({
  existingPhone,
  onSaved,
}: {
  existingPhone: string | null;
  onSaved: () => void;
}) {
  const [phone, setPhone] = useState(() => formatPhoneInput(existingPhone ?? ""));
  const [touched, setTouched] = useState(false);
  const [saving, startSaving] = useTransition();

  const valid = isValidUsPhone(phone);
  const showError = touched && phone.length > 0 && !valid;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || saving) return;

    startSaving(async () => {
      const res = await savePartnerContactPhone(phone);
      if (!res.success) {
        toast.error(res.error ?? "Could not save your number.");
        return;
      }
      onSaved();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex items-start gap-4 rounded-2xl border border-black/5 bg-cb-cream/60 p-6">
        <Phone className="mt-0.5 h-6 w-6 shrink-0 text-cb-mint" />
        <div className="min-w-0">
          <p className="font-semibold text-cb-ink">Where can your clients reach you?</p>
          <p className="mt-1 text-sm leading-relaxed text-cb-ink/60">
            Every client you bring on sees you as their advisor, with this number on
            their portal. Use the line you actually want them calling.
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor="partner-phone"
          className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray"
        >
          Contact phone
        </label>
        <input
          id="partner-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          autoFocus
          maxLength={14}
          value={phone}
          onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
          onBlur={() => setTouched(true)}
          placeholder="(555) 123-4567"
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-cb-ink focus:outline-none focus:ring-2 focus:ring-cb-mint/40"
        />
        {showError && (
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
