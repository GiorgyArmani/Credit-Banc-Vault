"use client";

import { useState, useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthlyData {
  totalDeposits: string;
  beginningBalance: string;
  endingBalance: string;
  avgDailyBalance: string;
  numDeposits: string;
  negativeDays: string;
  nsfs: string;
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
  totalNegDays: number;       // summed across all accounts
  numOpenPositions: number;   // active positions count
  hasBankruptcy: boolean;     // from Q8
  capitalRequested: number;   // from Q3
  state: string;              // must be passed in separately (2-letter)
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
  nsfs: "0",
});

const emptyAccount = (): AccountData => ({
  accountNumber: "",
  months: MONTHS.map(() => emptyMonthly()),
  notes: ["", "", "", "", ""],
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
}: {
  account: AccountData;
  index: number;
  onChange: (a: AccountData) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const updateMonth = (mi: number, field: keyof MonthlyData, val: string) => {
    const months = account.months.map((m, i) => (i === mi ? { ...m, [field]: val } : m));
    onChange({ ...account, months });
  };

  const filledMonths = account.months.filter((m) => parseMoney(m.totalDeposits) > 0);
  const avgDeposits = avgOfFilled(account.months.map((m) => m.totalDeposits));
  const avgBalance = avgOfFilled(account.months.map((m) => m.avgDailyBalance));
  const totalNSFs = account.months.reduce((a, m) => a + (parseInt(m.nsfs) || 0), 0);
  const totalNegDays = account.months.reduce((a, m) => a + (parseInt(m.negativeDays) || 0), 0);

  const ROWS: { key: keyof MonthlyData; label: string; isMoney: boolean }[] = [
    { key: "totalDeposits", label: "Total Deposits", isMoney: true },
    { key: "beginningBalance", label: "Beginning Balance", isMoney: true },
    { key: "endingBalance", label: "Ending Balance", isMoney: true },
    { key: "avgDailyBalance", label: "Avg Daily Balance", isMoney: true },
    { key: "numDeposits", label: "# of Deposits", isMoney: false },
    { key: "negativeDays", label: "Negative Days", isMoney: false },
    { key: "nsfs", label: "NSFs", isMoney: false },
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
          <StatCell label="Total NSFs" value={totalNSFs.toString()} />
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
              {MONTHS.map((m) => (
                <th key={m} className="text-center px-2 py-2 text-[#8b949e] font-medium min-w-[100px]">
                  {m.slice(0, 3)}
                </th>
              ))}
              <th className="text-center px-3 py-2 text-[#388bfd] font-semibold min-w-[110px] bg-[#1c2128]">
                Avg / Total
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, ri) => {
              const vals = account.months.map((m) => m[row.key]);
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
                  {account.months.map((m, mi) => (
                    <td key={mi} className="px-1 py-1">
                      <CurrencyInput
                        value={m[row.key]}
                        onChange={(v) => updateMonth(mi, row.key, v)}
                        placeholder={row.isMoney ? "0" : "0"}
                      />
                    </td>
                  ))}
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
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 p-4 border-t border-[#21262d] bg-[#13191f]">
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

// ─── Main Component ───────────────────────────────────────────────────────────
// NOTE: Lender matching logic lives in LenderMatch.tsx — import separately.

export default function BankAnalysis() {
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

  const [activeTab, setActiveTab] = useState<"analysis" | "positions" | "offers" | "recon">("analysis");

  // Derived averages across all accounts
  const allDepositMonths = accounts.flatMap((a) => a.months.map((m) => m.totalDeposits));
  const avgRevenue = avgOfFilled(allDepositMonths);

  const updateQ = (k: keyof QualifyingQuestions, v: string) =>
    setQuestions((q) => ({ ...q, [k]: v }));

  const QUALIFYING_QS: { key: keyof QualifyingQuestions; label: string; q: string }[] = [
    { key: "businessType", label: "1", q: "What type of business is this?" },
    { key: "numOwners", label: "2", q: "How many owners does the company have?" },
    { key: "capitalRequested", label: "3", q: "What is the capital requested?" },
    { key: "fundingTimeframe", label: "4", q: "What is the timeframe in receiving the funds?" },
    { key: "timeInBusiness", label: "5", q: "What is their time in business?" },
    { key: "ficoScore", label: "6", q: "Does the merchant know their FICO score?" },
    { key: "workingWithOthers", label: "7", q: "Currently working with anyone else?" },
    { key: "bankruptcy", label: "8", q: "Currently in a Bankruptcy (Personal or Business)?" },
    { key: "anyPositions", label: "9", q: "Are there any positions?" },
    { key: "modifiedOrDefaulted", label: "10", q: "Modified or defaulted on a loan or advance?" },
    { key: "repName", label: "11", q: "Who is the rep?" },
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
        {/* Business Info */}
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
            {accounts.map((account, i) => (
              <AccountBlock
                key={i}
                account={account}
                index={i}
                onChange={(a) => setAccounts(accounts.map((ac, ai) => (ai === i ? a : ac)))}
                onRemove={() => setAccounts(accounts.filter((_, ai) => ai !== i))}
                canRemove={accounts.length > 1}
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
                    placeholder="Response..."
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}