"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  getPartnerPlusDocUrl,
  resendPartnerPlusWelcome,
  setPartnerPlusActive,
  setPartnerPlusBillingExempt,
} from "../actions";

export interface PartnerPlusRow {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  billing_exempt: boolean;
  active: boolean;
  provisioning_error: string | null;
  w9_signed_at: string | null;
  voided_check_uploaded_at: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
  has_access: boolean;
  stripe_url: string | null;
}

function date(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  trialing: "bg-emerald-50 text-emerald-700",
  past_due: "bg-amber-50 text-amber-700",
};

export function PartnerPlusManager({ rows }: { rows: PartnerPlusRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const run = (key: string, fn: () => Promise<{ success: boolean; error?: string; url?: string }>, ok?: string) => {
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.success) {
        toast.error(res.error ?? "Something went wrong.");
        return;
      }
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
      if (ok) toast.success(ok);
      router.refresh();
    });
  };

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        No Partner+ subscribers yet. Signups start at <span className="font-semibold">/partner-plus</span>.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3">Rep</th>
            <th className="px-4 py-3">Subscription</th>
            <th className="px-4 py-3">Paperwork</th>
            <th className="px-4 py-3">Desk</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="px-4 py-3">
                <p className="font-semibold text-slate-900">
                  {r.first_name} {r.last_name}
                </p>
                <p className="text-slate-500">{r.email}</p>
                {r.company_name && <p className="text-xs text-slate-400">{r.company_name}</p>}
                {r.provisioning_error && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Paid but not provisioned: {r.provisioning_error}
                  </p>
                )}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                    STATUS_TONE[r.subscription_status ?? ""] ?? "bg-slate-100 text-slate-600"
                  }`}
                >
                  {r.subscription_status ?? "none"}
                </span>
                <p className="mt-1 text-xs text-slate-500">
                  {r.cancel_at_period_end ? "Cancels" : "Renews"} {date(r.current_period_end)}
                </p>
                {r.stripe_url && (
                  <a
                    href={r.stripe_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                  >
                    Stripe <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">
                <button
                  type="button"
                  disabled={!r.w9_signed_at || busy === `w9-${r.id}`}
                  onClick={() => run(`w9-${r.id}`, () => getPartnerPlusDocUrl(r.id, "w9"))}
                  className="block font-semibold text-slate-700 hover:underline disabled:font-normal disabled:text-slate-400 disabled:no-underline"
                >
                  W-9: {r.w9_signed_at ? `signed ${date(r.w9_signed_at)}` : "not signed"}
                </button>
                <button
                  type="button"
                  disabled={!r.voided_check_uploaded_at || busy === `vc-${r.id}`}
                  onClick={() => run(`vc-${r.id}`, () => getPartnerPlusDocUrl(r.id, "voided_check"))}
                  className="mt-1 block font-semibold text-slate-700 hover:underline disabled:font-normal disabled:text-slate-400 disabled:no-underline"
                >
                  Voided check: {r.voided_check_uploaded_at ? "on file" : "missing"}
                </button>
                <p className="mt-1">{r.onboarding_completed_at ? "Onboarding complete" : "Onboarding pending"}</p>
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                    r.has_access ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                  }`}
                >
                  {r.has_access ? "Open" : "Locked"}
                </span>
                {r.billing_exempt && <p className="mt-1 text-xs font-semibold text-violet-700">Comped</p>}
                {!r.active && <p className="mt-1 text-xs font-semibold text-red-700">Deactivated</p>}
              </td>
              <td className="space-y-1.5 px-4 py-3 text-right">
                <ActionButton
                  busy={busy === `active-${r.id}`}
                  onClick={() =>
                    run(`active-${r.id}`, () => setPartnerPlusActive(r.id, !r.active), r.active ? "Desk deactivated" : "Desk reactivated")
                  }
                  danger={r.active}
                >
                  {r.active ? "Deactivate" : "Reactivate"}
                </ActionButton>
                <ActionButton
                  busy={busy === `comp-${r.id}`}
                  onClick={() =>
                    run(`comp-${r.id}`, () => setPartnerPlusBillingExempt(r.id, !r.billing_exempt), r.billing_exempt ? "Comp removed" : "Access comped")
                  }
                >
                  {r.billing_exempt ? "Remove comp" : "Comp access"}
                </ActionButton>
                {r.user_id && (
                  <ActionButton
                    busy={busy === `resend-${r.id}`}
                    onClick={() => run(`resend-${r.id}`, () => resendPartnerPlusWelcome(r.id), "Welcome email sent")}
                  >
                    Resend sign-in link
                  </ActionButton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex w-36 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
        danger
          ? "border-red-200 text-red-700 hover:bg-red-50"
          : "border-slate-200 text-slate-700 hover:bg-slate-50"
      }`}
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {children}
    </button>
  );
}
