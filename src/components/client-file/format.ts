// Display formatting for the client file's tiles and rail. Every helper returns
// an em dash for missing data so a tile never renders blank.

import { differenceInMonths, format, isValid, parseISO } from "date-fns";

const DASH = "—";

function isPositive(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function oneDecimal(n: number): string {
  return Number(n.toFixed(1)).toString();
}

export function formatCurrency(n: number | null | undefined): string {
  if (!isPositive(n)) return DASH;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatCompactCurrency(n: number | null | undefined): string {
  if (!isPositive(n)) return DASH;
  const rounded = Math.round(n);
  if (rounded < 1000) return `$${rounded}`;
  const thousands = Number((n / 1000).toFixed(1));
  if (thousands < 1000) return `$${oneDecimal(thousands)}k`;
  return `$${oneDecimal(n / 1_000_000)}M`;
}

export function formatMonthly(n: number | null | undefined): string {
  const compact = formatCompactCurrency(n);
  return compact === DASH ? DASH : `${compact} / mo`;
}

// parseISO treats "2019-10-14" as LOCAL midnight; new Date() would read it as
// UTC and show the previous day anywhere west of Greenwich.
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

export function formatTimeInBusiness(start: string | null | undefined, now: Date = new Date()): string {
  const d = parseDate(start);
  if (!d) return DASH;
  const months = differenceInMonths(now, d);
  if (months < 0 || d > now) return DASH;
  if (months < 1) return "<1m";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest}m`;
  if (rest === 0) return `${years}y`;
  return `${years}y ${rest}m`;
}

export function formatDate(iso: string | null | undefined): string {
  const d = parseDate(iso);
  return d ? format(d, "MMM d, yyyy") : DASH;
}

export function formatCreditScore(score: string | null | undefined): string {
  const trimmed = (score ?? "").trim();
  return trimmed || DASH;
}
