"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import LenderMatch from "./lender-match";
import { createClient } from "@/lib/supabase/client";
import BankAnalysisPDF, { type BankAnalysisPDFData } from "./pdf/bank-analysis-pdf";
import { LOAN_TYPES } from "@/data/loan-types";
import { NaicsCombobox } from "@/components/ui/naics-combobox";
import { toast } from "@/lib/toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthlyData {
  totalDeposits: string;
  beginningBalance: string;
  endingBalance: string;
  avgDailyBalance: string;
  numDeposits: string;
  negativeDays: string;
}

interface AccountData {
  accountNumber: string;
  months: MonthlyData[];
  notes: string[];
  /** Per-account override of the visible month window. Falls back to the
   *  global range when undefined. Lets the user shrink/extend an individual
   *  account when only a partial run of statements is available. */
  monthRange?: number;
}

interface OpenPosition {
  funderLender: string;
  loanType: string;     // "MCA", "Term Loan", "LOC", "Factor", etc. — from signup
  frequency: string;    // Payment type: Daily / Weekly / Monthly
  numDebits: string;
  amount: string;       // Payment amount per debit
  balance: string;      // Current outstanding balance
  remitPct: string;
  term: string;
}

interface QualifyingQuestions {
  businessType: string;
  numOwners: string;
  capitalRequested: string;
  fundingTimeframe: string;
  timeInBusiness: string;
  ficoScore: string;
  workingWithOthers: string;
  bankruptcy: string;
  anyPositions: string;
  modifiedOrDefaulted: string;
  repName: string;
}

// ─── Exported Deal Summary (for LenderMatch handoff) ─────────────────────────
// Pass this to <LenderMatch deal={...} /> after completing a bank analysis.

