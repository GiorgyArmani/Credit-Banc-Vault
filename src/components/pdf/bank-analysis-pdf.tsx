// src/components/pdf/bank-analysis-pdf.tsx
import {
    Document,
    Page,
    View,
    Text,
    StyleSheet,
} from "@react-pdf/renderer";

// ─── Types (mirror of bank-analysis.tsx) ─────────────────────────────────────

export interface BankAnalysisPDFMonthlyData {
    totalDeposits: string;
    beginningBalance: string;
    endingBalance: string;
    avgDailyBalance: string;
    numDeposits: string;
    negativeDays: string;
}

export interface BankAnalysisPDFAccount {
    accountNumber: string;
    months: BankAnalysisPDFMonthlyData[];
    notes: string[];
}

export interface BankAnalysisPDFPosition {
    funderLender: string;
    loanType: string;    // "MCA" / "Term Loan" / "LOC" / "Factor"
    frequency: string;   // Payment type: Daily / Weekly / Monthly
    numDebits: string;
    amount: string;      // Payment amount per debit
    balance: string;     // Current outstanding balance
    remitPct: string;
    term: string;
}

export interface BankAnalysisPDFData {
    // Client/deal snapshot
    businessName: string;
    ownerName: string;
    ownerName2?: string;
    referredBy?: string;
    phone?: string;
    phone2?: string;
    state: string;
    industry: string;

    // Computed summary
    avgRevenue: number;
    avgDailyBalance: number;
    avgMonthlyDeposits: number;
    totalNegDays: number;
    avgNegDays: number;
    numOpenPositions: number;
    capitalRequested: number;
    fico: number;
    tibMonths: number;
    businessStartDate?: string; // ISO date string (e.g. "2015-06-15")
    hasBankruptcy: boolean;

    // Raw data
    monthRange: number;
    activeMonths: string[]; // 3-letter labels in display order (e.g. ["Dec", "Jan", "Feb"])
    accounts: BankAnalysisPDFAccount[];
    activeMonthIndices: number[]; // indices into each account's months[] array
    positions: BankAnalysisPDFPosition[];
    questions: Record<string, string>;

    // Team assigned to this client in the app
    advisorName?: string;     // Lead advisor who owns the client
    followers?: string[];     // Other advisors / team members following the file

    // Meta
    generatedAt: string; // pre-formatted ISO or friendly date
    analystName?: string;
}

// ─── Colors / styles ─────────────────────────────────────────────────────────

const colors = {
    brand: "#238636",
    ink: "#0F172A",
    text: "#1F2937",
    sub: "#6B7280",
    border: "#D1D5DB",
    tableHeadBg: "#F3F4F6",
    zebra: "#FAFAFB",
    negative: "#B91C1C",
};

