"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import LenderMatch from "./lender-match";
import { createClient } from "@/lib/supabase/client";
import BankAnalysisPDF, { type BankAnalysisPDFData } from "./pdf/bank-analysis-pdf";
import { LOAN_TYPES } from "@/data/loan-types";
import { toast } from "sonner";

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
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-right text-sm font-mono text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#388bfd] focus:ring-1 focus:ring-[#388bfd]/30 transition-colors ${className}`}
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
      className={`w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-sm text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#388bfd] focus:ring-1 focus:ring-[#388bfd]/30 transition-colors ${className}`}
    />
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-[10px] text-[#8b949e] uppercase tracking-wider whitespace-nowrap">{label}</span>
      <span className="text-sm font-mono font-semibold text-[#58a6ff]">{value}</span>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-px flex-1 bg-gradient-to-r from-[#30363d] to-transparent" />
      <span className="text-xs font-bold tracking-[0.2em] uppercase text-[#8b949e] whitespace-nowrap px-2">
        {children}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-[#30363d] to-transparent" />
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
  activeMonthIndices = [1, 0, 11],
}: {
  account: AccountData;
  index: number;
  onChange: (a: AccountData) => void;
  onRemove: () => void;
  canRemove: boolean;
  activeMonthIndices?: number[];
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
    <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden mb-6">
      {/* Account header */}
      <div className="flex items-center gap-4 px-4 py-3 bg-[#1c2128] border-b border-[#30363d]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8b949e] font-mono uppercase tracking-wider">Account {index + 1}</span>
          <div className="w-px h-4 bg-[#30363d]" />
          <TextInput
            value={account.accountNumber}
            onChange={(v) => onChange({ ...account, accountNumber: v })}
            placeholder="Account No."
            className="w-40"
          />
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
            className="ml-2 text-[#8b949e] hover:text-[#f85149] transition-colors text-xs font-mono border border-[#30363d] hover:border-[#f85149]/40 rounded px-2 py-1"
          >
            Remove
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#30363d]">
              <th className="text-left px-4 py-2 text-[#8b949e] font-medium w-36 sticky left-0 bg-[#161b22] z-10">
                Field
              </th>
              {activeMonthIndices.map((mi) => (
                <th key={mi} className="text-center px-2 py-2 text-[#8b949e] font-medium min-w-[100px]">
                  {MONTHS[mi].slice(0, 3)}
                </th>
              ))}
              <th className="text-center px-3 py-2 text-[#388bfd] font-semibold min-w-[110px] bg-[#1c2128]">
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
                  className={`border-b border-[#21262d] ${ri % 2 === 0 ? "bg-[#161b22]" : "bg-[#13191f]"} hover:bg-[#1f2937]/30 transition-colors`}
                >
                  <td className="px-4 py-1.5 text-[#c9d1d9] font-medium sticky left-0 z-10 whitespace-nowrap"
                    style={{ background: ri % 2 === 0 ? "#161b22" : "#13191f" }}>
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
                  <td className="px-3 py-1 text-center bg-[#1c2128] font-mono font-semibold text-[#58a6ff]">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border-t border-[#21262d] bg-[#13191f]">
        {account.notes.map((note, ni) => (
          <div key={ni}>
            <label className="text-[10px] text-[#8b949e] uppercase tracking-wider block mb-1">Note {ni + 1}</label>
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
    <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
      <div className="px-4 py-3 bg-[#1c2128] border-b border-[#30363d] flex items-center justify-between flex-wrap gap-3">
        <span className="text-xs font-bold tracking-[0.15em] uppercase text-[#8b949e]">Open Positions</span>
        <div className="flex items-center gap-6 flex-wrap">
          <StatCell label="Current Monthly Remit" value={formatMoney(totalRemit)} />
          <StatCell label="Used Remit %" value={formatPct(usedRemitPct)} />
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[10px] text-[#8b949e] uppercase tracking-wider">Available Remit (20%)</span>
            <span className={`text-sm font-mono font-semibold ${availableRemit >= 0 ? "text-[#3fb950]" : "text-[#f85149]"}`}>
              {formatMoney(availableRemit)}
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#30363d]">
              {["Funder / Lender", "Loan Type", "Payment Type", "Amount", "Balance", "Term", "Remit % (derived)", "Monthly Remit", "Actions"].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-[#8b949e] font-medium whitespace-nowrap">
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
                  ? "text-[#f85149]"
                  : metrics.dataQualityFlag === "high"
                    ? "text-[#f0883e]"
                    : "text-[#3fb950]";
              return (
              <tr key={i} className="border-b border-[#21262d] hover:bg-[#1f2937]/20">
                <td className="px-2 py-1.5">
                  <TextInput value={pos.funderLender} onChange={(v) => updatePosition(i, "funderLender", v)} placeholder="Funder name..." />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={pos.loanType}
                    onChange={(e) => updatePosition(i, "loanType", e.target.value)}
                    className="w-full bg-transparent border-none outline-none text-xs text-[#e6edf3] font-mono focus:ring-0 cursor-pointer"
                  >
                    <option value="" className="bg-[#161b22]">—</option>
                    {pos.loanType && !LOAN_TYPES.includes(pos.loanType) && (
                      <option key={pos.loanType} value={pos.loanType} className="bg-[#161b22]">
                        {pos.loanType} (legacy)
                      </option>
                    )}
                    {LOAN_TYPES.map((t) => (
                      <option key={t} value={t} className="bg-[#161b22]">{t}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={pos.frequency}
                    onChange={(e) => updatePosition(i, "frequency", e.target.value)}
                    className="w-full bg-transparent border-none outline-none text-xs text-[#e6edf3] font-mono focus:ring-0 cursor-pointer"
                  >
                    <option value="" className="bg-[#161b22]">—</option>
                    {pos.frequency && !PAYMENT_FREQUENCIES.includes(pos.frequency) && (
                      <option key={pos.frequency} value={pos.frequency} className="bg-[#161b22]">
                        {pos.frequency} (legacy)
                      </option>
                    )}
                    {PAYMENT_FREQUENCIES.map((f) => (
                      <option key={f} value={f} className="bg-[#161b22]">{f}</option>
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
                  <div className={`text-sm font-mono font-semibold ${derivedPctLabel ? qualityColor : "text-[#484f58]"}`}>
                    {derivedPctLabel ?? "—"}
                  </div>
                  {metrics.dataQualityFlag === "high" && (
                    <div className="text-[9px] font-mono text-[#f0883e] mt-0.5 opacity-80">review</div>
                  )}
                  {metrics.dataQualityFlag === "impossible" && (
                    <div className="text-[9px] font-mono text-[#f85149] mt-0.5 opacity-80">review inputs</div>
                  )}
                </td>
                <td className="px-2 py-1.5 w-28">
                  <div className={`text-sm font-mono font-semibold ${
                    metrics.dataQualityFlag === "impossible" ? "text-[#f85149]" :
                    metrics.dataQualityFlag === "high" ? "text-[#f0883e]" :
                    Number.isFinite(metrics.monthlyRemit) ? "text-[#e6edf3]" : "text-[#484f58]"
                  }`}>
                    {Number.isFinite(metrics.monthlyRemit) ? formatMoney(metrics.monthlyRemit) : "—"}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <button
                    onClick={() => onChange(positions.filter((_, pi) => pi !== i))}
                    className="text-[#f85149] hover:text-[#ff7b72] text-[10px] font-mono border border-[#f85149]/30 hover:border-[#f85149]/60 rounded px-2 py-0.5 transition-colors"
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

      <div className="px-4 py-2 border-t border-[#21262d]">
        <button
          onClick={() => onChange([...positions, emptyPosition()])}
          className="text-xs text-[#58a6ff] hover:text-[#79c0ff] font-mono border border-[#388bfd]/30 hover:border-[#388bfd]/60 rounded px-3 py-1 transition-colors"
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

export default function BankAnalysis() {
  const supabase = createClient();
  const searchParams = useSearchParams();

  // ── Client loader state ───────────────────────────────────────────────────
  // The page accepts ?client=<id> so deep-links from the client detail view
  // (admin/UW "View Bank Analysis" button) auto-load the saved analysis
  // without forcing the user to scroll the dropdown.
  const initial_client_id = searchParams?.get("client") ?? "";
  const [clientList, setClientList] = useState<ClientOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(initial_client_id);
  const [loadedClientName, setLoadedClientName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

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
  const [monthRange, setMonthRange] = useState<3 | 6 | 8 | 12>(3);

  // Always count backwards from previous month
  // e.g. current=March(2), previous=February(1), 3 months: [Dec(11), Jan(0), Feb(1)]
  const prevMonthIdx = (new Date().getMonth() - 1 + 12) % 12;
  const activeMonthIndices = Array.from({ length: monthRange }, (_, i) =>
    (prevMonthIdx - monthRange + 1 + i + 12) % 12
  );

  // ── Fetch clients on mount ────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .from("client_data_vault")
      .select("id, client_name, company_name, client_phone, owner_1_name, owner_2_name, capital_requested, credit_score, business_start_date, legal_entity_type, num_owners:number_of_owners, company_state, industry, avg_monthly_deposits, avg_annual_revenue, proposed_loan_type")
      .order("client_name", { ascending: true })
      .then(({ data }) => {
        if (data) setClientList(data as ClientOption[]);
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
  async function loadClient() {
    if (!selectedClientId) return;
    setIsLoading(true);
    const client = clientList.find(c => c.id === selectedClientId);
    if (!client) { setIsLoading(false); return; }

    setBusinessName(client.company_name || "");
    setOwnerName(client.owner_1_name || client.client_name || "");
    setOwnerName2(client.owner_2_name || "");
    setPhone(client.client_phone || "");
    setState(client.company_state || "");
    setIndustry(client.industry || "");

    setQuestions(q => ({
      ...q,
      businessType: client.legal_entity_type || "",
      capitalRequested: client.capital_requested ? `$${client.capital_requested.toLocaleString()}` : "",
      numOwners: client.num_owners || "",
      timeInBusiness: formatFullDate(client.business_start_date),
      ficoScore: client.credit_score || "",
    }));
    setLoadedClientName(`${client.client_name} — ${client.company_name}`);

    // Fetch state and industry from client_data_vault
    const { data: profile } = await supabase
      .from("client_data_vault")
      .select("company_state, industry, avg_monthly_deposits")
      .eq("id", selectedClientId)
      .single();

    if (profile) {
      setState(profile.company_state || "");
      setIndustry(profile.industry || "");
    }

    // 1. Attempt to fetch saved bank analysis state (the underwriter's workspace)
    const { data: analysis } = await supabase
      .from("bank_analysis_results")
      .select("*")
      .eq("client_id", selectedClientId)
      .single();

    let savedPositions: OpenPosition[] = [];
    if (analysis) {
      if (analysis.accounts_data) setAccounts(analysis.accounts_data);
      if (analysis.positions_data) savedPositions = analysis.positions_data;
      if (analysis.questions_data) setQuestions(analysis.questions_data);
      if (typeof analysis.has_bankruptcy === 'boolean') setHasBankruptcy(analysis.has_bankruptcy);
    } else {
      setAccounts([emptyAccount()]);
      setHasBankruptcy(false);
    }

    // 2. Fetch the "ground truth" from Client Vault (submitted positions)
    const { data: dbPositions } = await supabase
      .from("client_open_positions")
      .select("*")
      .eq("client_vault_id", selectedClientId)
      .order("position_number", { ascending: true });

    if (dbPositions && dbPositions.length > 0) {
      const mappedPositions = dbPositions.map(p => {
        // Look for matching position in saved analysis to preserve underwriter-only fields
        const saved = savedPositions.find(sp => sp.funderLender === p.lender_name);
        return {
          funderLender: p.lender_name,
          // Loan product type (MCA / Term Loan / LOC / etc.) — comes from the
          // client signup and lives on client_open_positions.loan_type.
          loanType: saved?.loanType || p.loan_type || "",
          // Payment cadence (Daily / Weekly / Monthly) — underwriter-only field,
          // stored in positions_data on bank_analysis_results.
          frequency: saved?.frequency || "",
          numDebits: saved?.numDebits || "0",
          amount: p.payment_amount?.toString() || "",
          balance: p.current_balance?.toString() || "",
          term: p.payment_term || "",
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

  const filteredClients = clientSearch.trim()
    ? clientList.filter(c =>
      c.client_name.toLowerCase().includes(clientSearch.toLowerCase()) ||
      c.company_name.toLowerCase().includes(clientSearch.toLowerCase())
    )
    : clientList;

  // Derived averages across all accounts (filtered by activeMonthIndices)
  const activeMonthsForAllAccounts = accounts.flatMap(a => activeMonthIndices.map(mi => a.months[mi]));

  const allDepositMonths = activeMonthsForAllAccounts.map((m) => m.totalDeposits);
  const avgRevenue = avgOfFilled(allDepositMonths);

  const allDailyBalanceMonths = activeMonthsForAllAccounts.map((m) => m.avgDailyBalance);
  const avgDailyBalanceAcrossAccounts = avgOfFilled(allDailyBalanceMonths);

  const allDepositCountMonths = activeMonthsForAllAccounts.map((m) => m.numDeposits);
  const avgMonthlyDepositsAcrossAccounts = avgOfIntegers(allDepositCountMonths);

  const totalNegDaysSum = accounts.reduce((sum, acc) => {
    return sum + activeMonthIndices.reduce((mSum, mi) => mSum + (parseInt(acc.months[mi].negativeDays) || 0), 0);
  }, 0);
  const avgNegDaysAcrossAccounts = totalNegDaysSum / (monthRange || 1);

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

      const { error } = await supabase.from('bank_analysis_results').upsert({
        client_id: selectedClientId,
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
        company_state: state,    // ← NEW — snapshot from client vault / override field
        industry: industry,      // ← NEW — snapshot from client vault / override field
        accounts_data: accounts,
        positions_data: positions,
        questions_data: questions
      }, { onConflict: 'client_id' });

      if (error) {
        throw error;
      }
      toast.success("Analysis saved", {
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
  const exportToPDF = async () => {
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
        monthRange,
        activeMonths: activeMonthIndices.map((mi) => MONTHS[mi].slice(0, 3)),
        activeMonthIndices,
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
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3]" style={{ fontFamily: "'IBM Plex Mono', 'Fira Code', monospace" }}>
      {/* Top bar */}
      <div className="border-b border-[#30363d] bg-[#161b22]">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#388bfd] shadow-[0_0_8px_#388bfd]" />
            <span className="text-sm font-bold tracking-[0.1em] uppercase text-[#e6edf3]">
              Credit Banc
            </span>
            <span className="text-[#484f58] text-sm">/</span>
            <span className="text-sm text-[#8b949e]">Bank Analysis</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-4">
              <div className="flex items-center gap-2 bg-[#1c2128] border border-[#30363d] rounded-lg px-3 py-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
                <span className="text-[10px] text-[#8b949e] uppercase tracking-wider">Avg Revenue</span>
                <span className="text-sm font-mono font-bold text-[#3fb950] ml-1">{formatMoney(avgRevenue)}</span>
              </div>
              <div className="flex items-center gap-2 bg-[#1c2128] border border-[#30363d] rounded-lg px-3 py-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[#388bfd]" />
                <span className="text-[10px] text-[#8b949e] uppercase tracking-wider">Avg Daily Bal</span>
                <span className="text-sm font-mono font-bold text-[#388bfd] ml-1">{formatMoney(avgDailyBalanceAcrossAccounts)}</span>
              </div>
            </div>
            {/* Moved Save Analysis to the bottom */}
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-6">

        {/* ── Client Selection ── */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-[#388bfd]" />
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-[#388bfd]">Load Client Data</span>
            {loadedClientName && (
              <span className="ml-auto text-[10px] text-[#3fb950] font-mono">✓ Loaded: {loadedClientName}</span>
            )}
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#484f58]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input
                type="text"
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Search client name or company..."
                className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 pl-8 text-sm text-[#e6edf3] placeholder-[#484f58] focus:outline-none focus:border-[#388bfd] transition-colors"
              />
            </div>
            <select
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
              className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 text-sm text-[#e6edf3] focus:outline-none focus:border-[#388bfd] transition-colors font-mono"
            >
              <option value="">— Select client —</option>
              {filteredClients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.client_name} · {c.company_name}
                </option>
              ))}
            </select>
            <button
              onClick={loadClient}
              disabled={!selectedClientId || isLoading}
              className="px-4 py-1.5 rounded text-xs font-bold tracking-wider uppercase bg-[#388bfd] hover:bg-[#58a6ff] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors whitespace-nowrap"
            >
              {isLoading ? "Loading..." : "Load →"}
            </button>
          </div>
        </div>

        {/* Business & Financial Information */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 mb-6 shadow-xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Left Column: Business Details */}
            <div className="lg:col-span-8 space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-6 bg-[#388bfd] rounded-full" />
                  <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-[#e6edf3]">Business & Contact Details</h3>
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
                      <label className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1.5">{f.label}</label>
                      <TextInput value={f.value} onChange={f.onChange} placeholder={f.label} className="!bg-[#0d1117]/50" />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-6 bg-[#d29922] rounded-full" />
                  <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-[#e6edf3]">Underwriting Profile</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1.5">Capital Requested</label>
                    <TextInput value={questions.capitalRequested} onChange={v => updateQ("capitalRequested", v)} placeholder="$0" />
                  </div>
                  <div>
                    <label className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1.5">FICO Score</label>
                    <TextInput value={questions.ficoScore} onChange={v => updateQ("ficoScore", v)} placeholder="e.g. 700+" />
                  </div>
                  <div>
                    <label className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1.5">Business Start Date (TIB)</label>
                    <TextInput value={questions.timeInBusiness} onChange={v => updateQ("timeInBusiness", v)} placeholder="Full date..." />
                  </div>
                  <div>
                    <label className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1.5"># of Owners</label>
                    <TextInput value={questions.numOwners} onChange={v => updateQ("numOwners", v)} placeholder="e.g. 1" />
                  </div>
                  <div>
                    <label className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1.5">Entity Type</label>
                    <TextInput value={questions.businessType} onChange={v => updateQ("businessType", v)} placeholder="LLC, Corp..." />
                  </div>
                  <div>
                    <label className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1.5">Industry</label>
                    <TextInput value={industry} onChange={setIndustry} placeholder="Industry type..." />
                  </div>
                  <div>
                    <label className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1.5">Proposed Loan Type</label>
                    <div className="w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-sm text-[#e6edf3] min-h-[30px] flex items-center">
                      {clientList.find(c => c.id === selectedClientId)?.proposed_loan_type || "—"}
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1.5">Bankruptcy History</label>
                    <TextInput value={questions.bankruptcy} onChange={v => updateQ("bankruptcy", v)} placeholder="No..." />
                  </div>
                  <div>
                    <label className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1.5">Default History</label>
                    <TextInput value={questions.modifiedOrDefaulted} onChange={v => updateQ("modifiedOrDefaulted", v)} placeholder="None..." />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Economic Summary */}
            <div className="lg:col-span-4 lg:border-l lg:border-[#30363d] lg:pl-6">
              <div className="sticky top-4 space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-6 bg-[#3fb950] rounded-full" />
                  <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-[#e6edf3]">Economic Data</h3>
                </div>

                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-[#0d1117] border border-[#30363d] hover:border-[#3fb950]/30 transition-colors">
                    <span className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1">Avg Annual Revenue (Vault)</span>
                    <span className="text-xl font-mono font-bold text-[#c9d1d9]">
                      {clientList.find(c => c.id === selectedClientId)?.avg_annual_revenue ? formatMoney(clientList.find(c => c.id === selectedClientId)!.avg_annual_revenue) : "—"}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#0d1117] border border-[#30363d] hover:border-[#3fb950]/30 transition-colors">
                    <span className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1">Avg Monthly Revenue (Analysis/Vault)</span>
                    <span className="text-xl font-mono font-bold text-[#3fb950]">
                      {avgRevenue > 0 ? formatMoney(avgRevenue) : (clientList.find(c => c.id === selectedClientId)?.avg_monthly_deposits ? formatMoney(clientList.find(c => c.id === selectedClientId)!.avg_monthly_deposits) : "—")}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#0d1117] border border-[#30363d] hover:border-[#388bfd]/30 transition-colors">
                    <span className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1">Avg Daily Balance</span>
                    <span className="text-xl font-mono font-bold text-[#388bfd]">{formatMoney(avgDailyBalanceAcrossAccounts)}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#0d1117] border border-[#30363d] hover:border-[#d29922]/30 transition-colors">
                    <span className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1">Avg Monthly Deposits</span>
                    <span className="text-xl font-mono font-bold text-[#d29922]">{avgMonthlyDepositsAcrossAccounts.toFixed(1)}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#0d1117] border border-[#30363d] hover:border-[#f85149]/30 transition-colors">
                    <span className="text-[9px] text-[#8b949e] uppercase tracking-widest block mb-1">Total Negative Days</span>
                    <span className={`text-xl font-mono font-bold ${totalNegDaysSum > 0 ? "text-[#f85149]" : "text-[#8b949e]"}`}>
                      {totalNegDaysSum.toString()}
                    </span>
                  </div>
                </div>

                <div className="pt-2">
                  <div className="flex items-center justify-between text-[10px] text-[#8b949e] uppercase tracking-widest mb-1 px-1">
                    <span>State (Override)</span>
                    <span className="font-mono text-[#c9d1d9]">{state || "N/A"}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-[#30363d] pb-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-xs font-medium tracking-wider uppercase transition-all border-b-2 -mb-px ${activeTab === tab.id
                ? "text-[#58a6ff] border-[#388bfd]"
                : "text-[#8b949e] border-transparent hover:text-[#c9d1d9]"
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
              <span className="text-[10px] text-[#8b949e] uppercase tracking-wider font-mono">Range:</span>
              {([3, 6, 8, 12] as const).map(n => (
                <button
                  key={n}
                  onClick={() => setMonthRange(n)}
                  className={`px-3 py-1 rounded text-xs font-mono font-bold tracking-wider transition-all ${monthRange === n
                    ? "bg-[#388bfd] text-white shadow-[0_0_8px_#388bfd50]"
                    : "bg-[#1c2128] text-[#8b949e] border border-[#30363d] hover:border-[#388bfd]/40 hover:text-[#c9d1d9]"
                    }`}
                >
                  {n} Mo
                </button>
              ))}
              <span className="text-[10px] text-[#484f58] font-mono ml-1">
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
                activeMonthIndices={activeMonthIndices}
              />
            ))}
            <button
              onClick={() => setAccounts([...accounts, emptyAccount()])}
              className="w-full rounded-xl border border-dashed border-[#30363d] hover:border-[#388bfd]/50 py-3 text-xs text-[#8b949e] hover:text-[#58a6ff] transition-all font-mono tracking-wider uppercase"
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
            onClick={exportToPDF}
            disabled={isExporting}
            className="flex items-center justify-center gap-3 px-8 py-4 font-bold text-[#e6edf3] bg-[#30363d] hover:bg-[#484f58] border border-[#6e7681]/40 rounded-2xl text-xs uppercase tracking-[0.2em] shadow-2xl shadow-black/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 group"
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
            className="flex items-center justify-center gap-3 px-10 py-4 font-bold text-white bg-[#238636] hover:bg-[#2ea043] border border-[#2ea043]/50 rounded-2xl text-xs uppercase tracking-[0.2em] shadow-2xl shadow-[#238636]/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 group"
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

      </div>
    </div>
  );
}