export interface DealSummary {
  businessName: string;
  ownerName: string;
  fico: number;               // from Q6
  tibMonths: number;          // from Q5, normalized to months
  avgRevenue: number;         // computed from bank statements
  avgDailyBalance: number;    // computed from bank statements
  avgMonthlyDeposits: number; // computed from bank statements
  totalNegDays: number;       // summed across all accounts
  numOpenPositions: number;   // active positions count
  hasBankruptcy: boolean;     // from Q8
  capitalRequested: number;   // from Q3
  state: string;              // 2-letter
  industry: string;           // from Q1
  proposedLoanType: string;
  loanPurpose: string;
  businessStartDate: string;
  numOwners: string;
  ownershipDetails: { name: string; pct: number }[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TERM_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Lookback windows offered both in the on-screen range selector and the PDF
 *  export picker. A preset is only exportable when enough months of data exist
 *  (see availableMonths). */
const PERIOD_PRESETS = [3, 4, 6, 12] as const;

/** A month slot counts as having data when any statement figure was entered.
 *  negativeDays defaults to "0", so it's excluded — a lone "0" isn't data. */
function monthHasData(m: MonthlyData): boolean {
  return [
    m.totalDeposits,
    m.beginningBalance,
    m.endingBalance,
    m.avgDailyBalance,
    m.numDeposits,
  ].some((v) => v != null && v.trim() !== "");
}

/** Compute the active month indices anchored at `prevMonthIdx`, counting
 *  backwards `range` months. Used for both the global window and per-account
 *  overrides so the slice math stays in one place. */
function computeMonthIndices(prevMonthIdx: number, range: number): number[] {
  const safeRange = Math.max(1, Math.min(12, Math.floor(range)));
  return Array.from({ length: safeRange }, (_, i) =>
    (prevMonthIdx - safeRange + 1 + i + 12) % 12
  );
}

const emptyMonthly = (): MonthlyData => ({
  totalDeposits: "",
  beginningBalance: "",
  endingBalance: "",
  avgDailyBalance: "",
  numDeposits: "",
  negativeDays: "0",
});

const emptyAccount = (): AccountData => ({
  accountNumber: "",
  months: MONTHS.map(() => emptyMonthly()),
  notes: ["", ""],
});

const emptyPosition = (): OpenPosition => ({
  funderLender: "",
  loanType: "",
  frequency: "",
  numDebits: "",
  amount: "",
  balance: "",
  remitPct: "",
  term: "",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Parse a user-entered money string. Returns a finite number (can be negative)
// or NaN when the input is empty / unparseable. Supports:
//   "$1,234"   → 1234
//   "-$500"    → -500
//   "($500)"   → -500   (accounting-style negatives — common when pasting
//                         from bank statements / Excel)
const parseMoney = (v: string): number => {
  const raw = (v ?? "").trim();
  if (!raw) return NaN;
  // Accounting format: parentheses denote a negative value.
  const paren = /^\(\s*(.+?)\s*\)$/.exec(raw);
  const body = paren ? "-" + paren[1] : raw;
  const stripped = body.replace(/[\s$,]/g, "");
  if (stripped === "" || stripped === "-") return NaN;
  const n = parseFloat(stripped);
  return Number.isFinite(n) ? n : NaN;
};

// Excel-style arithmetic for a single field: "5300+2500-3000" -> 4800,
// "(1000+200)*1.5" -> 1800. Supports + - * / and parentheses for grouping.
// Returns null when `raw` is NOT a formula, so plain numbers, "$1,200", and the
// accounting single-paren negative "(500)" fall through to parseMoney untouched.
// Safe by construction: tokenizes to numbers/operators/parens only (no eval, no
// identifiers), evaluates via shunting-yard.
function evaluateExpression(raw: string): number | null {
  const cleaned = (raw ?? "").replace(/[\s$,]/g, "");
  if (!cleaned) return null;
  // Only treat as a formula when an operator actually joins operands. A bare
  // number, a leading-sign number ("-300"), or a lone "(500)" accounting
  // negative is NOT a formula.
  const hasOperator =
    /[+*/]/.test(cleaned) || /\d-/.test(cleaned) || /\)[-+*/]/.test(cleaned);
  if (!hasOperator) return null;
  if (!/^[0-9.+\-*/()]+$/.test(cleaned)) return null;

  const tokens = cleaned.match(/(\d+\.?\d*|\.\d+|[+\-*/()])/g);
  if (!tokens || tokens.join("") !== cleaned) return null;

  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const output: (number | string)[] = [];
  const ops: string[] = [];
  let prev: "num" | "op" | "open" | null = null;

  for (const t of tokens) {
    if (/^[0-9.]/.test(t)) {
      output.push(parseFloat(t));
      prev = "num";
    } else if (t === "(") {
      ops.push(t);
      prev = "open";
    } else if (t === ")") {
      while (ops.length && ops[ops.length - 1] !== "(") output.push(ops.pop()!);
      if (!ops.length) return null;
      ops.pop();
      prev = "num";
    } else {
      // Unary +/- (start, after another operator, or after "(") → "0 <op> x".
      if ((t === "-" || t === "+") && (prev === null || prev === "op" || prev === "open")) {
        output.push(0);
      }
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        prec[ops[ops.length - 1]] >= prec[t]
      ) {
        output.push(ops.pop()!);
      }
      ops.push(t);
      prev = "op";
    }
  }
  while (ops.length) {
    const o = ops.pop()!;
    if (o === "(") return null;
    output.push(o);
  }

  const stack: number[] = [];
  for (const tok of output) {
    if (typeof tok === "number") {
      stack.push(tok);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) return null;
      stack.push(tok === "+" ? a + b : tok === "-" ? a - b : tok === "*" ? a * b : a / b);
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) return null;
  // Round to 2 decimals to avoid float noise (e.g. 0.1+0.2).
  return Math.round(stack[0] * 100) / 100;
}

const formatMoney = (v: number) => {
  if (!Number.isFinite(v) || v === 0) return "—";
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `-$${abs}` : `$${abs}`;
};
const formatPct = (v: number) => (isNaN(v) || !isFinite(v) ? "—" : (v * 100).toFixed(1) + "%");

// Average of entered values. Excludes empty/unparseable entries but INCLUDES
// negatives and zeros so overdrawn balances pull averages the right direction.
// Returns NaN when no entries are present so callers can show "—".
function avgOfFilled(vals: string[]) {
  const nums = vals.map(parseMoney).filter((n) => Number.isFinite(n));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN;
}

// Sum of entered values. Same semantics as avgOfFilled — negatives are counted
// as negatives, empties are ignored. Returns 0 for an all-empty set because
// sum-of-nothing is 0, not "unknown".
function sumOfFilled(vals: string[]) {
  return vals
    .map(parseMoney)
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => a + b, 0);
}

function avgOfIntegers(vals: string[]) {
  const nums = vals.map(v => parseInt(v)).filter(n => !isNaN(n));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function sumOfIntegers(vals: string[]) {
  return vals.map(v => parseInt(v)).filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
}

// ─── Remit derivation (single source of truth) ────────────────────────────────
// In real MCAs, "Remit %" is almost never on the contract — it's derived from
// the fixed ACH payment × frequency, then compared to avg monthly revenue.
// These multipliers annualize the observed debit cadence.
// Canonical payment frequencies — drives the dropdown in the Positions table
// and maps 1:1 onto freqMultiplier below. Any string passed through
// freqMultiplier outside this list is still supported for legacy data.
const PAYMENT_FREQUENCIES: readonly string[] = ["Daily", "Weekly", "Bi-Weekly", "Monthly"];

function freqMultiplier(frequency: string): number {
  const f = (frequency || "").toLowerCase().trim();
  if (!f) return NaN;
  if (f.startsWith("daily") || f === "day") return 21.67;   // ~260 business days / 12
  if (f.startsWith("bi-week") || f.startsWith("biweek") || f === "every 2 weeks") return 2.167;
  if (f.startsWith("week") || f === "wk") return 4.333;     // 52 / 12
  if (f.startsWith("month") || f === "mo") return 1;
  return NaN;
}

// Position-level metrics derived from raw inputs + avg revenue.
// Priority: payment × freq (true cash burn) → stated remit% fallback.
export interface PositionMetrics {
  monthlyRemit: number;         // dollars/month actually leaving the account
  impliedRemitPct: number;      // monthlyRemit / avgRevenue
  statedRemitPct: number;       // what the user typed (NaN if blank)
  isRemitDerived: boolean;      // true when user didn't enter a % and we derived one
  isPaymentDriven: boolean;     // true when monthly remit came from payment × freq
  paybackMonths: number;
  dataQualityFlag: "ok" | "high" | "impossible"; // >30% = high, >100% = impossible
}

function computePositionMetrics(
  p: { amount: string; balance: string; remitPct: string; frequency: string },
  avgRevenue: number,
  parse: (v: string) => number,
): PositionMetrics {
  const payment = parse(p.amount);
  const balance = parse(p.balance);
  const mult = freqMultiplier(p.frequency);
  const statedPct = parseFloat(p.remitPct) / 100;

  // Prefer the payment-driven burn — works for MCA fixed-ACH, Term Loans, LOCs,
  // and anything else on a fixed schedule. Falls back to revenue × stated% only
  // when we don't have both payment and frequency (legacy % holdback model).
  let monthlyRemit = NaN;
  let isPaymentDriven = false;
  if (Number.isFinite(payment) && Number.isFinite(mult)) {
    monthlyRemit = payment * mult;
    isPaymentDriven = true;
  } else if (Number.isFinite(statedPct) && avgRevenue > 0) {
    monthlyRemit = avgRevenue * statedPct;
  }

  const impliedRemitPct =
    Number.isFinite(monthlyRemit) && avgRevenue > 0 ? monthlyRemit / avgRevenue : NaN;

  const isRemitDerived = !Number.isFinite(statedPct) && Number.isFinite(impliedRemitPct);

  const paybackMonths =
    Number.isFinite(monthlyRemit) && monthlyRemit > 0 && Number.isFinite(balance)
      ? balance / monthlyRemit
      : NaN;

  // 35% is the hardest-stretch ceiling across our lender database — any
  // position above that can't be placed with ANY existing lender. Below 35%
  // is still within at least one lender's max; above is the red zone.
  let dataQualityFlag: PositionMetrics["dataQualityFlag"] = "ok";
  if (Number.isFinite(impliedRemitPct)) {
    if (impliedRemitPct > 1) dataQualityFlag = "impossible";
    else if (impliedRemitPct > 0.35) dataQualityFlag = "high";
  }

  return {
    monthlyRemit,
    impliedRemitPct,
    statedRemitPct: statedPct,
    isRemitDerived,
    isPaymentDriven,
    paybackMonths,
    dataQualityFlag,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CurrencyInput({
  value,
  onChange,
  placeholder = "$0",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  // Excel-style: typing "5300+2500-3000" and blurring (or pressing Enter)
  // replaces the field with the computed result. Non-formula input is left as-is.
  const evaluate = () => {
    const result = evaluateExpression(value);
    if (result !== null) {
      const normalized = String(result);
      if (normalized !== value.trim()) onChange(normalized);
    }
  };
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={evaluate}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      title="Supports math: type e.g. 5300+2500-3000 and press Enter"
      className={`w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-right text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors ${className}`}
    />
  );
}

function TextInput({
  value,
  onChange,
  placeholder = "",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors ${className}`}
    />
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider whitespace-nowrap">{label}</span>
      <span className="text-sm font-mono font-semibold text-emerald-500">{value}</span>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
      <span className="text-xs font-bold tracking-[0.2em] uppercase text-slate-500 whitespace-nowrap px-2">
        {children}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-slate-200 to-transparent" />
    </div>
  );
}

// ─── Account Block ────────────────────────────────────────────────────────────

function AccountBlock({
  account,
  index,
  onChange,
  onRemove,
  canRemove,
  prevMonthIdx,
  globalRange,
}: {
  account: AccountData;
  index: number;
  onChange: (a: AccountData) => void;
  onRemove: () => void;
  canRemove: boolean;
  /** Index of the month immediately preceding today (anchor for the window). */
  prevMonthIdx: number;
  /** Range applied when this account has no per-account override. */
  globalRange: number;
}) {
  const updateMonth = (mi: number, field: keyof MonthlyData, val: string) => {
    let months = [...account.months];
    months[mi] = { ...months[mi], [field]: val };

    // Automatic balance carry-over: Ending Balance(M) -> Beginning Balance(M+1)
    if (field === "endingBalance") {
      const nextMi = (mi + 1) % 12;
      months[nextMi] = { ...months[nextMi], beginningBalance: val };
    }

    onChange({ ...account, months });
  };

  // Per-account window. Falls back to the global range when no override is
  // set. Used when an individual account only has 5 months of statements
  // (or extends to 9, etc.) without disturbing the other accounts.
  const effectiveRange = Math.max(1, Math.min(12, account.monthRange ?? globalRange));
  const activeMonthIndices = computeMonthIndices(prevMonthIdx, effectiveRange);

  const setRange = (next: number) => {
    const clamped = Math.max(1, Math.min(12, Math.floor(next)));
    if (clamped === effectiveRange) return;
    onChange({ ...account, monthRange: clamped });
  };

  const activeMonths = activeMonthIndices.map(mi => account.months[mi]);
  // A month counts as "filled" if any numeric value was entered for deposits —
  // including zero or a negative (which indicates overdrawn activity). The old
  // `> 0` check silently hid months with legit negative or zero deposits.
  const filledMonths = activeMonths.filter((m) => Number.isFinite(parseMoney(m.totalDeposits)));
  const avgDeposits = avgOfFilled(activeMonths.map((m) => m.totalDeposits));
  const avgBalance = avgOfFilled(activeMonths.map((m) => m.avgDailyBalance));
  const sumNegDays = sumOfIntegers(activeMonths.map((m) => m.negativeDays));

  const ROWS: { key: keyof MonthlyData; label: string; isMoney: boolean }[] = [
    { key: "totalDeposits", label: "Total Deposits", isMoney: true },
    { key: "beginningBalance", label: "Beginning Balance", isMoney: true },
    { key: "endingBalance", label: "Ending Balance", isMoney: true },
    { key: "avgDailyBalance", label: "Avg Daily Balance", isMoney: true },
    { key: "numDeposits", label: "# of Deposits", isMoney: false },
    { key: "negativeDays", label: "Negative Days", isMoney: false },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-6">
      {/* Account header */}
      <div className="flex items-center gap-4 px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">Account {index + 1}</span>
          <div className="w-px h-4 bg-slate-200" />
          <TextInput
            value={account.accountNumber}
            onChange={(v) => onChange({ ...account, accountNumber: v })}
            placeholder="Account No."
            className="w-40"
          />
        </div>
        {/* Per-account range stepper. Lets the analyst trim a single account
            to e.g. 5 months when the client couldn't deliver the 6th, or
            extend it beyond the global window if extra history is available. */}
        <div className="flex items-center gap-1 ml-2">
          <button
            type="button"
            onClick={() => setRange(effectiveRange - 1)}
            disabled={effectiveRange <= 1}
            className="w-6 h-6 rounded bg-slate-50 border border-slate-200 text-slate-700 hover:border-emerald-500/60 hover:text-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-sm leading-none font-bold transition-colors"
            title="Remove one month from this account"
          >
            −
          </button>
          <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider min-w-[3.5rem] text-center">
            {effectiveRange} Mo
          </span>
          <button
            type="button"
            onClick={() => setRange(effectiveRange + 1)}
            disabled={effectiveRange >= 12}
            className="w-6 h-6 rounded bg-slate-50 border border-slate-200 text-slate-700 hover:border-emerald-500/60 hover:text-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-sm leading-none font-bold transition-colors"
            title="Add one month to this account"
          >
            +
          </button>
          {account.monthRange !== undefined && account.monthRange !== globalRange && (
            <button
              type="button"
              onClick={() => onChange({ ...account, monthRange: undefined })}
              className="ml-1 text-[9px] text-slate-400 hover:text-slate-500 font-mono uppercase tracking-wider transition-colors"
              title="Use the global range"
            >
              reset
            </button>
          )}
        </div>
        <div className="flex-1" />
        {/* Summary stats */}
        <div className="hidden lg:flex items-center gap-6">
          <StatCell label="Avg Deposits" value={formatMoney(avgDeposits)} />
          <StatCell label="Avg Daily Bal" value={formatMoney(avgBalance)} />
          {/* formatMoney renders NaN/0 as "—" and negatives as "-$…" — overdrawn
              balances must be visible, not silently hidden. */}
          <StatCell label="Total Neg Days" value={sumNegDays.toString()} />
          <StatCell label="Months Filled" value={`${filledMonths.length}/12`} />
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            className="ml-2 text-slate-500 hover:text-rose-600 transition-colors text-xs font-mono border border-slate-200 hover:border-rose-500/40 rounded px-2 py-1"
          >
            Remove
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left px-4 py-2 text-slate-500 font-medium w-36 sticky left-0 bg-white z-10">
                Field
              </th>
              {activeMonthIndices.map((mi) => (
                <th key={mi} className="text-center px-2 py-2 text-slate-500 font-medium min-w-[100px]">
                  {MONTHS[mi].slice(0, 3)}
                </th>
              ))}
              <th className="text-center px-3 py-2 text-emerald-600 font-semibold min-w-[110px] bg-slate-50">
                Avg / Total
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, ri) => {
              const vals = activeMonthIndices.map((mi) => account.months[mi][row.key]);
              const avg = row.isMoney
                ? avgOfFilled(vals)
                : row.key === "negativeDays"
                  ? sumOfIntegers(vals)
                  : avgOfIntegers(vals);

              return (
                <tr
                  key={row.key}
                  className={`border-b border-slate-100 ${ri % 2 === 0 ? "bg-white" : "bg-slate-100"} hover:bg-slate-100/30 transition-colors`}
                >
                  <td className="px-4 py-1.5 text-slate-700 font-medium sticky left-0 z-10 whitespace-nowrap"
                    style={{ background: ri % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                    {row.label}
                  </td>
                  {activeMonthIndices.map((mi) => {
                    const m = account.months[mi];
                    return (
                      <td key={mi} className="px-1 py-1">
                        <CurrencyInput
                          value={m[row.key]}
                          onChange={(v) => updateMonth(mi, row.key, v)}
                          placeholder={row.isMoney ? "0" : "0"}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-1 text-center bg-slate-50 font-mono font-semibold text-emerald-500">
                    {row.isMoney
                      ? formatMoney(avg)
                      : !Number.isFinite(avg) ? "—"
                      : row.key === "negativeDays" ? avg.toString() : avg.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border-t border-slate-100 bg-slate-100">
        {account.notes.map((note, ni) => (
          <div key={ni}>
            <label className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">Note {ni + 1}</label>
            <TextInput
              value={note}
              onChange={(v) => {
                const notes = account.notes.map((n, i) => (i === ni ? v : n));
                onChange({ ...account, notes });
              }}
              placeholder={`Question ${ni + 1}...`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Open Positions ───────────────────────────────────────────────────────────

function OpenPositions({
  positions,
  avgRevenue,
  onChange,
}: {
  positions: OpenPosition[];
  avgRevenue: number;
  onChange: (p: OpenPosition[]) => void;
}) {
  // Auto-derive monthly remit per position using the canonical formula:
  // payment × frequency multiplier (with a fallback to avgRevenue × stated%
  // when payment/frequency aren't both entered). See computePositionMetrics.
  const totalRemit = positions.reduce((sum, p) => {
    const m = computePositionMetrics(p, avgRevenue, parseMoney);
    return sum + (Number.isFinite(m.monthlyRemit) ? m.monthlyRemit : 0);
  }, 0);

  const availableRemit = avgRevenue * 0.2 - totalRemit;
  const usedRemitPct = avgRevenue > 0 ? totalRemit / avgRevenue : 0;

  const updatePosition = (i: number, field: keyof OpenPosition, val: string) => {
    onChange(positions.map((p, pi) => (pi === i ? { ...p, [field]: val } : p)));
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
        <span className="text-xs font-bold tracking-[0.15em] uppercase text-slate-500">Open Positions</span>
        <div className="flex items-center gap-6 flex-wrap">
          <StatCell label="Current Monthly Remit" value={formatMoney(totalRemit)} />
          <StatCell label="Used Remit %" value={formatPct(usedRemitPct)} />
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Available Remit (20%)</span>
            <span className={`text-sm font-mono font-semibold ${availableRemit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {formatMoney(availableRemit)}
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              {["Funder / Lender", "Loan Type", "Payment Type", "Amount", "Balance", "Term", "Remit % (derived)", "Monthly Remit", "Actions"].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, i) => {
              const metrics = computePositionMetrics(pos, avgRevenue, parseMoney);
              const derivedPctLabel = Number.isFinite(metrics.impliedRemitPct)
                ? `${(metrics.impliedRemitPct * 100).toFixed(1)}%`
                : null;
              const qualityColor =
                metrics.dataQualityFlag === "impossible"
                  ? "text-rose-600"
                  : metrics.dataQualityFlag === "high"
                    ? "text-orange-500"
                    : "text-emerald-600";
              return (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-100/20">
                <td className="px-2 py-1.5">
                  <TextInput value={pos.funderLender} onChange={(v) => updatePosition(i, "funderLender", v)} placeholder="Funder name..." />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={pos.loanType}
                    onChange={(e) => updatePosition(i, "loanType", e.target.value)}
                    className="w-full bg-transparent border-none outline-none text-xs text-slate-900 font-mono focus:ring-0 cursor-pointer"
                  >
                    <option value="" className="bg-white">—</option>
                    {pos.loanType && !LOAN_TYPES.includes(pos.loanType) && (
                      <option key={pos.loanType} value={pos.loanType} className="bg-white">
                        {pos.loanType} (legacy)
                      </option>
                    )}
                    {LOAN_TYPES.map((t) => (
                      <option key={t} value={t} className="bg-white">{t}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={pos.frequency}
                    onChange={(e) => updatePosition(i, "frequency", e.target.value)}
                    className="w-full bg-transparent border-none outline-none text-xs text-slate-900 font-mono focus:ring-0 cursor-pointer"
                  >
                    <option value="" className="bg-white">—</option>
                    {pos.frequency && !PAYMENT_FREQUENCIES.includes(pos.frequency) && (
                      <option key={pos.frequency} value={pos.frequency} className="bg-white">
                        {pos.frequency} (legacy)
                      </option>
                    )}
                    {PAYMENT_FREQUENCIES.map((f) => (
                      <option key={f} value={f} className="bg-white">{f}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <CurrencyInput value={pos.amount} onChange={(v) => updatePosition(i, "amount", v)} placeholder="$0" />
                </td>
                <td className="px-2 py-1.5">
                  <CurrencyInput value={pos.balance} onChange={(v) => updatePosition(i, "balance", v)} placeholder="$0" />
                </td>
                <td className="px-2 py-1.5">
                  <TextInput value={pos.term} onChange={(v) => updatePosition(i, "term", v)} placeholder="Term..." />
                </td>
                <td className="px-2 py-1.5 w-24">
                  <div className={`text-sm font-mono font-semibold ${derivedPctLabel ? qualityColor : "text-slate-400"}`}>
                    {derivedPctLabel ?? "—"}
                  </div>
                  {metrics.dataQualityFlag === "high" && (
                    <div className="text-[9px] font-mono text-orange-500 mt-0.5 opacity-80">review</div>
                  )}
                  {metrics.dataQualityFlag === "impossible" && (
                    <div className="text-[9px] font-mono text-rose-600 mt-0.5 opacity-80">review inputs</div>
                  )}
                </td>
                <td className="px-2 py-1.5 w-28">
                  <div className={`text-sm font-mono font-semibold ${
                    metrics.dataQualityFlag === "impossible" ? "text-rose-600" :
                    metrics.dataQualityFlag === "high" ? "text-orange-500" :
                    Number.isFinite(metrics.monthlyRemit) ? "text-slate-900" : "text-slate-400"
                  }`}>
                    {Number.isFinite(metrics.monthlyRemit) ? formatMoney(metrics.monthlyRemit) : "—"}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <button
                    onClick={() => onChange(positions.filter((_, pi) => pi !== i))}
                    className="text-rose-600 hover:text-rose-500 text-[10px] font-mono border border-rose-500/30 hover:border-rose-500/60 rounded px-2 py-0.5 transition-colors"
                  >
                    ×
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-slate-100">
        <button
          onClick={() => onChange([...positions, emptyPosition()])}
          className="text-xs text-emerald-500 hover:text-emerald-400 font-mono border border-emerald-500/30 hover:border-emerald-500/60 rounded px-3 py-1 transition-colors"
        >
          + Add Position
        </button>
      </div>
    </div>
  );
}


interface ClientOption {
  id: string;
  client_name: string;
  company_name: string;
  client_phone: string;
  owner_1_name?: string;
  owner_2_name?: string;
  capital_requested: number;
  credit_score: string;
  business_start_date: string;
  legal_entity_type: string;
  num_owners?: string;
  company_state?: string;
  industry?: string;
  avg_monthly_deposits: number;
  avg_annual_revenue: number;
  proposed_loan_type: string;
}

// Per-business projection. Multi-business clients (~1% of the book) own >1 row
// here; for them the analyst picks which business the analysis is for. The 99%
// single-business case auto-selects the lone (primary) row and renders no picker.
interface BusinessOption {
  id: string;
  is_primary: boolean;
  display_order: number;
  company_name: string | null;
  business_name: string | null;
  legal_entity_type: string | null;
  business_start_date: string | null;
  company_state: string | null;
  industry: string | null;
  avg_monthly_deposits: number | null;
  avg_annual_revenue: number | null;
}

export default function BankAnalysis() {
  const supabase = createClient();
  const searchParams = useSearchParams();

  // ── Client loader state ───────────────────────────────────────────────────
  // The page accepts ?client=<id> so deep-links from the client detail view
  // (admin/UW "View Bank Analysis" button) auto-load the saved analysis
  // without forcing the user to scroll the dropdown.
  const initial_client_id = searchParams?.get("client") ?? "";
  // Deep-link can carry a business id too (?client=X&business=Y) so the
  // "View Bank Analysis" CTA from the per-business detail page lands on the
  // correct business. Picked up by loadClient() once the businesses list is
  // fetched; ignored if the id doesn't belong to this client.
  const initial_business_id = searchParams?.get("business") ?? "";
  const [clientList, setClientList] = useState<ClientOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(initial_client_id);
  const [loadedClientName, setLoadedClientName] = useState("");
  // Combobox UI state for the client search. `isClientDropdownOpen` controls
  // the results panel; `clientHighlight` is the keyboard-nav cursor (-1 = none).
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [clientHighlight, setClientHighlight] = useState(-1);

  // Multi-business state. `businesses` is the per-client list (1 row for the
  // 99% case, N for multi-business). `selectedBusinessId` drives every
  // business-scoped read (open positions, snapshot history, prefill) and is
  // written onto each saved bank_analysis_results row alongside the resolved
  // latest-open funding_deal_id.
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Bank analysis history (side panel). Each save creates a new snapshot;
  // selecting one in the panel re-hydrates the form with its accounts /
  // positions / questions. loadedSnapshotId tracks which row drove the
  // current workspace state so the panel can highlight it.
  interface HistorySnapshot {
    id: string;
    created_at: string;
    business_name: string | null;
    avg_revenue: number | null;
    total_neg_days: number | null;
    num_open_positions: number | null;
  }
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [loadedSnapshotId, setLoadedSnapshotId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);

  // Fetches the snapshot list for the side panel. Light projection (no
  // jsonb columns) so it stays fast even with many rows per client.
  //
  // Scoping rule: when a business id is provided AND the client has >1
  // business, filter snapshots to that business so each business gets its own
  // history stack. When the client has a single business (or no business id
  // is supplied — e.g. legacy callers), fall back to client-scoped to keep
  // pre-multi-business snapshots (NULL business_profile_id) visible.
  const refreshHistory = async (clientId: string, businessId?: string) => {
    if (!clientId) {
      setHistory([]);
      return;
    }
    let query = supabase
      .from("bank_analysis_results")
      .select("id, created_at, business_name, avg_revenue, total_neg_days, num_open_positions")
      .eq("client_id", clientId);
    if (businessId) {
      query = query.eq("business_profile_id", businessId);
    }
    const { data } = await query.order("created_at", { ascending: false });
    setHistory((data as HistorySnapshot[]) || []);
  };

  // Loads a specific snapshot into the workspace. Pulls the full row
  // (with jsonb payloads) on demand, since the list-projection above skips
  // accounts_data / positions_data / questions_data.
  const loadSnapshot = async (snapshotId: string) => {
    const { data: snap } = await supabase
      .from("bank_analysis_results")
      .select("*")
      .eq("id", snapshotId)
      .maybeSingle();
    if (!snap) {
      toast.error("Snapshot not found");
      return;
    }
    if (snap.accounts_data) setAccounts(snap.accounts_data);
    if (snap.positions_data) setPositions(snap.positions_data);
    if (snap.questions_data) setQuestions(snap.questions_data);
    if (typeof snap.has_bankruptcy === "boolean") setHasBankruptcy(snap.has_bankruptcy);
    if (snap.business_name) setBusinessName(snap.business_name);
    if (snap.owner_name) setOwnerName(snap.owner_name);
    setLoadedSnapshotId(snap.id);
    toast.success("Snapshot loaded", {
      description: new Date(snap.created_at).toLocaleString(),
    });
  };

  // Removes a snapshot. Hard delete — snapshots are cheap and the analyst
  // usually wants the bad ones gone, not archived.
  const deleteSnapshot = async (snapshotId: string) => {
    const { error } = await supabase
      .from("bank_analysis_results")
      .delete()
      .eq("id", snapshotId);
    if (error) {
      toast.error("Could not delete snapshot", { description: error.message });
      return;
    }
    if (loadedSnapshotId === snapshotId) setLoadedSnapshotId(null);
    // Re-fetch with the same business scope the panel is currently showing
    // so we don't accidentally widen back to all-client snapshots on delete.
    if (selectedClientId) {
      refreshHistory(
        selectedClientId,
        businesses.length > 1 && selectedBusinessId ? selectedBusinessId : undefined,
      );
    }
    toast.success("Snapshot removed");
  };

  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerName2, setOwnerName2] = useState("");
  const [referredBy, setReferredBy] = useState("");
  const [phone, setPhone] = useState("");
  const [phone2, setPhone2] = useState("");

  const [accounts, setAccounts] = useState<AccountData[]>([emptyAccount()]);
  const [positions, setPositions] = useState<OpenPosition[]>(
    Array(6).fill(null).map(() => emptyPosition())
  );
  const [questions, setQuestions] = useState<QualifyingQuestions>({
    businessType: "", numOwners: "", capitalRequested: "", fundingTimeframe: "",
    timeInBusiness: "", ficoScore: "", workingWithOthers: "", bankruptcy: "",
    anyPositions: "", modifiedOrDefaulted: "", repName: "",
  });

  const [hasBankruptcy, setHasBankruptcy] = useState(false);
  const [hasZBL, setHasZBL] = useState(false);
  const [capitalRequested, setCapitalRequested] = useState<number>(0);
  const [state, setState] = useState("");
  const [industry, setIndustry] = useState("");

  const [activeTab, setActiveTab] = useState<"analysis" | "positions">("analysis");

  // ── Month range selector ────────────────────────────────────────────────
  const [monthRange, setMonthRange] = useState<3 | 4 | 6 | 12>(3);

  // ── PDF export period picker ──────────────────────────────────────────────
  // Which lookback windows to render in the exported PDF. The dialog lets the
  // user tick several (e.g. 3 + 6); each becomes its own Account Breakdown page.
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportPeriods, setExportPeriods] = useState<number[]>([]);

  // Always count backwards from previous month
  // e.g. current=March(2), previous=February(1), 3 months: [Dec(11), Jan(0), Feb(1)]
  const prevMonthIdx = (new Date().getMonth() - 1 + 12) % 12;
  const activeMonthIndices = computeMonthIndices(prevMonthIdx, monthRange);

  // ── Fetch clients on mount ────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from("client_data_vault")
      .select("id, client_name, company_name, client_phone, owner_1_name, owner_2_name, capital_requested, credit_score, business_start_date, legal_entity_type, num_owners:number_of_owners, company_state, industry, avg_monthly_deposits, avg_annual_revenue, proposed_loan_type")
      .order("client_name", { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        const rows = data as ClientOption[];
        setClientList(rows);
        // Deep-link prefill: show the linked client's name in the search box
        // so a ?client=<id> arrival reads as "selected", not blank.
        if (initial_client_id) {
          const match = rows.find((c) => c.id === initial_client_id);
          if (match) setClientSearch(`${match.company_name} · ${match.client_name}`);
        }
      });
  }, []);

  // ── Compute TIB string or months from start date ───────────────────────────
  function formatFullDate(dateStr: string): string {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function computeTIB(startDate: string): string {
    if (!startDate) return "";
    const start = new Date(startDate);
    const now = new Date();
    const totalMonths = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;
    if (years === 0) return `${months} month${months !== 1 ? "s" : ""}`;
    if (months === 0) return `${years} year${years !== 1 ? "s" : ""}`;
    return `${years} year${years !== 1 ? "s" : ""} ${months} month${months !== 1 ? "s" : ""}`;
  }

  function computeTIBMonths(startDate: string): number {
    if (!startDate) return 0;
    const start = new Date(startDate);
    const now = new Date();
    return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  }

  // ── Load selected client into form ───────────────────────────────────────
  //
  // Two-phase load:
  //   1. Identity prefill (owner, phone, FICO, num owners, capital ask, TIB)
  //      from client_data_vault — these are client-scoped, not business-scoped.
  //   2. Fetch the per-business list and delegate to loadBusinessScopedData
  //      for the resolved business. Single-business clients (99%) just get
  //      their lone business auto-selected; multi-business honors the
  //      ?business=<id> deep-link or falls back to the primary row.
  async function loadClient(clientIdArg?: string) {
    // Accept an explicit id (combobox selection auto-loads before the
    // selectedClientId state flush) and fall back to the selected state.
    const cid = clientIdArg ?? selectedClientId;
    if (!cid) return;
    if (cid !== selectedClientId) setSelectedClientId(cid);
    setIsLoading(true);
    const client = clientList.find(c => c.id === cid);
    if (!client) { setIsLoading(false); return; }

    // Client-scoped identity fields (same regardless of which business is active).
    setOwnerName(client.owner_1_name || client.client_name || "");
    setOwnerName2(client.owner_2_name || "");
    setPhone(client.client_phone || "");
    setQuestions(q => ({
      ...q,
      capitalRequested: client.capital_requested ? `$${client.capital_requested.toLocaleString()}` : "",
      numOwners: client.num_owners || "",
      ficoScore: client.credit_score || "",
    }));
    setLoadedClientName(`${client.company_name} — ${client.client_name}`);

    // Fetch the businesses owned by this client. Ordered so the primary
    // surfaces first; ties broken by display_order then created_at.
    const { data: bizRows } = await supabase
      .from("business_profiles")
      .select("id, is_primary, display_order, company_name, business_name, legal_entity_type, business_start_date, company_state, industry, avg_monthly_deposits, avg_annual_revenue")
      .eq("client_vault_id", cid)
      .order("is_primary", { ascending: false })
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });

    const list = (bizRows as BusinessOption[]) || [];
    setBusinesses(list);

    // Resolve which business to load:
    //   1. ?business=<id> deep-link, if it belongs to this client
    //   2. primary (is_primary=true), if any
    //   3. first in the list (post-ordering, that's primary anyway)
    // If the client has NO business_profiles rows (shouldn't happen
    // post-backfill, but guards against legacy data), fall back to a
    // synthetic stub built from client_data_vault so the form still loads.
    const deepLinked = initial_business_id && list.find(b => b.id === initial_business_id);
    const resolved = deepLinked || list.find(b => b.is_primary) || list[0] || null;

    if (resolved) {
      setSelectedBusinessId(resolved.id);
      await loadBusinessScopedData(resolved, client, list, cid);
    } else {
      // Legacy path: no business_profiles row exists. Prefill from
      // client_data_vault directly so the screen still works.
      setSelectedBusinessId("");
      setBusinessName(client.company_name || "");
      setState(client.company_state || "");
      setIndustry(client.industry || "");
      setQuestions(q => ({
        ...q,
        businessType: client.legal_entity_type || "",
        timeInBusiness: formatFullDate(client.business_start_date),
      }));
      await loadBusinessScopedData(null, client, list, cid);
    }
  }

  // ── Load business-scoped slice (prefill + snapshot + positions + history) ──
  //
  // Called from loadClient on initial load AND from the BusinessPicker when
  // the analyst switches businesses on a multi-business client. Reads are
  // scoped to `business?.id` when present; on legacy single-business clients
  // (no business_profile row) we fall through to the client-scoped queries
  // so the historical snapshots and positions stay reachable.
  //
  // bizList is passed as a parameter (rather than read from `businesses`
  // state) because the caller invokes this immediately after setBusinesses,
  // and React's state batching means the state hook hasn't flushed yet.
  async function loadBusinessScopedData(
    business: BusinessOption | null,
    client: ClientOption,
    bizList: BusinessOption[],
    clientId: string,
  ) {
    const isMultiBusiness = bizList.length > 1;
    // Business-level prefill (only when we have a business row — otherwise the
    // caller already populated from client_data_vault as a legacy fallback).
    if (business) {
      // company_name on business_profiles is the post-refactor source of
      // truth; for legacy/backfilled rows it mirrors client_data_vault.
      setBusinessName(business.company_name || business.business_name || client.company_name || "");
      setState(business.company_state || client.company_state || "");
      setIndustry(business.industry || client.industry || "");
      setQuestions(q => ({
        ...q,
        businessType: business.legal_entity_type || client.legal_entity_type || "",
        timeInBusiness: formatFullDate(business.business_start_date || client.business_start_date),
      }));
    }

    // 1. Latest saved snapshot. For multi-business clients (>1 business) we
    //    scope by business_profile_id so each business gets its own history
    //    stack — analyses for Acme Roofing never bleed into Acme HVAC. For
    //    single-business clients we keep the client-scoped read so legacy
    //    snapshots (NULL business_profile_id, predating this code) remain
    //    visible.
    let snapshotQuery = supabase
      .from("bank_analysis_results")
      .select("*")
      .eq("client_id", clientId);
    if (business && isMultiBusiness) {
      snapshotQuery = snapshotQuery.eq("business_profile_id", business.id);
    } else if (business) {
      // N=1 case: prefer the business-tagged snapshot if any exists, otherwise
      // the legacy untagged ones. Postgrest `or` filter handles both.
      snapshotQuery = snapshotQuery.or(
        `business_profile_id.eq.${business.id},business_profile_id.is.null`,
      );
    }
    const { data: analysis } = await snapshotQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let savedPositions: OpenPosition[] = [];
    if (analysis) {
      if (analysis.accounts_data) setAccounts(analysis.accounts_data);
      if (analysis.positions_data) savedPositions = analysis.positions_data;
      if (analysis.questions_data) setQuestions(analysis.questions_data);
      if (typeof analysis.has_bankruptcy === 'boolean') setHasBankruptcy(analysis.has_bankruptcy);
      setLoadedSnapshotId(analysis.id);
    } else {
      setAccounts([emptyAccount()]);
      setHasBankruptcy(false);
      setLoadedSnapshotId(null);
    }

    // History side-panel: business-scoped only when multi-business; otherwise
    // client-scoped so legacy snapshots stay in the list.
    refreshHistory(clientId, isMultiBusiness && business ? business.id : undefined);

    // 2. Open positions ("ground truth" from Client Vault). Same scoping
    //    rule: business-scoped when multi-business, client-scoped otherwise
    //    so legacy NULL rows still show up for the 99% case.
    let positionsQuery = supabase
      .from("client_open_positions")
      .select("*")
      .eq("client_vault_id", clientId);
    if (business && isMultiBusiness) {
      positionsQuery = positionsQuery.eq("business_profile_id", business.id);
    }
    const { data: dbPositions } = await positionsQuery
      .order("position_number", { ascending: true });

    if (dbPositions && dbPositions.length > 0) {
      const mappedPositions = dbPositions.map(p => {
        // Look for matching position in saved analysis to preserve underwriter-only fields
        const saved = savedPositions.find(sp => sp.funderLender === p.lender_name);
        // Frequency lives on client_open_positions.payment_frequency after the
        // 20260518 migration. Fall back to a saved snapshot (for analyses that
        // pre-date the migration) and then to the legacy payment_term text
        // column in case it carried a recognizable cadence ("Daily" etc.).
        const freq = p.payment_frequency || saved?.frequency || (
          ['Daily', 'Weekly', 'Bi-Weekly', 'Monthly'].includes(p.payment_term ?? '')
            ? p.payment_term
            : ''
        ) || "";
        // Term comes from term_remaining (structured count) when present;
        // otherwise fall back to the legacy free-text payment_term.
        const term_value = p.term_remaining != null
          ? String(p.term_remaining)
          : (p.payment_term && !['Daily', 'Weekly', 'Bi-Weekly', 'Monthly'].includes(p.payment_term)
              ? p.payment_term
              : "");
        return {
          funderLender: p.lender_name,
          // Loan product type (MCA / Term Loan / LOC / etc.) — comes from the
          // client signup and lives on client_open_positions.loan_type.
          loanType: saved?.loanType || p.loan_type || "",
          // Payment cadence (Daily / Weekly / Bi-Weekly / Monthly).
          frequency: freq,
          numDebits: saved?.numDebits || "0",
          amount: p.payment_amount?.toString() || "",
          balance: p.current_balance?.toString() || "",
          term: term_value,
          remitPct: saved?.remitPct || "0",
        };
      });

      // Pad to 6 slots
      const padded = [...mappedPositions];
      while (padded.length < 6) padded.push(emptyPosition());
      setPositions(padded);
    } else if (savedPositions.length > 0) {
      // If no ground truth in DB, use whatever was saved in analysis
      setPositions(savedPositions);
    } else {
      // Default empty state
      setPositions(Array(6).fill(null).map(emptyPosition));
    }

    setIsLoading(false);
  }

  // Search across company, client, both owner names, and phone so the analyst
  // can find a file by whatever they remember. Tokenized (every word must
  // match somewhere) so "acme john" narrows to John at Acme.
  const filteredClients = (() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clientList;
    // Drop the "·" separator that our own selection label injects, so
    // refocusing a selected client ("Acme · John") still matches.
    const tokens = q.split(/\s+/).filter((t) => t && t !== "·");
    return clientList.filter((c) => {
      const haystack = [
        c.company_name,
        c.client_name,
        c.owner_1_name,
        c.owner_2_name,
        c.client_phone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  })();
  // Cap the rendered list — the vault can hold thousands of clients and a
  // single unfiltered <div> of all of them would jank the dropdown.
  const visibleClients = filteredClients.slice(0, 50);

  const clientLabel = (c: ClientOption) => `${c.company_name} · ${c.client_name}`;

  // Pick a client from the combobox: sync state, show its label, close the
  // panel, and auto-load so the analyst doesn't need a second click.
  const selectClient = (c: ClientOption) => {
    setSelectedClientId(c.id);
    setClientSearch(clientLabel(c));
    setIsClientDropdownOpen(false);
    setClientHighlight(-1);
    loadClient(c.id);
  };

  // Keyboard nav for the combobox input.
  const onClientSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsClientDropdownOpen(true);
      setClientHighlight((i) => Math.min(i + 1, visibleClients.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setClientHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const pick = visibleClients[clientHighlight] ?? visibleClients[0];
      if (pick) {
        e.preventDefault();
        selectClient(pick);
      }
    } else if (e.key === "Escape") {
      setIsClientDropdownOpen(false);
      setClientHighlight(-1);
    }
  };

  // Active business row for any display reads that vary per-business
  // (e.g. avg annual revenue, avg monthly deposits in the Economic Data
  // sidebar). Falls back to the client_data_vault projection in clientList
  // for legacy/single-business clients where business_profiles isn't the
  // source of truth yet.
  const activeBusiness = businesses.find(b => b.id === selectedBusinessId) || null;
  const activeClient = clientList.find(c => c.id === selectedClientId);
  const activeAvgAnnualRevenue =
    activeBusiness?.avg_annual_revenue ?? activeClient?.avg_annual_revenue ?? 0;
  const activeAvgMonthlyDeposits =
    activeBusiness?.avg_monthly_deposits ?? activeClient?.avg_monthly_deposits ?? 0;

  // Derived averages across all accounts. Each account contributes only the
  // months inside its OWN effective window so a 5-month account doesn't
  // dilute a 6-month sibling with phantom empty cells (and vice-versa for
  // an extended account).
  const accountEffectiveIndices = accounts.map((a) =>
    computeMonthIndices(prevMonthIdx, a.monthRange ?? monthRange)
  );
  const activeMonthsForAllAccounts = accounts.flatMap((a, i) =>
    accountEffectiveIndices[i].map((mi) => a.months[mi])
  );

  const allDepositMonths = activeMonthsForAllAccounts.map((m) => m.totalDeposits);
  const avgRevenue = avgOfFilled(allDepositMonths);

  const allDailyBalanceMonths = activeMonthsForAllAccounts.map((m) => m.avgDailyBalance);
  const avgDailyBalanceAcrossAccounts = avgOfFilled(allDailyBalanceMonths);

  const allDepositCountMonths = activeMonthsForAllAccounts.map((m) => m.numDeposits);
  const avgMonthlyDepositsAcrossAccounts = avgOfIntegers(allDepositCountMonths);

  const totalNegDaysSum = accounts.reduce((sum, acc, i) => {
    return sum + accountEffectiveIndices[i].reduce(
      (mSum, mi) => mSum + (parseInt(acc.months[mi].negativeDays) || 0),
      0,
    );
  }, 0);
  const totalActiveMonthCells = accountEffectiveIndices.reduce(
    (s, arr) => s + arr.length,
    0,
  );
  const avgNegDaysAcrossAccounts = totalNegDaysSum / (totalActiveMonthCells || 1);

  // ── Export period availability ────────────────────────────────────────────
  // How many of the most-recent-12 months hold data in ANY account. Drives
  // which PDF presets are exportable: a preset N is available iff N months of
  // data exist (6 months of data → 3/4/6 enabled, 12 disabled).
  const last12Indices = computeMonthIndices(prevMonthIdx, 12);
  const availableMonths = accounts.reduce((max, a) => {
    const filled = last12Indices.filter((mi) => monthHasData(a.months[mi])).length;
    return Math.max(max, filled);
  }, 0);

  /** Build a self-contained period view (indices + per-window summary) for the
   *  PDF. Applied uniformly across all accounts — per-account on-screen range
   *  overrides are an editing convenience and don't affect the export window. */
  const buildPeriodView = (range: number) => {
    const indices = computeMonthIndices(prevMonthIdx, range);
    const monthsForAll = accounts.flatMap((a) => indices.map((mi) => a.months[mi]));
    const periodAvgRevenue = avgOfFilled(monthsForAll.map((m) => m.totalDeposits));
    const periodAvgDailyBalance = avgOfFilled(monthsForAll.map((m) => m.avgDailyBalance));
    const periodAvgMonthlyDeposits = avgOfIntegers(monthsForAll.map((m) => m.numDeposits));
    const periodTotalNegDays = accounts.reduce(
      (sum, a) =>
        sum + indices.reduce((mSum, mi) => mSum + (parseInt(a.months[mi].negativeDays) || 0), 0),
      0,
    );
    const cells = accounts.length * indices.length;
    const periodAvgNegDays = periodTotalNegDays / (cells || 1);
    return {
      monthRange: range,
      activeMonths: indices.map((mi) => MONTHS[mi].slice(0, 3)),
      activeMonthIndices: indices,
      avgRevenue: Number.isFinite(periodAvgRevenue) ? periodAvgRevenue : 0,
      avgDailyBalance: Number.isFinite(periodAvgDailyBalance) ? periodAvgDailyBalance : 0,
      avgMonthlyDeposits: Number.isFinite(periodAvgMonthlyDeposits) ? periodAvgMonthlyDeposits : 0,
      totalNegDays: periodTotalNegDays,
      avgNegDays: Number.isFinite(periodAvgNegDays) ? periodAvgNegDays : 0,
    };
  };

  /** Open the export dialog, pre-selecting sensible periods: the current
   *  on-screen range if it has data, otherwise the largest available preset. */
  const openExportDialog = () => {
    const usable = PERIOD_PRESETS.filter((n) => n <= availableMonths);
    let preselected: number[];
    if (usable.includes(monthRange)) {
      preselected = [monthRange];
    } else if (usable.length > 0) {
      preselected = [usable[usable.length - 1]];
    } else {
      // No window has enough data yet — fall back to the smallest preset so the
      // user can still export (cells just render "—").
      preselected = [PERIOD_PRESETS[0]];
    }
    setExportPeriods(preselected);
    setShowExportDialog(true);
  };

  const updateQ = (k: keyof QualifyingQuestions, v: string) =>
    setQuestions((q) => ({ ...q, [k]: v }));

  // ─── Save to Database ───────────────────────────────────────────────────────
  const saveAnalysis = async () => {
    if (!selectedClientId) {
      toast.error("Please select a client first.");
      return;
    }
    setIsSaving(true);
    // Inline loading toast — replaced by success/error below on resolve.
    const savingToastId = toast.loading("Saving bank analysis…");

    try {
      // Find client date to compute TIB months
      const client = clientList.find(c => c.id === selectedClientId);
      const tibMonths = client ? computeTIBMonths(client.business_start_date) : 0;

      // Coerce NaN (empty analysis) to 0 before sending to Postgres — NaN
      // is not valid for numeric columns.
      const safe = (n: number) => (Number.isFinite(n) ? n : 0);

      // Resolve the funding_deal_id to attach this snapshot to. Rule (see
      // funding_deals refactor design): latest non-funded deal under the
      // active business. If none exists (pre-funding stage or no deals
      // created yet), leave NULL — the snapshot is still pinned to a
      // business via business_profile_id which is enough for grouping.
      // For single-business clients with no business row at all (legacy
      // pre-backfill), both columns stay NULL.
      let fundingDealId: string | null = null;
      if (selectedBusinessId) {
        const { data: openDeal } = await supabase
          .from("funding_deals")
          .select("id")
          .eq("business_profile_id", selectedBusinessId)
          .is("funded_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        fundingDealId = openDeal?.id ?? null;
      }

      // Append-only: each save creates a NEW snapshot row. The history
      // side panel surfaces prior runs; loading a snapshot stamps
      // loadedSnapshotId so a subsequent save shows the relationship.
      const { data: inserted, error } = await supabase
        .from('bank_analysis_results')
        .insert({
          client_id: selectedClientId,
          business_profile_id: selectedBusinessId || null,
          funding_deal_id: fundingDealId,
          business_name: businessName,
          owner_name: ownerName,
          fico: parseInt(questions.ficoScore) || 0,
          tib_months: tibMonths || parseInt(questions.timeInBusiness) || 0,
          avg_revenue: safe(avgRevenue),
          avg_daily_balance: safe(avgDailyBalanceAcrossAccounts),
          avg_monthly_deposits: safe(avgMonthlyDepositsAcrossAccounts),
          total_neg_days: totalNegDaysSum,
          num_open_positions: positions.filter(p => p.funderLender || p.balance).length,
          has_bankruptcy: questions.bankruptcy.toLowerCase().includes("yes") || hasBankruptcy,
          capital_requested: capitalRequested || parseMoney(questions.capitalRequested),
          company_state: state,
          industry: industry,
          accounts_data: accounts,
          positions_data: positions,
          questions_data: questions,
        })
        .select("id")
        .single();

      if (error) {
        throw error;
      }
      if (inserted?.id) setLoadedSnapshotId(inserted.id);
      refreshHistory(
        selectedClientId,
        businesses.length > 1 && selectedBusinessId ? selectedBusinessId : undefined,
      );
      toast.success("Snapshot saved", {
        id: savingToastId,
        description: `${businessName || "Client"} · ${positions.filter(p => p.funderLender || p.balance).length} positions, ${accounts.length} account${accounts.length === 1 ? "" : "s"}`,
      });
    } catch (err: any) {
      console.error("Save error:", err);
      toast.error("Failed to save analysis", {
        id: savingToastId,
        description: err?.message ?? "Unknown error — check console for details.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Export to PDF ─────────────────────────────────────────────────────────
  const exportToPDF = async (selectedPeriods: number[]) => {
    setShowExportDialog(false);
    // Render the chosen windows ascending so the comparison + breakdown pages
    // read 3 → 4 → 6 → 12. Guard against an empty selection.
    const ranges = [...new Set(selectedPeriods)].sort((a, b) => a - b);
    const periodViews = (ranges.length > 0 ? ranges : [monthRange]).map(buildPeriodView);
    setIsExporting(true);
    try {
      // Dynamic import keeps @react-pdf/renderer's heavy client bundle out of
      // the initial page load — we only pay for it when someone clicks Export.
      const { pdf } = await import("@react-pdf/renderer");

      const selectedClient = clientList.find((c) => c.id === selectedClientId);
      const tibMonths = selectedClient ? computeTIBMonths(selectedClient.business_start_date) : 0;

      // Fetch the assigned team — lead advisor + followers — so the PDF shows
      // who's working this file. Non-fatal if any of these queries fail; the
      // Team card just gets omitted.
      let advisorName: string | undefined;
      let followerNames: string[] = [];
      if (selectedClientId) {
        try {
          const { data: vaultRow } = await supabase
            .from("client_data_vault")
            .select("advisor_id, advisor_name")
            .eq("id", selectedClientId)
            .maybeSingle();

          if (vaultRow?.advisor_id) {
            const { data: advisorRow } = await supabase
              .from("advisors")
              .select("first_name, last_name")
              .eq("id", vaultRow.advisor_id)
              .maybeSingle();
            if (advisorRow) {
              advisorName = `${advisorRow.first_name ?? ""} ${advisorRow.last_name ?? ""}`.trim();
            }
          }
          if (!advisorName && vaultRow?.advisor_name && vaultRow.advisor_name !== "Unknown") {
            advisorName = vaultRow.advisor_name;
          }

          const { data: followerRows } = await supabase
            .from("client_followers")
            .select("advisor_id, advisors:advisor_id(first_name, last_name)")
            .eq("client_vault_id", selectedClientId);

          followerNames = (followerRows ?? [])
            .map((r: any) => {
              const a = Array.isArray(r.advisors) ? r.advisors[0] : r.advisors;
              if (!a) return "";
              return `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
            })
            .filter((n: string) => n.length > 0);
        } catch (err) {
          console.error("Team lookup failed (non-fatal):", err);
        }
      }

      const pdfData: BankAnalysisPDFData = {
        businessName: businessName || "—",
        ownerName: ownerName || "",
        ownerName2,
        referredBy,
        phone,
        phone2,
        state,
        industry,
        avgRevenue: Number.isFinite(avgRevenue) ? avgRevenue : 0,
        avgDailyBalance: Number.isFinite(avgDailyBalanceAcrossAccounts)
          ? avgDailyBalanceAcrossAccounts
          : 0,
        avgMonthlyDeposits: Number.isFinite(avgMonthlyDepositsAcrossAccounts)
          ? avgMonthlyDepositsAcrossAccounts
          : 0,
        totalNegDays: totalNegDaysSum,
        avgNegDays: Number.isFinite(avgNegDaysAcrossAccounts) ? avgNegDaysAcrossAccounts : 0,
        numOpenPositions: positions.filter(p => p.funderLender || p.balance).length,
        capitalRequested: capitalRequested || parseMoney(questions.capitalRequested) || 0,
        fico: parseInt(questions.ficoScore) || 0,
        tibMonths: tibMonths || parseInt(questions.timeInBusiness) || 0,
        businessStartDate: selectedClient?.business_start_date || undefined,
        hasBankruptcy: questions.bankruptcy.toLowerCase().includes("yes") || hasBankruptcy,
        // Legacy single-window fields — kept as a fallback; the PDF prefers
        // `periods` below when present.
        monthRange,
        activeMonths: activeMonthIndices.map((mi) => MONTHS[mi].slice(0, 3)),
        activeMonthIndices,
        periods: periodViews,
        accounts,
        positions,
        questions: { ...questions } as Record<string, string>,
        advisorName,
        followers: followerNames,
        generatedAt: new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      };

      const blob = await pdf(<BankAnalysisPDF data={pdfData} />).toBlob();

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = (businessName || "bank-analysis")
        .replace(/[^a-z0-9\-_]+/gi, "_")
        .slice(0, 60);
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${safeName}_bank-analysis_${stamp}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("PDF exported", { description: a.download });
    } catch (err: any) {
      console.error("PDF export error:", err);
      toast.error("Failed to export PDF", {
        description: err?.message ?? "Unknown error — check console for details.",
      });
    } finally {
      setIsExporting(false);
    }
  };


  const TABS = [
    { id: "analysis" as const, label: "Bank Analysis" },
    { id: "positions" as const, label: "Open Positions" },
  ];

  return (
    <div className="min-h-screen bg-cb-cream text-cb-ink">
      {/* Top bar */}
      <div className="border-b border-slate-200 bg-white">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            <span className="text-sm font-bold tracking-[0.1em] uppercase text-slate-900">
              Credit Banc
            </span>
            <span className="text-slate-400 text-sm">/</span>
            <span className="text-sm text-slate-500">Bank Analysis</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-4">
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Avg Revenue</span>
                <span className="text-sm font-mono font-bold text-emerald-600 ml-1">{formatMoney(avgRevenue)}</span>
              </div>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Avg Daily Bal</span>
                <span className="text-sm font-mono font-bold text-emerald-600 ml-1">{formatMoney(avgDailyBalanceAcrossAccounts)}</span>
              </div>
            </div>
            {/* Moved Save Analysis to the bottom */}
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-6 flex gap-6 items-start">
        {/* Left column — main workspace. min-w-0 lets the inner tables
            shrink/scroll horizontally without pushing the side panel off-screen. */}
        <div className="flex-1 min-w-0 space-y-0">

        {/* ── Client Selection ── */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-600">Load Client Data</span>
            {loadedClientName && (
              <span className="ml-auto text-[10px] text-emerald-600 font-mono">✓ Loaded: {loadedClientName}</span>
            )}
          </div>
          <div className="flex gap-2">
            {/* Client combobox — single search field with an inline results
                panel. Typing filters live; arrow keys + Enter navigate; clicking
                a result selects AND auto-loads it. */}
            <div className="relative flex-1">
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input
                type="text"
                value={clientSearch}
                onChange={e => {
                  setClientSearch(e.target.value);
                  setIsClientDropdownOpen(true);
                  setClientHighlight(-1);
                  // Editing the text invalidates a prior pick so a stale id
                  // can't be loaded via the button.
                  if (selectedClientId) setSelectedClientId("");
                }}
                onFocus={() => setIsClientDropdownOpen(true)}
                onBlur={() => {
                  // Delay so an onMouseDown selection on a result registers
                  // before the panel unmounts.
                  setTimeout(() => setIsClientDropdownOpen(false), 120);
                }}
                onKeyDown={onClientSearchKeyDown}
                placeholder="Search by company, client, owner or phone..."
                role="combobox"
                aria-expanded={isClientDropdownOpen}
                aria-autocomplete="list"
                className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 pl-8 pr-7 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-colors"
              />
              {clientSearch && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setClientSearch("");
                    setSelectedClientId("");
                    setClientHighlight(-1);
                    setIsClientDropdownOpen(true);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  title="Clear search"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              )}

              {isClientDropdownOpen && (
                <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
                  {visibleClients.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-slate-400 font-mono">
                      {clientList.length === 0 ? "Loading clients…" : "No matches"}
                    </div>
                  ) : (
                    <>
                      {visibleClients.map((c, idx) => {
                        const isHi = idx === clientHighlight;
                        const isSel = c.id === selectedClientId;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            // onMouseDown (not onClick) so the selection fires
                            // before the input's onBlur closes the panel.
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectClient(c);
                            }}
                            onMouseEnter={() => setClientHighlight(idx)}
                            className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                              isHi ? "bg-emerald-50" : "hover:bg-slate-50"
                            } ${isSel ? "border-l-2 border-emerald-500" : "border-l-2 border-transparent"}`}
                          >
                            <span className="text-sm font-medium text-slate-800 truncate w-full">
                              {c.company_name || "(No company)"}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono truncate w-full">
                              {[c.client_name, c.client_phone].filter(Boolean).join(" · ")}
                            </span>
                          </button>
                        );
                      })}
                      {filteredClients.length > visibleClients.length && (
                        <div className="px-3 py-2 text-[10px] text-slate-400 font-mono border-t border-slate-100">
                          +{filteredClients.length - visibleClients.length} more — keep typing to narrow
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => loadClient()}
              disabled={!selectedClientId || isLoading}
              className="px-4 py-1.5 rounded text-xs font-bold tracking-wider uppercase bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors whitespace-nowrap"
            >
              {isLoading ? "Loading..." : "Load →"}
            </button>
          </div>
        </div>

        {/* ── Business Picker ──
            Only renders for the ~1% of clients with >1 business. The 99%
            single-business case never sees this control — the lone business
            is auto-selected by loadClient and the screen looks identical
            to pre-multi-business. Switching businesses re-scopes the
            snapshot, history, positions, and prefill via
            loadBusinessScopedData. */}
        {businesses.length > 1 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-amber-600">
                Business · {businesses.length} on file
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {businesses.map((b) => {
                const label = b.company_name || b.business_name || "(Unnamed business)";
                const isActive = b.id === selectedBusinessId;
                return (
                  <button
                    key={b.id}
                    onClick={async () => {
                      if (isActive || isLoading) return;
                      const client = clientList.find(c => c.id === selectedClientId);
                      if (!client) return;
                      setIsLoading(true);
                      setSelectedBusinessId(b.id);
                      await loadBusinessScopedData(b, client, businesses, selectedClientId);
                    }}
                    disabled={isLoading}
                    className={
                      "px-3 py-1.5 rounded text-xs font-mono border transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
                      (isActive
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "bg-slate-50 border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600")
                    }
                    title={b.is_primary ? "Primary business" : undefined}
                  >
                    {b.is_primary && <span className="opacity-60 mr-1">★</span>}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Business & Financial Information */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 mb-6 shadow-xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Left Column: Business Details */}
            <div className="lg:col-span-8 space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-6 bg-emerald-500 rounded-full" />
                  <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-slate-900">Business & Contact Details</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { label: "Business DBA Name", value: businessName, onChange: setBusinessName },
                    { label: "Owner Name", value: ownerName, onChange: setOwnerName },
                    { label: "Phone Number", value: phone, onChange: setPhone },
                    { label: "Owner Name 2", value: ownerName2, onChange: setOwnerName2 },
                    { label: "Phone Number 2", value: phone2, onChange: setPhone2 },
                    { label: "Referred By", value: referredBy, onChange: setReferredBy },
                  ].map((f) => (
                    <div key={f.label}>
                      <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1.5">{f.label}</label>
                      <TextInput value={f.value} onChange={f.onChange} placeholder={f.label} className="!bg-slate-50/50" />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-6 bg-amber-500 rounded-full" />
                  <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-slate-900">Underwriting Profile</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1.5">Capital Requested</label>
                    <TextInput value={questions.capitalRequested} onChange={v => updateQ("capitalRequested", v)} placeholder="$0" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1.5">FICO Score</label>
                    <TextInput value={questions.ficoScore} onChange={v => updateQ("ficoScore", v)} placeholder="e.g. 700+" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1.5">Business Start Date (TIB)</label>
                    <TextInput value={questions.timeInBusiness} onChange={v => updateQ("timeInBusiness", v)} placeholder="Full date..." />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1.5"># of Owners</label>
                    <TextInput value={questions.numOwners} onChange={v => updateQ("numOwners", v)} placeholder="e.g. 1" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1.5">Entity Type</label>
                    <TextInput value={questions.businessType} onChange={v => updateQ("businessType", v)} placeholder="LLC, Corp..." />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1.5">Industry</label>
                    <NaicsCombobox value={industry} onChange={(val) => setIndustry(val)} placeholder="Select NAICS industry…" triggerClassName="text-sm" />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1.5">Proposed Loan Type</label>
                    <div className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-sm text-slate-900 min-h-[30px] flex items-center">
                      {clientList.find(c => c.id === selectedClientId)?.proposed_loan_type || "—"}
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1.5">Bankruptcy History</label>
                    <TextInput value={questions.bankruptcy} onChange={v => updateQ("bankruptcy", v)} placeholder="No..." />
                  </div>
                  <div>
                    <label className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1.5">Default History</label>
                    <TextInput value={questions.modifiedOrDefaulted} onChange={v => updateQ("modifiedOrDefaulted", v)} placeholder="None..." />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Economic Summary */}
            <div className="lg:col-span-4 lg:border-l lg:border-slate-200 lg:pl-6">
              <div className="sticky top-4 space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-6 bg-emerald-500 rounded-full" />
                  <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-slate-900">Economic Data</h3>
                </div>

                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-emerald-500/30 transition-colors">
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1">Avg Annual Revenue (Vault)</span>
                    <span className="text-xl font-mono font-bold text-slate-700">
                      {activeAvgAnnualRevenue ? formatMoney(activeAvgAnnualRevenue) : "—"}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-emerald-500/30 transition-colors">
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1">Avg Monthly Revenue (Analysis/Vault)</span>
                    <span className="text-xl font-mono font-bold text-emerald-600">
                      {avgRevenue > 0 ? formatMoney(avgRevenue) : (activeAvgMonthlyDeposits ? formatMoney(activeAvgMonthlyDeposits) : "—")}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-emerald-500/30 transition-colors">
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1">Avg Daily Balance</span>
                    <span className="text-xl font-mono font-bold text-emerald-600">{formatMoney(avgDailyBalanceAcrossAccounts)}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-amber-500/30 transition-colors">
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1">Avg Monthly Deposits</span>
                    <span className="text-xl font-mono font-bold text-amber-600">{avgMonthlyDepositsAcrossAccounts.toFixed(1)}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 hover:border-rose-500/30 transition-colors">
                    <span className="text-[9px] text-slate-500 uppercase tracking-widest block mb-1">Total Negative Days</span>
                    <span className={`text-xl font-mono font-bold ${totalNegDaysSum > 0 ? "text-rose-600" : "text-slate-500"}`}>
                      {totalNegDaysSum.toString()}
                    </span>
                  </div>
                </div>

                <div className="pt-2">
                  <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-widest mb-1 px-1">
                    <span>State (Override)</span>
                    <span className="font-mono text-slate-700">{state || "N/A"}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-slate-200 pb-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-xs font-medium tracking-wider uppercase transition-all border-b-2 -mb-px ${activeTab === tab.id
                ? "text-emerald-500 border-emerald-500"
                : "text-slate-500 border-transparent hover:text-slate-700"
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab: Bank Analysis */}
        {activeTab === "analysis" && (
          <div>
            {/* Month range selector */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Range:</span>
              {([3, 4, 6, 12] as const).map(n => (
                <button
                  key={n}
                  onClick={() => {
                    // Clicking a global preset re-syncs every account back to
                    // the global window, blowing away per-account overrides.
                    setMonthRange(n);
                    setAccounts((prev) => prev.map((a) => ({ ...a, monthRange: undefined })));
                  }}
                  className={`px-3 py-1 rounded text-xs font-mono font-bold tracking-wider transition-all ${monthRange === n
                    ? "bg-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                    : "bg-slate-50 text-slate-500 border border-slate-200 hover:border-emerald-500/40 hover:text-slate-700"
                    }`}
                >
                  {n} Mo
                </button>
              ))}
              <span className="text-[10px] text-slate-400 font-mono ml-1">
                {MONTHS[activeMonthIndices[0]].slice(0, 3)} → {MONTHS[activeMonthIndices[activeMonthIndices.length - 1]].slice(0, 3)}
              </span>
            </div>

            {accounts.map((account, i) => (
              <AccountBlock
                key={i}
                account={account}
                index={i}
                onChange={(a) => setAccounts(accounts.map((ac, ai) => (ai === i ? a : ac)))}
                onRemove={() => setAccounts(accounts.filter((_, ai) => ai !== i))}
                canRemove={accounts.length > 1}
                prevMonthIdx={prevMonthIdx}
                globalRange={monthRange}
              />
            ))}
            <button
              onClick={() => setAccounts([...accounts, emptyAccount()])}
              className="w-full rounded-xl border border-dashed border-slate-200 hover:border-emerald-500/50 py-3 text-xs text-slate-500 hover:text-emerald-500 transition-all font-mono tracking-wider uppercase"
            >
              + Add Bank Account
            </button>
          </div>
        )}

        {/* Tab: Open Positions */}
        {activeTab === "positions" && (
          <OpenPositions positions={positions} avgRevenue={avgRevenue} onChange={setPositions} />
        )}


        {/* Final Actions */}
        <div className="mt-12 flex justify-end gap-3">
          <button
            onClick={openExportDialog}
            disabled={isExporting}
            className="flex items-center justify-center gap-3 px-8 py-4 font-bold text-slate-900 bg-slate-200 hover:bg-slate-300 border border-slate-300/40 rounded-2xl text-xs uppercase tracking-[0.2em] shadow-2xl shadow-black/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 group"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Building PDF...</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                <span>Export PDF</span>
              </>
            )}
          </button>

          <button
            onClick={saveAnalysis}
            disabled={isSaving || !selectedClientId}
            title="Each save appends a new snapshot to the history — prior runs stay browsable in the panel on the right."
            className="flex items-center justify-center gap-3 px-10 py-4 font-bold text-white bg-emerald-600 hover:bg-emerald-700 border border-emerald-600/50 rounded-2xl text-xs uppercase tracking-[0.2em] shadow-2xl shadow-emerald-600/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 group"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Saving Analysis...</span>
              </>
            ) : (
              <>
                <span>Save Analysis</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
              </>
            )}
          </button>
        </div>

        {/* ── PDF export period picker ─────────────────────────────────────
            Pick one or more lookback windows to render. Presets are gated on
            how many months of data the file actually holds (availableMonths):
            6 months of data → 3/4/6 enabled, 12 disabled. The PDF gets one
            Account Breakdown page per ticked window plus a comparison table. */}
        {showExportDialog && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowExportDialog(false)}
          >
            <div
              className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-5 pb-4 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Export PDF — Select Periods</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {availableMonths > 0
                    ? `This file has data for up to ${availableMonths} month${availableMonths === 1 ? "" : "s"}. Pick the lookback windows to include — each becomes its own page with all bank accounts.`
                    : "No statement data entered yet. Only the shortest window is available."}
                </p>
              </div>

              <div className="px-6 py-5 grid grid-cols-2 gap-3">
                {PERIOD_PRESETS.map((n) => {
                  // Always allow the smallest preset so there's something to export.
                  const enabled = n <= availableMonths || n === PERIOD_PRESETS[0];
                  const checked = exportPeriods.includes(n);
                  return (
                    <button
                      key={n}
                      type="button"
                      disabled={!enabled}
                      onClick={() =>
                        setExportPeriods((prev) =>
                          prev.includes(n) ? prev.filter((p) => p !== n) : [...prev, n],
                        )
                      }
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-mono font-bold tracking-wider transition-all ${
                        !enabled
                          ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
                          : checked
                            ? "border-emerald-500 bg-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                            : "border-slate-200 bg-white text-slate-600 hover:border-emerald-500/50"
                      }`}
                      title={enabled ? "" : `Needs ${n} months of data`}
                    >
                      <span>{n} Months</span>
                      {checked && enabled && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="px-6 pb-5 pt-1 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowExportDialog(false)}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={exportPeriods.length === 0}
                  onClick={() => exportToPDF(exportPeriods)}
                  className="px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 transition-all"
                >
                  Export {exportPeriods.length > 0 ? `(${exportPeriods.length})` : ""}
                </button>
              </div>
            </div>
          </div>
        )}

        </div>{/* ── /Left column ── */}

        {/* ── History side panel ──────────────────────────────────────────
            Shows every saved snapshot for the loaded client. Each save
            appends a new row (no more upsert-on-client_id), so the analyst
            can scroll back through prior runs, click to re-hydrate the
            workspace, and delete throwaway versions. Auto-hides until a
            client is loaded — empty panel adds noise. */}
        {selectedClientId && (
          <aside className={`flex-shrink-0 transition-all ${isHistoryOpen ? "w-72" : "w-10"}`}>
            <div className="sticky top-6 rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 bg-slate-50">
                {isHistoryOpen ? (
                  <>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-emerald-600 truncate">
                        History · {history.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsHistoryOpen(false)}
                      title="Collapse history panel"
                      className="text-slate-500 hover:text-slate-700 text-xs px-1 leading-none transition-colors"
                    >
                      ›
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsHistoryOpen(true)}
                    title="Expand history panel"
                    className="w-full text-center text-[10px] font-bold tracking-widest uppercase text-emerald-600 hover:text-emerald-500 transition-colors"
                  >
                    ‹
                  </button>
                )}
              </div>

              {isHistoryOpen && (
                <div className="max-h-[calc(100vh-200px)] overflow-y-auto p-2 space-y-1.5">
                  {history.length === 0 ? (
                    <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider text-center py-6">
                      No snapshots yet.<br />Click <span className="text-emerald-600">Save</span> to create one.
                    </p>
                  ) : (
                    history.map((snap, i) => {
                      const isCurrent = snap.id === loadedSnapshotId;
                      const created = new Date(snap.created_at);
                      const dateStr = created.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                      const timeStr = created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                      return (
                        <div
                          key={snap.id}
                          className={`group rounded-lg border px-2.5 py-2 cursor-pointer transition-all ${
                            isCurrent
                              ? "bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.3)]"
                              : "bg-slate-50 border-slate-200 hover:border-emerald-500/40 hover:bg-slate-50"
                          }`}
                          onClick={() => loadSnapshot(snap.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-mono font-bold tracking-wider ${isCurrent ? "text-emerald-500" : "text-slate-700"}`}>
                              {dateStr} · {timeStr}
                            </span>
                            <span className={`text-[9px] font-mono ${isCurrent ? "text-emerald-500" : "text-slate-400"}`}>
                              v{history.length - i}
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] font-mono text-slate-500 truncate">
                            {snap.business_name || "—"}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[9px] font-mono text-slate-400">
                            <span>Rev {formatMoney(Number(snap.avg_revenue) || 0)}</span>
                            <span>·</span>
                            <span>{snap.num_open_positions ?? 0} pos</span>
                            <span>·</span>
                            <span>{snap.total_neg_days ?? 0} neg</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSnapshot(snap.id);
                            }}
                            title="Delete snapshot"
                            className="opacity-0 group-hover:opacity-100 mt-1 text-[9px] font-mono uppercase tracking-wider text-slate-400 hover:text-rose-600 transition-all"
                          >
                            delete
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </aside>
        )}

      </div>
    </div>
  );
}