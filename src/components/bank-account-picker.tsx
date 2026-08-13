"use client";

/**
 * BankAccountPicker — "which account is this statement from?"
 *
 * Rendered by every surface that uploads a bank statement: the client's vault,
 * the advisor/admin workspace, and the underwriting file. Whoever pushes the
 * file is the person who knows which account it came from, so all four roles
 * get the same control rather than leaving underwriting to sort it out
 * afterwards.
 *
 * Two jobs in one component, because splitting them would mean a user who
 * doesn't see their account in the list has to abandon the upload:
 *   1. pick an existing account, and
 *   2. add one inline, without leaving the upload flow.
 *
 * Deliberately unstyled beyond layout. It drops into the client vault's
 * emerald palette and the staff dashboards' slate one, so colour comes from
 * `tone` and everything else inherits.
 */

import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import clsx from "clsx";
import {
  BANK_ACCOUNT_TYPES,
  BANK_ACCOUNT_TYPE_LABELS,
  compareBankAccounts,
  formatBankAccountLabel,
  type BankAccount,
  type BankAccountType,
} from "@/lib/bank-accounts";

interface BankAccountPickerProps {
  businessProfileId: string | null | undefined;
  accounts: BankAccount[];
  /** Selected account id, or null for "not specified". */
  value: string | null;
  onChange: (accountId: string | null) => void;
  /** Called with the created account so the parent can add it to its list. */
  onAccountCreated: (account: BankAccount) => void;
  disabled?: boolean;
  /** Surface palette. `emerald` for the client vault, `slate` for staff. */
  tone?: "emerald" | "slate";
  /** Shown under the select. Omit on tight surfaces. */
  helpText?: string;
  className?: string;
}

export function BankAccountPicker({
  businessProfileId,
  accounts,
  value,
  onChange,
  onAccountCreated,
  disabled = false,
  tone = "slate",
  helpText,
  className,
}: BankAccountPickerProps) {
  const [is_adding, set_is_adding] = useState(false);
  const [bank_name, set_bank_name] = useState("");
  const [last4, set_last4] = useState("");
  const [account_type, set_account_type] = useState<BankAccountType>("checking");
  const [nickname, set_nickname] = useState("");
  const [is_saving, set_is_saving] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  // Retired accounts stay out of the picker but keep holding the statements
  // already filed under them — see groupDocumentsByBankAccount.
  const selectable = accounts.filter((a) => a.is_active).sort(compareBankAccounts);

  const accent =
    tone === "emerald"
      ? {
          label: "text-emerald-900/50",
          select: "border-emerald-100 focus:border-emerald-300",
          button: "text-emerald-600 hover:text-emerald-700",
          save: "bg-emerald-500 hover:bg-emerald-600 text-white",
          panel: "border-emerald-100 bg-emerald-50/30",
        }
      : {
          label: "text-slate-400",
          select: "border-slate-200 focus:border-slate-400",
          button: "text-slate-600 hover:text-slate-900",
          save: "bg-slate-900 hover:bg-slate-800 text-white",
          panel: "border-slate-200 bg-slate-50",
        };

  function reset_form() {
    set_bank_name("");
    set_last4("");
    set_account_type("checking");
    set_nickname("");
    set_error(null);
  }

  async function handle_create() {
    if (!businessProfileId) {
      set_error("No business selected");
      return;
    }
    const trimmed_bank = bank_name.trim();
    const trimmed_last4 = last4.trim();
    if (!trimmed_bank) {
      set_error("Bank name is required");
      return;
    }
    if (!/^\d{4}$/.test(trimmed_last4)) {
      set_error("Enter exactly the last 4 digits of the account number");
      return;
    }

    set_is_saving(true);
    set_error(null);
    try {
      const res = await fetch("/api/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_profile_id: businessProfileId,
          bank_name: trimmed_bank,
          account_last4: trimmed_last4,
          account_type,
          nickname: nickname.trim() || null,
        }),
      });
      const result = await res.json().catch(() => null);

      if (!res.ok || !result?.account) {
        set_error(result?.error || "Could not add the account");
        return;
      }

      // The API returns the existing row on a duplicate rather than an error,
      // so this path also covers "someone else just added the same account" —
      // select it and move on.
      onAccountCreated(result.account as BankAccount);
      onChange(result.account.id);
      reset_form();
      set_is_adding(false);
    } catch (e: any) {
      console.error("bank account create failed:", e);
      set_error("Could not add the account");
    } finally {
      set_is_saving(false);
    }
  }

  return (
    <div className={clsx("space-y-2", className)}>
      <label
        className={clsx(
          "block text-[10px] font-black uppercase tracking-widest",
          accent.label
        )}
      >
        Bank account
      </label>

      {!is_adding && (
        <div className="flex items-center gap-2">
          <select
            value={value ?? ""}
            disabled={disabled || !businessProfileId}
            onChange={(e) => onChange(e.target.value || null)}
            className={clsx(
              "flex-1 min-w-0 rounded-xl border bg-white px-3 py-2 text-sm outline-none transition-colors disabled:opacity-60",
              accent.select
            )}
          >
            {/* Never a blocking requirement. A client who doesn't know which
                account a PDF came from must still be able to send it — an
                unassigned statement is worth more than no statement. */}
            <option value="">Not specified</option>
            {selectable.map((account) => (
              <option key={account.id} value={account.id}>
                {formatBankAccountLabel(account)}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={disabled || !businessProfileId}
            onClick={() => {
              reset_form();
              set_is_adding(true);
            }}
            className={clsx(
              "flex shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50",
              accent.button
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      )}

      {is_adding && (
        <div className={clsx("space-y-3 rounded-xl border p-3", accent.panel)}>
          <div className="flex items-center justify-between">
            <span className={clsx("text-[10px] font-black uppercase tracking-widest", accent.label)}>
              New account
            </span>
            <button
              type="button"
              onClick={() => {
                reset_form();
                set_is_adding(false);
              }}
              className="text-slate-400 transition-colors hover:text-slate-700"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={bank_name}
              onChange={(e) => set_bank_name(e.target.value)}
              placeholder="Bank name (e.g. Chase)"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <input
              value={last4}
              // Digits only, capped at 4 — the field cannot hold a full account
              // number even if someone pastes one. We store the last four
              // deliberately; see the migration header.
              onChange={(e) => set_last4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Last 4 digits"
              inputMode="numeric"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <select
              value={account_type}
              onChange={(e) => set_account_type(e.target.value as BankAccountType)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            >
              {BANK_ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BANK_ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <input
              value={nickname}
              onChange={(e) => set_nickname(e.target.value)}
              placeholder="Nickname (optional)"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>

          {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}

          <button
            type="button"
            onClick={handle_create}
            disabled={is_saving}
            className={clsx(
              "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-60",
              accent.save
            )}
          >
            {is_saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {is_saving ? "Adding…" : "Add account"}
          </button>
        </div>
      )}

      {helpText && !is_adding && (
        <p className="text-[11px] leading-relaxed text-slate-400">{helpText}</p>
      )}
    </div>
  );
}
