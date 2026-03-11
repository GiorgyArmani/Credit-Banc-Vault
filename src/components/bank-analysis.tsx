"use client";

import { useState, useMemo, useEffect } from "react";
import LenderMatch from "./lender-match";
import { createClient } from "@/lib/supabase/client";

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
  frequency: string;
  numDebits: string;
  amount: string;
  balance: string;
  remitPct: string;
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
  frequency: "",
  numDebits: "",
  amount: "",
  balance: "",
  remitPct: "",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const parseMoney = (v: string) => parseFloat(v.replace(/[$,]/g, "")) || 0;
const formatMoney = (v: number) =>
  v === 0 ? "—" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const formatPct = (v: number) => (isNaN(v) || !isFinite(v) ? "—" : (v * 100).toFixed(1) + "%");

function avgOfFilled(vals: string[]) {
  const nums = vals.map(parseMoney).filter((n) => n > 0);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function sumOfFilled(vals: string[]) {
  return vals.map(parseMoney).filter((n) => n > 0).reduce((a, b) => a + b, 0);
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
  const filledMonths = activeMonths.filter((m) => parseMoney(m.totalDeposits) > 0);
  const avgDeposits = avgOfFilled(activeMonths.map((m) => m.totalDeposits));
  const avgBalance = avgOfFilled(activeMonths.map((m) => m.avgDailyBalance));
  const totalNegDays = activeMonths.reduce((a, m) => a + (parseInt(m.negativeDays) || 0), 0);

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
          <StatCell label="Avg Deposits" value={avgDeposits > 0 ? formatMoney(avgDeposits) : "—"} />
          <StatCell label="Avg Daily Bal" value={avgBalance > 0 ? formatMoney(avgBalance) : "—"} />
          <StatCell label="Neg Days" value={totalNegDays.toString()} />
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
              const avg = row.isMoney ? avgOfFilled(vals) : null;
              const total = !row.isMoney ? vals.reduce((a, v) => a + (parseInt(v) || 0), 0) : null;

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
                      ? avg !== null && avg > 0 ? formatMoney(avg) : "—"
                      : total !== null ? total.toString() : "—"}
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
  const totalRemit = positions.reduce((sum, p) => {
    const bal = parseMoney(p.balance);
    const pct = parseFloat(p.remitPct) / 100 || 0;
    return sum + bal * pct;
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
              {["Funder / Lender", "Frequency", "# Debits", "Amount", "Balance", "Remit %", "Actions"].map((h) => (
                <th key={h} className="text-left px-3 py-2 text-[#8b949e] font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, i) => (
              <tr key={i} className="border-b border-[#21262d] hover:bg-[#1f2937]/20">
                <td className="px-2 py-1.5">
                  <TextInput value={pos.funderLender} onChange={(v) => updatePosition(i, "funderLender", v)} placeholder="Funder name..." />
                </td>
                <td className="px-2 py-1.5">
                  <TextInput value={pos.frequency} onChange={(v) => updatePosition(i, "frequency", v)} placeholder="Daily / Weekly" />
                </td>
                <td className="px-2 py-1.5">
                  <CurrencyInput value={pos.numDebits} onChange={(v) => updatePosition(i, "numDebits", v)} placeholder="0" />
                </td>
                <td className="px-2 py-1.5">
                  <CurrencyInput value={pos.amount} onChange={(v) => updatePosition(i, "amount", v)} placeholder="$0" />
                </td>
                <td className="px-2 py-1.5">
                  <CurrencyInput value={pos.balance} onChange={(v) => updatePosition(i, "balance", v)} placeholder="$0" />
                </td>
                <td className="px-2 py-1.5 w-24">
                  <div className="relative">
                    <CurrencyInput value={pos.remitPct} onChange={(v) => updatePosition(i, "remitPct", v)} placeholder="0" className="pr-6" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8b949e] text-xs">%</span>
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
            ))}
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

// ─── Possible Offers ──────────────────────────────────────────────────────────

function PossibleOffers({ avgRevenue }: { avgRevenue: number }) {
  const [factorRate, setFactorRate] = useState("1.45");
  const [dailyPayment, setDailyPayment] = useState("500");

  const factor = parseFloat(factorRate) || 1.45;
  const daily = parseFloat(dailyPayment) || 500;

  const offers = TERM_MONTHS.map((months) => {
    const tradingDays = months * 22; // ~22 business days/month
    const advanceAmount = avgRevenue > 0 ? (avgRevenue * months) / factor : 0;
    const rtr = advanceAmount * factor;
    const payment = tradingDays > 0 ? rtr / tradingDays : 0;
    const customAdvance = daily * tradingDays / factor;

    return { months, tradingDays, advanceAmount, rtr, payment, customAdvance };
  });

  return (
    <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
      <div className="px-4 py-3 bg-[#1c2128] border-b border-[#30363d] flex items-center justify-between flex-wrap gap-3">
        <span className="text-xs font-bold tracking-[0.15em] uppercase text-[#8b949e]">Possible Offers</span>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-[#8b949e] uppercase tracking-wider whitespace-nowrap">Factor Rate</label>
            <input
              type="text"
              value={factorRate}
              onChange={(e) => setFactorRate(e.target.value)}
              className="w-20 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-sm font-mono text-[#e6edf3] text-center focus:outline-none focus:border-[#388bfd] transition-colors"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-[#8b949e] uppercase tracking-wider whitespace-nowrap">Daily Payment</label>
            <input
              type="text"
              value={dailyPayment}
              onChange={(e) => setDailyPayment(e.target.value)}
              className="w-24 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-sm font-mono text-[#e6edf3] text-right focus:outline-none focus:border-[#388bfd] transition-colors"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#30363d]">
              <th className="text-left px-4 py-2 text-[#8b949e] font-medium">Terms</th>
              {TERM_MONTHS.map((m) => (
                <th key={m} className="text-center px-2 py-2 text-[#8b949e] font-medium whitespace-nowrap min-w-[90px]">
                  {m} Mo.
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              {
                label: `Factor ${factor.toFixed(2)}`,
                getValue: (o: (typeof offers)[0]) =>
                  avgRevenue > 0 ? formatMoney(o.advanceAmount) : "—",
                highlight: true,
              },
              {
                label: "Daily Payment",
                getValue: (o: (typeof offers)[0]) =>
                  avgRevenue > 0 ? formatMoney(o.payment) : "—",
                highlight: false,
              },
              {
                label: "Custom Advance",
                getValue: (o: (typeof offers)[0]) => formatMoney(o.customAdvance),
                highlight: false,
              },
              {
                label: "RTR",
                getValue: (o: (typeof offers)[0]) =>
                  avgRevenue > 0 ? formatMoney(o.rtr) : "—",
                highlight: false,
              },
            ].map((row, ri) => (
              <tr key={ri} className={`border-b border-[#21262d] ${ri % 2 === 0 ? "bg-[#161b22]" : "bg-[#13191f]"}`}>
                <td className={`px-4 py-2 font-medium sticky left-0 z-10 whitespace-nowrap ${row.highlight ? "text-[#58a6ff]" : "text-[#c9d1d9]"}`}
                  style={{ background: ri % 2 === 0 ? "#161b22" : "#13191f" }}>
                  {row.label}
                </td>
                {offers.map((o) => (
                  <td key={o.months} className={`px-2 py-2 text-center font-mono ${row.highlight ? "text-[#3fb950] font-semibold" : "text-[#c9d1d9]"}`}>
                    {row.getValue(o)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Reverse Consolidation ────────────────────────────────────────────────────

interface MCADeal {
  balance: string;
  payment: string;
  daysLeft: string;
}

function ReverseConsolidation() {
  const [businessName, setBusinessName] = useState("");
  const [deals, setDeals] = useState<MCADeal[]>(Array(5).fill(null).map(() => ({ balance: "", payment: "", daysLeft: "" })));
  const [newFunding, setNewFunding] = useState({ factor: "1.35", discount: "", term: "", payment: "" });

  const updateDeal = (i: number, f: keyof MCADeal, v: string) =>
    setDeals(deals.map((d, di) => (di === i ? { ...d, [f]: v } : d)));

  const existingBalances = deals.reduce((s, d) => s + parseMoney(d.balance), 0);
  const dailyMCAach = deals.reduce((s, d) => s + parseMoney(d.payment), 0);

  return (
    <div className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
      <div className="px-4 py-3 bg-[#1c2128] border-b border-[#30363d]">
        <span className="text-xs font-bold tracking-[0.15em] uppercase text-[#8b949e]">Reverse Consolidation Worksheet</span>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Deal inputs */}
        <div>
          <div className="mb-4">
            <label className="text-[10px] text-[#8b949e] uppercase tracking-wider block mb-1">Business DBA Name</label>
            <TextInput value={businessName} onChange={setBusinessName} placeholder="Business name..." />
          </div>

          <div className="space-y-3">
            {deals.map((deal, i) => (
              <div key={i} className="rounded-lg border border-[#21262d] p-3 bg-[#13191f]">
                <div className="text-[10px] text-[#8b949e] uppercase tracking-wider mb-2 font-semibold">
                  MCA Deal #{i + 1}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["balance", "payment", "daysLeft"] as const).map((f) => (
                    <div key={f}>
                      <label className="text-[10px] text-[#8b949e] block mb-0.5 capitalize">
                        {f === "daysLeft" ? "Days Left" : f.charAt(0).toUpperCase() + f.slice(1)}
                      </label>
                      <CurrencyInput
                        value={deal[f]}
                        onChange={(v) => updateDeal(i, f, v)}
                        placeholder={f === "daysLeft" ? "0" : "$0"}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Summary */}
        <div>
          <div className="rounded-lg border border-[#30363d] overflow-hidden">
            <div className="px-3 py-2 bg-[#1c2128] border-b border-[#30363d]">
              <span className="text-[10px] font-bold tracking-wider uppercase text-[#8b949e]">Consolidation Summary</span>
            </div>
            <div className="divide-y divide-[#21262d]">
              {[
                { label: "Existing Balances", value: formatMoney(existingBalances), accent: false },
                { label: "Daily MCA ACH", value: formatMoney(dailyMCAach), accent: false },
                { label: "New Funding Amount", value: "", input: true, field: "payment" },
                { label: "Total Funding", value: formatMoney(existingBalances + parseMoney(newFunding.payment)), accent: true },
                { label: "Factor Rate", value: "", input: true, field: "factor" },
                { label: "Discount", value: "", input: true, field: "discount" },
                { label: "Term", value: "", input: true, field: "term" },
                {
                  label: "RTR",
                  value: formatMoney((existingBalances + parseMoney(newFunding.payment)) * (parseFloat(newFunding.factor) || 1)),
                  accent: true,
                },
              ].map((row, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2">
                  <span className={`text-xs ${row.accent ? "text-[#58a6ff] font-semibold" : "text-[#8b949e]"}`}>
                    {row.label}
                  </span>
                  {row.input ? (
                    <div className="w-32">
                      <CurrencyInput
                        value={newFunding[row.field as keyof typeof newFunding]}
                        onChange={(v) => setNewFunding({ ...newFunding, [row.field!]: v })}
                        placeholder="0"
                      />
                    </div>
                  ) : (
                    <span className={`text-xs font-mono ${row.accent ? "text-[#3fb950] font-bold" : "text-[#e6edf3]"}`}>
                      {row.value}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// (Duplicate interface removed)

// ─── Main Component ───────────────────────────────────────────────────────────
// NOTE: Lender matching logic lives in LenderMatch.tsx — import separately.

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
}

export default function BankAnalysis() {
  const supabase = createClient();

  // ── Client loader state ───────────────────────────────────────────────────
  const [clientList, setClientList] = useState<ClientOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [loadedClientName, setLoadedClientName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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

  const [activeTab, setActiveTab] = useState<"analysis" | "positions" | "offers" | "recon">("analysis");

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
      .select("id, client_name, company_name, client_phone, owner_1_name, owner_2_name, capital_requested, credit_score, business_start_date, legal_entity_type, num_owners:number_of_owners, company_state, industry")
      .order("client_name", { ascending: true })
      .then(({ data }) => {
        if (data) setClientList(data as ClientOption[]);
      });
  }, []);

  // ── Compute TIB string or months from start date ───────────────────────────
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
      timeInBusiness: computeTIB(client.business_start_date),
      ficoScore: client.credit_score || "",
    }));
    setLoadedClientName(`${client.client_name} — ${client.company_name}`);

    // Fetch state and industry from client_data_vault
    const { data: profile } = await supabase
      .from("client_data_vault")
      .select("company_state, industry")
      .eq("id", selectedClientId)
      .single();

    if (profile) {
      setState(profile.company_state || "");
      setIndustry(profile.industry || "");
    }

    // Attempt to fetch saved bank analysis state
    const { data: analysis } = await supabase
      .from("bank_analysis_results")
      .select("*")
      .eq("client_id", selectedClientId)
      .single();

    if (analysis) {
      if (analysis.accounts_data) setAccounts(analysis.accounts_data);
      if (analysis.positions_data) setPositions(analysis.positions_data);
      if (analysis.questions_data) setQuestions(analysis.questions_data);
      if (typeof analysis.has_bankruptcy === 'boolean') setHasBankruptcy(analysis.has_bankruptcy);
    } else {
      // Reset if no saved analysis
      setAccounts([emptyAccount()]);
      setPositions(Array(6).fill(null).map(() => emptyPosition()));
      setHasBankruptcy(false);
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
  const avgMonthlyDepositsAcrossAccounts = avgOfFilled(allDepositCountMonths);

  const totalNegDaysAcrossAccounts = accounts.reduce((sum, acc) => {
    return sum + activeMonthIndices.reduce((mSum, mi) => mSum + (parseInt(acc.months[mi].negativeDays) || 0), 0);
  }, 0);

  const updateQ = (k: keyof QualifyingQuestions, v: string) =>
    setQuestions((q) => ({ ...q, [k]: v }));

  // ─── Save to Database ───────────────────────────────────────────────────────
  const saveAnalysis = async () => {
    if (!selectedClientId) {
      alert("Please select a client first.");
      return;
    }
    setIsSaving(true);

    try {
      // Find client date to compute TIB months
      const client = clientList.find(c => c.id === selectedClientId);
      const tibMonths = client ? computeTIBMonths(client.business_start_date) : 0;

      const { error } = await supabase.from('bank_analysis_results').upsert({
        client_id: selectedClientId,
        business_name: businessName,
        owner_name: ownerName,
        fico: parseInt(questions.ficoScore) || 0,
        tib_months: tibMonths || parseInt(questions.timeInBusiness) || 0,
        avg_revenue: avgRevenue,
        avg_daily_balance: avgDailyBalanceAcrossAccounts,
        total_neg_days: totalNegDaysAcrossAccounts,
        num_open_positions: positions.filter(p => p.funderLender || p.balance).length,
        has_bankruptcy: hasBankruptcy,
        capital_requested: capitalRequested,
        accounts_data: accounts,
        positions_data: positions,
        questions_data: questions
      }, { onConflict: 'client_id' });

      if (error) {
        throw error;
      }
      alert('Analysis saved successfully!');
    } catch (err: any) {
      console.error("Save error:", err);
      alert('Error saving analysis: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const QUALIFYING_QS: { key: keyof QualifyingQuestions; label: string; q: string; isPhone?: boolean }[] = [
    { key: "businessType", label: "1", q: "What type of business is this?" },
    { key: "numOwners", label: "2", q: "How many owners does the company have?" },
    { key: "capitalRequested", label: "3", q: "What is the capital requested?" },
    { key: "timeInBusiness", label: "5", q: "What is their time in business?" },
    { key: "ficoScore", label: "6", q: "Does the merchant know their FICO score?" },
    { key: "workingWithOthers", label: "7", q: "Currently working with anyone else?" },
    { key: "bankruptcy", label: "8", q: "Currently in a Bankruptcy (Personal or Business)?" },
    { key: "anyPositions", label: "9", q: "Are there any positions?" },
    { key: "modifiedOrDefaulted", label: "10", q: "Modified or defaulted on a loan or advance?" },
  ];

  const TABS = [
    { id: "analysis" as const, label: "Bank Analysis" },
    { id: "positions" as const, label: "Open Positions" },
    { id: "offers" as const, label: "Possible Offers" },
    { id: "recon" as const, label: "Reverse Consolidation" },
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
          <div className="flex items-center gap-2">
            {avgRevenue > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 bg-[#1c2128] border border-[#30363d] rounded-lg px-3 py-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
                <span className="text-[10px] text-[#8b949e] uppercase tracking-wider">Avg Monthly Revenue</span>
                <span className="text-sm font-mono font-bold text-[#3fb950] ml-1">{formatMoney(avgRevenue)}</span>
              </div>
            )}
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

        {/* Business Info */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Business DBA Name", value: businessName, onChange: setBusinessName },
              { label: "Owner Name", value: ownerName, onChange: setOwnerName },
              { label: "Owner Name 2", value: ownerName2, onChange: setOwnerName2 },
              { label: "Referred By", value: referredBy, onChange: setReferredBy },
              { label: "Phone Number", value: phone, onChange: setPhone },
              { label: "Phone Number 2", value: phone2, onChange: setPhone2 },
            ].map((f) => (
              <div key={f.label}>
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider block mb-1">{f.label}</label>
                <TextInput value={f.value} onChange={f.onChange} placeholder={f.label} />
              </div>
            ))}
          </div>

          {/* Computed Globals */}
          {(state || industry) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#30363d]">
              {state && (
                <div>
                  <label className="text-[10px] text-[#8b949e] uppercase tracking-wider block mb-1">State (Override)</label>
                  <p className="font-mono text-sm text-[#c9d1d9]">{state}</p>
                </div>
              )}
              {industry && (
                <div className="col-span-2 md:col-span-3">
                  <label className="text-[10px] text-[#8b949e] uppercase tracking-wider block mb-1">Industry (Override)</label>
                  <p className="font-mono text-sm text-[#c9d1d9]">{industry}</p>
                </div>
              )}
            </div>
          )}
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

        {/* Tab: Possible Offers */}
        {activeTab === "offers" && (
          <div>
            {avgRevenue === 0 && (
              <div className="mb-4 rounded-lg border border-[#f0883e]/30 bg-[#f0883e]/5 px-4 py-3 text-xs text-[#f0883e] font-mono">
                ⚠ Enter bank statement data in the Bank Analysis tab to calculate offer amounts based on average revenue.
              </div>
            )}
            <PossibleOffers avgRevenue={avgRevenue} />
          </div>
        )}

        {/* Tab: Reverse Consolidation */}
        {activeTab === "recon" && <ReverseConsolidation />}

        {/* Qualifying Questions - always visible */}
        <div className="mt-6">
          <SectionHeader>Qualifying Questions — Must Ask</SectionHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {QUALIFYING_QS.map((q) => (
              <div key={q.key} className="flex items-start gap-3 rounded-lg border border-[#21262d] bg-[#161b22] px-3 py-3 hover:border-[#30363d] transition-colors">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1c2128] border border-[#388bfd]/40 flex items-center justify-center text-[10px] font-mono font-bold text-[#58a6ff]">
                  {q.label}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-[#8b949e] mb-1.5">{q.q}</p>
                  <TextInput
                    value={questions[q.key]}
                    onChange={(v) => updateQ(q.key, v)}
                    placeholder={q.isPhone ? "e.g. (555) 000-0000" : "Response..."}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Global Action / Output */}
        <div className="mt-8 flex justify-end pb-8 border-b border-[#30363d]">
          <button
            onClick={saveAnalysis}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 px-6 py-3 font-semibold text-white bg-green-600 hover:bg-green-500 border border-green-500/50 rounded-lg shadow-lg disabled:opacity-50 transition-all uppercase tracking-wider text-sm"
          >
            {isSaving ? "Saving..." : "Save Analysis Result"}
          </button>
        </div>

      </div>
    </div>
  );
}