const styles = StyleSheet.create({
    page: { padding: 28, fontFamily: "Helvetica", color: colors.text },

    brandBar: {
        backgroundColor: colors.brand,
        color: "white",
        padding: 10,
        marginBottom: 14,
        borderRadius: 4,
    },
    brandTitle: { fontSize: 14, fontWeight: "bold", color: "white" },
    brandSub: { fontSize: 9, color: "white", marginTop: 2 },

    h1: { fontSize: 16, fontWeight: "bold", color: colors.ink, marginBottom: 4 },
    h2: { fontSize: 12, fontWeight: "bold", color: colors.ink, marginBottom: 6, marginTop: 10 },
    p: { fontSize: 10, lineHeight: 1.4 },
    small: { fontSize: 8, color: colors.sub },

    summaryGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        marginBottom: 10,
    },
    summaryCell: {
        width: "25%",
        padding: 6,
        borderWidth: 1,
        borderColor: colors.border,
        borderRightWidth: 0,
        borderBottomWidth: 0,
    },
    summaryCellLast: { borderRightWidth: 1 },
    summaryLabel: { fontSize: 7, color: colors.sub, textTransform: "uppercase", letterSpacing: 0.5 },
    summaryValue: { fontSize: 10, fontWeight: "bold", color: colors.ink, marginTop: 2 },

    card: {
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 4,
        padding: 8,
        marginBottom: 10,
    },
    cardHeader: {
        fontSize: 11,
        fontWeight: "bold",
        color: colors.ink,
        marginBottom: 6,
    },

    table: {
        width: "100%",
        borderWidth: 1,
        borderColor: colors.border,
        borderRightWidth: 0,
        borderBottomWidth: 0,
        marginTop: 4,
    },
    tr: { flexDirection: "row" },
    th: {
        fontSize: 8,
        fontWeight: "bold",
        backgroundColor: colors.tableHeadBg,
        paddingVertical: 4,
        paddingHorizontal: 5,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: colors.border,
    },
    td: {
        fontSize: 8,
        paddingVertical: 4,
        paddingHorizontal: 5,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: colors.border,
    },
    tdLabel: { fontWeight: "bold", color: colors.ink },
    tdNegative: { color: colors.negative, fontWeight: "bold" },
    tdTotal: { backgroundColor: "#EEF2FF", fontWeight: "bold" },
    tdPositive: { color: "#047857", fontWeight: "bold" },
    tdWarn: { color: "#B45309", fontWeight: "bold" },

    verdict: {
        padding: 8,
        borderRadius: 4,
        marginBottom: 10,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    verdictHealthy: { backgroundColor: "#ECFDF5", borderWidth: 1, borderColor: "#10B981" },
    verdictWarn: { backgroundColor: "#FEF3C7", borderWidth: 1, borderColor: "#F59E0B" },
    verdictCritical: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#EF4444" },
    verdictTitle: { fontSize: 11, fontWeight: "bold" },
    verdictSub: { fontSize: 8, marginTop: 2 },

    keyVal: { flexDirection: "row", marginBottom: 2 },
    keyLabel: { fontSize: 9, color: colors.sub, width: 110 },
    keyValue: { fontSize: 9, color: colors.ink, flex: 1 },

    footer: {
        position: "absolute",
        bottom: 14,
        left: 28,
        right: 28,
        fontSize: 7,
        color: colors.sub,
        textAlign: "center",
    },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseMoneyRaw = (v: string): number => {
    const raw = (v ?? "").trim();
    if (!raw) return NaN;
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

const avgOfFilledMoney = (vals: string[]): number => {
    const nums = vals.map(parseMoneyRaw).filter((n) => Number.isFinite(n));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN;
};

const avgOfIntegers = (vals: string[]): number => {
    const nums = vals.map((v) => parseInt(v)).filter((n) => !isNaN(n));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN;
};

const formatDate = (iso?: string): string => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const formatTIB = (months: number): string => {
    if (!months || months <= 0) return "—";
    const years = Math.floor(months / 12);
    const rem = months % 12;
    const human =
        years > 0 && rem > 0
            ? `${years}y ${rem}mo`
            : years > 0
                ? `${years}y`
                : `${rem}mo`;
    return `${human} (${months}mo)`;
};

// ─── Remit derivation (mirrors bank-analysis.tsx) ───────────────────────────
// MCA Remit % is almost never on the contract — it's derived from the fixed
// ACH payment × frequency, compared to avg monthly revenue. Priority:
// payment × freq (true cash burn) → stated remit% fallback.
const freqMultiplier = (frequency: string): number => {
    const f = (frequency || "").toLowerCase().trim();
    if (!f) return NaN;
    if (f.startsWith("daily") || f === "day") return 21.67;
    if (f.startsWith("bi-week") || f.startsWith("biweek") || f === "every 2 weeks") return 2.167;
    if (f.startsWith("week") || f === "wk") return 4.333;
    if (f.startsWith("month") || f === "mo") return 1;
    return NaN;
};

interface PositionMetricsPDF {
    payment: number;
    balance: number;
    monthlyRemit: number;
    impliedRemitPct: number;
    statedRemitPct: number;
    isRemitDerived: boolean;
    isPaymentDriven: boolean;
    paybackMonths: number;
    dataQualityFlag: "ok" | "high" | "impossible";
}

const computePositionMetricsPDF = (
    p: BankAnalysisPDFPosition,
    avgRevenue: number
): PositionMetricsPDF => {
    const payment = parseMoneyRaw(p.amount);
    const balance = parseMoneyRaw(p.balance);
    const mult = freqMultiplier(p.frequency);
    const statedPct = parseFloat(p.remitPct) / 100;

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

    // 35% matches the hardest-stretch ceiling in our lender database — above
    // that, no lender in the system will place the deal. Below stays "ok".
    let dataQualityFlag: PositionMetricsPDF["dataQualityFlag"] = "ok";
    if (Number.isFinite(impliedRemitPct)) {
        if (impliedRemitPct > 1) dataQualityFlag = "impossible";
        else if (impliedRemitPct > 0.35) dataQualityFlag = "high";
    }

    return {
        payment,
        balance,
        monthlyRemit,
        impliedRemitPct,
        statedRemitPct: statedPct,
        isRemitDerived,
        isPaymentDriven,
        paybackMonths,
        dataQualityFlag,
    };
};

// Row spec (mirrors bank-analysis.tsx ROWS)
const MONEY_ROWS: { key: keyof BankAnalysisPDFMonthlyData; label: string }[] = [
    { key: "totalDeposits", label: "Total Deposits" },
    { key: "beginningBalance", label: "Beginning Balance" },
    { key: "endingBalance", label: "Ending Balance" },
    { key: "avgDailyBalance", label: "Avg Daily Balance" },
];

const INTEGER_ROWS: { key: keyof BankAnalysisPDFMonthlyData; label: string }[] = [
    { key: "numDeposits", label: "# of Deposits" },
    { key: "negativeDays", label: "Negative Days" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function BankAnalysisPDF({ data }: { data: BankAnalysisPDFData }) {
    const {
        businessName,
        ownerName,
        ownerName2,
        referredBy,
        phone,
        phone2,
        state,
        industry,
        avgRevenue,
        avgDailyBalance,
        avgMonthlyDeposits,
        totalNegDays,
        avgNegDays,
        numOpenPositions,
        capitalRequested,
        fico,
        tibMonths,
        businessStartDate,
        hasBankruptcy,
        advisorName,
        followers,
        monthRange,
        activeMonths,
        accounts,
        activeMonthIndices,
        positions,
        questions,
        generatedAt,
        analystName,
    } = data;

    const monthColWidth = `${70 / Math.max(activeMonths.length, 1)}%`;
    const labelColWidth = "20%";
    const totalColWidth = "10%";

    // Compact typography for high month counts. At 9+ months the default
    // fontSize/padding spills $1M+ figures across cells (overlap on the
    // Account Breakdown page). Scaling type + padding keeps everything in
    // its column even at the 12-month lookback.
    const denseMonths = activeMonths.length >= 9;
    const cellFontSize = denseMonths ? 6.5 : 8;
    const cellPaddingV = denseMonths ? 2 : 4;
    const cellPaddingH = denseMonths ? 2 : 5;
    const cellStyleOverride = {
        fontSize: cellFontSize,
        paddingVertical: cellPaddingV,
        paddingHorizontal: cellPaddingH,
    };

    const renderAccountTable = (account: BankAnalysisPDFAccount, idx: number) => {
        const activeData = activeMonthIndices.map((mi) => account.months[mi]);

        return (
            <View key={idx} style={styles.card} wrap={false}>
                <Text style={styles.cardHeader}>
                    Account #{idx + 1}
                    {account.accountNumber ? ` — ${account.accountNumber}` : ""}
                </Text>

                <View style={styles.table}>
                    {/* Header row */}
                    <View style={styles.tr}>
                        <Text style={[styles.th, cellStyleOverride, { width: labelColWidth }]}>Field</Text>
                        {activeMonths.map((m, i) => (
                            <Text key={i} style={[styles.th, cellStyleOverride, { width: monthColWidth, textAlign: "center" }]}>
                                {m}
                            </Text>
                        ))}
                        <Text style={[styles.th, cellStyleOverride, { width: totalColWidth, textAlign: "center" }]}>Avg / Total</Text>
                    </View>

                    {/* Money rows */}
                    {MONEY_ROWS.map((row) => {
                        const vals = activeData.map((md) => md[row.key]);
                        const avg = avgOfFilledMoney(vals);
                        return (
                            <View key={row.key} style={styles.tr}>
                                <Text style={[styles.td, styles.tdLabel, cellStyleOverride, { width: labelColWidth }]}>{row.label}</Text>
                                {vals.map((v, i) => {
                                    const n = parseMoneyRaw(v);
                                    const isNeg = Number.isFinite(n) && n < 0;
                                    return (
                                        <Text
                                            key={i}
                                            style={[
                                                styles.td,
                                                cellStyleOverride,
                                                { width: monthColWidth, textAlign: "right" },
                                                isNeg ? styles.tdNegative : {},
                                            ]}
                                        >
                                            {Number.isFinite(n) ? formatMoney(n) : "—"}
                                        </Text>
                                    );
                                })}
                                <Text
                                    style={[
                                        styles.td,
                                        styles.tdTotal,
                                        cellStyleOverride,
                                        { width: totalColWidth, textAlign: "right" },
                                        Number.isFinite(avg) && avg < 0 ? styles.tdNegative : {},
                                    ]}
                                >
                                    {formatMoney(avg)}
                                </Text>
                            </View>
                        );
                    })}

                    {/* Integer rows */}
                    {INTEGER_ROWS.map((row) => {
                        const vals = activeData.map((md) => md[row.key]);
                        const isSum = row.key === "negativeDays";
                        const total = isSum
                            ? vals.map(v => parseInt(v)).filter(n => !isNaN(n)).reduce((a, b) => a + b, 0)
                            : avgOfIntegers(vals);
                        return (
                            <View key={row.key} style={styles.tr}>
                                <Text style={[styles.td, styles.tdLabel, cellStyleOverride, { width: labelColWidth }]}>{row.label}</Text>
                                {vals.map((v, i) => (
                                    <Text key={i} style={[styles.td, cellStyleOverride, { width: monthColWidth, textAlign: "right" }]}>
                                        {v || "—"}
                                    </Text>
                                ))}
                                <Text style={[styles.td, styles.tdTotal, cellStyleOverride, { width: totalColWidth, textAlign: "right" }]}>
                                    {!Number.isFinite(total)
                                        ? "—"
                                        : isSum
                                            ? total.toString()
                                            : total.toFixed(1)}
                                </Text>
                            </View>
                        );
                    })}
                </View>

                {/* Notes */}
                {account.notes.some((n) => n && n.trim()) && (
                    <View style={{ marginTop: 6 }}>
                        {account.notes.map(
                            (note, i) =>
                                note && note.trim() ? (
                                    <Text key={i} style={{ fontSize: 8, color: colors.sub, marginBottom: 1 }}>
                                        Note {i + 1}: {note}
                                    </Text>
                                ) : null
                        )}
                    </View>
                )}
            </View>
        );
    };

    const filledPositions = positions.filter(
        (p) => (p.funderLender && p.funderLender.trim()) || (p.balance && p.balance.trim())
    );

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                {/* Brand bar */}
                <View style={styles.brandBar}>
                    <Text style={styles.brandTitle}>Bank Analysis Report</Text>
                    <Text style={styles.brandSub}>
                        Credit Banc · Underwriting · Generated {generatedAt}
                    </Text>
                </View>

                {/* Title row */}
                <Text style={styles.h1}>{businessName || "—"}</Text>
                <Text style={styles.small}>
                    {[ownerName, ownerName2].filter(Boolean).join(" / ") || "Owner not specified"}
                    {industry ? ` · ${industry}` : ""}
                    {state ? ` · ${state}` : ""}
                </Text>

                {/* Contact / referral strip */}
                {(referredBy || phone || phone2) && (
                    <View style={{ marginTop: 4 }}>
                        {referredBy ? (
                            <View style={styles.keyVal}>
                                <Text style={styles.keyLabel}>Referred By</Text>
                                <Text style={styles.keyValue}>{referredBy}</Text>
                            </View>
                        ) : null}
                        {phone ? (
                            <View style={styles.keyVal}>
                                <Text style={styles.keyLabel}>Phone</Text>
                                <Text style={styles.keyValue}>{phone}</Text>
                            </View>
                        ) : null}
                        {phone2 ? (
                            <View style={styles.keyVal}>
                                <Text style={styles.keyLabel}>Phone 2</Text>
                                <Text style={styles.keyValue}>{phone2}</Text>
                            </View>
                        ) : null}
                    </View>
                )}

                {/* Summary cards — 2 rows of 4 */}
                <Text style={styles.h2}>Summary ({monthRange}-month lookback)</Text>
                <View style={styles.summaryGrid}>
                    <SummaryCell label="Avg Revenue" value={formatMoney(avgRevenue)} />
                    <SummaryCell label="Avg Daily Balance" value={formatMoney(avgDailyBalance)} />
                    <SummaryCell label="Avg Monthly Deposits" value={Number.isFinite(avgMonthlyDeposits) ? avgMonthlyDeposits.toFixed(1) : "—"} />
                    <SummaryCell
                        label="Total Neg Days"
                        value={totalNegDays.toString()}
                        last
                    />

                    <SummaryCell label="Avg Neg Days / Mo" value={Number.isFinite(avgNegDays) ? Math.ceil(avgNegDays).toString() : "—"} />
                    <SummaryCell label="Open Positions" value={numOpenPositions.toString()} />
                    <SummaryCell label="Capital Requested" value={formatMoney(capitalRequested)} />
                    <SummaryCell label="FICO" value={fico ? fico.toString() : "—"} last />

                    <SummaryCell label="Time in Business" value={formatTIB(tibMonths)} />
                    <SummaryCell label="Business Started" value={formatDate(businessStartDate)} />
                    <SummaryCell label="Industry" value={industry || "—"} />
                    <SummaryCell label="State" value={state || "—"} last />
                </View>

                {/* Qualifying questions */}
                <Text style={styles.h2}>Qualifying Questions</Text>
                <View style={styles.card}>
                    <QRow label="Business Type / Industry" value={questions.businessType || industry} />
                    <QRow label="Number of Owners" value={questions.numOwners} />
                    <QRow label="Capital Requested" value={questions.capitalRequested} />
                    <QRow label="Time in Business" value={formatTIB(tibMonths)} />
                    <QRow label="Business Started" value={formatDate(businessStartDate)} />
                    <QRow label="FICO Score" value={questions.ficoScore || (fico ? fico.toString() : "")} />
                    <QRow label="Bankruptcy" value={questions.bankruptcy || (hasBankruptcy ? "Yes" : "No")} />
                </View>

                {/* Team assigned to this client */}
                {(advisorName || (followers && followers.length > 0)) && (
                    <>
                        <Text style={styles.h2}>Assigned Team</Text>
                        <View style={styles.card}>
                            {advisorName ? (
                                <QRow label="Lead Advisor" value={advisorName} />
                            ) : null}
                            {followers && followers.length > 0 ? (
                                <QRow label="Followers" value={followers.join(", ")} />
                            ) : null}
                        </View>
                    </>
                )}

                {/* Footer */}
                <Text style={styles.footer} fixed>
                    Credit Banc — Bank Analysis Report
                    {analystName ? ` · Prepared by ${analystName}` : ""}
                </Text>
            </Page>

            {/* One page per account (or batched if they fit). Landscape at
                7+ months so the per-cell width stays generous enough for
                $1M+ figures — portrait was overlapping cells at 9+ months. */}
            <Page
                size="A4"
                orientation={activeMonths.length >= 7 ? "landscape" : "portrait"}
                style={styles.page}
            >
                <Text style={styles.h1}>Account Breakdown</Text>
                <Text style={styles.small}>
                    {accounts.length} account{accounts.length === 1 ? "" : "s"} · {monthRange}-month lookback
                </Text>
                <View style={{ marginTop: 8 }}>
                    {accounts.map((acc, i) => renderAccountTable(acc, i))}
                </View>

                <Text style={styles.footer} fixed>
                    Credit Banc — Bank Analysis Report
                    {analystName ? ` · Prepared by ${analystName}` : ""}
                </Text>
            </Page>

            {/* Positions page — deep analysis (landscape for column density) */}
            {filledPositions.length > 0 && (
                <Page size="A4" orientation="landscape" style={styles.page}>
                    <Text style={styles.h1}>Open Positions — Deep Analysis</Text>
                    <Text style={styles.small}>
                        {filledPositions.length} active position{filledPositions.length === 1 ? "" : "s"}
                        {" · "}Avg monthly revenue {formatMoney(avgRevenue)}
                    </Text>

                    {(() => {
                        // Derive each position's real cash burn from its payment ×
                        // frequency (industry-standard MCA reality-check). See
                        // computePositionMetricsPDF above — falls back to stated
                        // Remit% × avgRevenue only when payment/freq aren't both set.
                        const rows = filledPositions.map((p) => {
                            const m = computePositionMetricsPDF(p, avgRevenue);
                            return { p, ...m };
                        });

                        const totalBalance = rows.reduce(
                            (s, r) => s + (Number.isFinite(r.balance) ? r.balance : 0),
                            0
                        );
                        const totalMonthlyRemit = rows.reduce(
                            (s, r) => s + (Number.isFinite(r.monthlyRemit) ? r.monthlyRemit : 0),
                            0
                        );
                        const totalPayment = rows.reduce(
                            (s, r) => s + (Number.isFinite(r.payment) ? r.payment : 0),
                            0
                        );
                        const usedRemitPct = avgRevenue > 0 ? totalMonthlyRemit / avgRevenue : NaN;
                        const availableRemit = avgRevenue * 0.2 - totalMonthlyRemit;

                        // One verdict banner per analysis — no stacked duplicates.
                        // Tiered by severity relative to the 20% preferred remit target.
                        // At >100% aggregate, we fold the "likely mislabel" guidance
                        // into the same banner so the reader sees a single take rather
                        // than two red/orange blocks saying the same thing.
                        let verdict: "healthy" | "warn" | "critical" = "healthy";
                        let verdictTitle = "Within 20% remit target";
                        let verdictSub = `${formatMoney(availableRemit)} of headroom remaining before reaching the 20% preferred ceiling.`;
                        if (Number.isFinite(usedRemitPct)) {
                            if (usedRemitPct > 1) {
                                verdict = "critical";
                                verdictTitle = `Aggregate remit ${(usedRemitPct * 100).toFixed(1)}% of revenue`;
                                verdictSub = `Sum of Payment × Frequency across positions is higher than avg monthly deposits. A frequency mislabel (Daily vs Weekly) on one row or a stale revenue figure is the usual cause — review the orange row(s) below before treating the aggregate as final.`;
                            } else if (usedRemitPct >= 0.25) {
                                verdict = "critical";
                                verdictTitle = `Aggregate remit ${(usedRemitPct * 100).toFixed(1)}% of revenue`;
                                verdictSub = `${formatMoney(Math.abs(availableRemit))} over the 20% preferred ceiling. Stacking capacity is constrained.`;
                            } else if (usedRemitPct >= 0.2) {
                                verdict = "warn";
                                verdictTitle = `Aggregate remit ${(usedRemitPct * 100).toFixed(1)}% of revenue`;
                                verdictSub = `At the 20% preferred ceiling — new stacking will tighten capacity.`;
                            }
                        }

                        const verdictStyle =
                            verdict === "critical"
                                ? styles.verdictCritical
                                : verdict === "warn"
                                    ? styles.verdictWarn
                                    : styles.verdictHealthy;

                        // Identify the heaviest position (by monthly remit)
                        const heaviest = rows.reduce((max, r) =>
                            (Number.isFinite(r.monthlyRemit) ? r.monthlyRemit : -Infinity) >
                                (Number.isFinite(max.monthlyRemit) ? max.monthlyRemit : -Infinity)
                                ? r
                                : max
                        );

                        return (
                            <>
                                {/* Single verdict banner — severity reflects aggregate
                                    remit vs. the 20% preferred target. Per-position
                                    issues are already signaled inline via colored cells
                                    in the detail table below, so no separate banner. */}
                                <View style={[styles.verdict, verdictStyle]} wrap={false}>
                                    <View style={{ flex: 1, paddingRight: 8 }}>
                                        <Text style={styles.verdictTitle}>{verdictTitle}</Text>
                                        <Text style={styles.verdictSub}>{verdictSub}</Text>
                                    </View>
                                    <Text style={{ fontSize: 18, fontWeight: "bold" }}>
                                        {Number.isFinite(usedRemitPct) ? `${(usedRemitPct * 100).toFixed(1)}%` : "—"}
                                    </Text>
                                </View>

                                {/* Totals grid — 4 cells across */}
                                <View style={styles.summaryGrid}>
                                    <SummaryCell label="Total Outstanding" value={formatMoney(totalBalance)} />
                                    <SummaryCell label="Total Monthly Remit" value={formatMoney(totalMonthlyRemit)} />
                                    <SummaryCell label="Used Remit %" value={Number.isFinite(usedRemitPct) ? `${(usedRemitPct * 100).toFixed(1)}%` : "—"} />
                                    <SummaryCell
                                        label="Available Remit (20%)"
                                        value={formatMoney(availableRemit)}
                                        last
                                    />
                                    <SummaryCell label="Positions" value={filledPositions.length.toString()} />
                                    <SummaryCell label="Sum of Payments" value={formatMoney(totalPayment)} />
                                    <SummaryCell
                                        label="Heaviest Lender"
                                        value={heaviest.p.funderLender || "—"}
                                    />
                                    <SummaryCell
                                        label="Heaviest Remit / Mo"
                                        value={formatMoney(heaviest.monthlyRemit)}
                                        last
                                    />
                                </View>

                                {/* Detail table — one row per position, with derived columns */}
                                <Text style={styles.h2}>Position Detail</Text>
                                <View style={styles.table}>
                                    <View style={styles.tr}>
                                        <Text style={[styles.th, { width: "14%" }]}>Funder / Lender</Text>
                                        <Text style={[styles.th, { width: "9%" }]}>Loan Type</Text>
                                        <Text style={[styles.th, { width: "9%", textAlign: "center" }]}>Payment Type</Text>
                                        <Text style={[styles.th, { width: "9%", textAlign: "right" }]}>Amount</Text>
                                        <Text style={[styles.th, { width: "10%", textAlign: "right" }]}>Balance</Text>
                                        <Text style={[styles.th, { width: "7%", textAlign: "center" }]}>Remit %</Text>
                                        <Text style={[styles.th, { width: "7%", textAlign: "center" }]}>Term</Text>
                                        <Text style={[styles.th, { width: "6%", textAlign: "center" }]}># Deb</Text>
                                        <Text style={[styles.th, { width: "11%", textAlign: "right" }]}>Monthly Remit</Text>
                                        <Text style={[styles.th, { width: "8%", textAlign: "right" }]}>% of Rev</Text>
                                        <Text style={[styles.th, { width: "10%", textAlign: "right" }]}>Payback (mo)</Text>
                                    </View>
                                    {rows.map((r, i) => {
                                        // Choose how to display Remit %:
                                        //   - Stated value if user entered one
                                        //   - "~ X%" with hint styling if we derived it
                                        //     (ASCII tilde — Helvetica's PDF encoding
                                        //     doesn't carry the ≈ glyph and it was
                                        //     rendering as literal "H" in exports)
                                        //   - "—" otherwise
                                        const remitDisplay = Number.isFinite(r.statedRemitPct)
                                            ? `${(r.statedRemitPct * 100).toFixed(1)}%`
                                            : Number.isFinite(r.impliedRemitPct)
                                                ? `~${(r.impliedRemitPct * 100).toFixed(1)}%`
                                                : "—";
                                        const remitCellStyle =
                                            r.dataQualityFlag === "impossible"
                                                ? styles.tdNegative
                                                : r.dataQualityFlag === "high"
                                                    ? styles.tdWarn
                                                    : {};
                                        return (
                                            <View key={i} style={styles.tr} wrap={false}>
                                                <Text style={[styles.td, styles.tdLabel, { width: "14%" }]}>
                                                    {r.p.funderLender || "—"}
                                                </Text>
                                                <Text style={[styles.td, { width: "9%" }]}>
                                                    {r.p.loanType || "—"}
                                                </Text>
                                                <Text style={[styles.td, { width: "9%", textAlign: "center" }]}>
                                                    {r.p.frequency || "—"}
                                                </Text>
                                                <Text style={[styles.td, { width: "9%", textAlign: "right" }]}>
                                                    {formatMoney(r.payment)}
                                                </Text>
                                                <Text style={[styles.td, { width: "10%", textAlign: "right" }]}>
                                                    {formatMoney(r.balance)}
                                                </Text>
                                                <Text
                                                    style={[
                                                        styles.td,
                                                        { width: "7%", textAlign: "center" },
                                                        remitCellStyle,
                                                    ]}
                                                >
                                                    {remitDisplay}
                                                </Text>
                                                <Text style={[styles.td, { width: "7%", textAlign: "center" }]}>
                                                    {r.p.term || "—"}
                                                </Text>
                                                <Text style={[styles.td, { width: "6%", textAlign: "center" }]}>
                                                    {r.p.numDebits || "—"}
                                                </Text>
                                                <Text
                                                    style={[
                                                        styles.td,
                                                        { width: "11%", textAlign: "right" },
                                                        styles.tdLabel,
                                                    ]}
                                                >
                                                    {formatMoney(r.monthlyRemit)}
                                                </Text>
                                                <Text
                                                    style={[
                                                        styles.td,
                                                        { width: "8%", textAlign: "right" },
                                                        remitCellStyle,
                                                    ]}
                                                >
                                                    {Number.isFinite(r.impliedRemitPct)
                                                        ? `${(r.impliedRemitPct * 100).toFixed(1)}%`
                                                        : "—"}
                                                </Text>
                                                <Text style={[styles.td, { width: "10%", textAlign: "right" }]}>
                                                    {Number.isFinite(r.paybackMonths)
                                                        ? r.paybackMonths!.toFixed(1)
                                                        : "—"}
                                                </Text>
                                            </View>
                                        );
                                    })}
                                    {/* Totals row */}
                                    <View style={styles.tr}>
                                        <Text style={[styles.td, styles.tdTotal, { width: "14%" }]}>TOTALS</Text>
                                        <Text style={[styles.td, styles.tdTotal, { width: "9%" }]}> </Text>
                                        <Text style={[styles.td, styles.tdTotal, { width: "9%" }]}> </Text>
                                        <Text style={[styles.td, styles.tdTotal, { width: "9%", textAlign: "right" }]}>
                                            {formatMoney(totalPayment)}
                                        </Text>
                                        <Text style={[styles.td, styles.tdTotal, { width: "10%", textAlign: "right" }]}>
                                            {formatMoney(totalBalance)}
                                        </Text>
                                        <Text style={[styles.td, styles.tdTotal, { width: "7%" }]}> </Text>
                                        <Text style={[styles.td, styles.tdTotal, { width: "7%" }]}> </Text>
                                        <Text style={[styles.td, styles.tdTotal, { width: "6%" }]}> </Text>
                                        <Text style={[styles.td, styles.tdTotal, { width: "11%", textAlign: "right" }]}>
                                            {formatMoney(totalMonthlyRemit)}
                                        </Text>
                                        <Text style={[styles.td, styles.tdTotal, { width: "8%", textAlign: "right" }]}>
                                            {Number.isFinite(usedRemitPct)
                                                ? `${(usedRemitPct * 100).toFixed(1)}%`
                                                : "—"}
                                        </Text>
                                        <Text style={[styles.td, styles.tdTotal, { width: "10%" }]}> </Text>
                                    </View>
                                </View>

                                {/* Methodology footnote */}
                                <View style={{ marginTop: 8 }}>
                                    <Text style={styles.small}>
                                        Monthly Remit = Payment × Frequency multiplier (Daily×21.67, Weekly×4.33,
                                        Bi-Weekly×2.17, Monthly×1). Implied Remit % = Monthly Remit ÷ Avg Monthly
                                        Revenue. Stated Remit % shows as entered; otherwise the derived figure is
                                        prefixed with &quot;~&quot;. Term is a free-text reference — not all
                                        lenders report it, and the math does not depend on it. Positions above 35%
                                        of revenue (the hardest-stretch ceiling in our lender database) are shown
                                        in orange to flag placement difficulty or an input to review. Aggregate
                                        above 100% is shown in red to flag a likely frequency mislabel or stale
                                        revenue — review before treating the number as final. Payback (mo) =
                                        Balance ÷ Monthly Remit. Verdict uses the 20% preferred remit-to-revenue
                                        ceiling. Missing Payment, Frequency, or Term inputs render as &quot;—&quot;
                                        and are simply excluded from the position&apos;s derived math.
                                    </Text>
                                </View>
                            </>
                        );
                    })()}

                    <Text style={styles.footer} fixed>
                        Credit Banc — Bank Analysis Report
                        {analystName ? ` · Prepared by ${analystName}` : ""}
                    </Text>
                </Page>
            )}
        </Document>
    );
}

// ─── Small sub-components ────────────────────────────────────────────────────

function SummaryCell({ label, value, last }: { label: string; value: string; last?: boolean }) {
    return (
        <View style={[styles.summaryCell, last ? styles.summaryCellLast : {}]}>
            <Text style={styles.summaryLabel}>{label}</Text>
            <Text style={styles.summaryValue}>{value}</Text>
        </View>
    );
}

function QRow({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.keyVal}>
            <Text style={styles.keyLabel}>{label}</Text>
            <Text style={styles.keyValue}>{value || "—"}</Text>
        </View>
    );
}
