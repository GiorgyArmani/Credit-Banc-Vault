// src/lib/lender-approval-parse.ts
//
// Best-effort read of a lender's approval notes (client_lender_assignments.
// response_notes) for the Loan Funded dialog: the approved amount and term.
// The notes are free text pasted from lender emails, so this only ever
// SUGGESTS a value — UW sees the notes beside the field and edits freely.
// Returns null rather than a doubtful guess.

/** "$350,000" / "$1,500,000.00" / "$400k" / "$1.75M" → number. */
function money(raw: string): number | null {
  const m = raw.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kKmM](?![a-z]))?/);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2]?.toLowerCase();
  if (unit === "k") n *= 1_000;
  if (unit === "m") n *= 1_000_000;
  return Math.round(n);
}

// Labels that name the principal, most specific first. Payment / P&I / fee
// amounts are never matched because they are not in this list.
const AMOUNT_LABELS = [
  /approved\s+amount\s*:?\s*/i,
  /(?:proposed\s+)?loan\s+amount\s*:?\s*/i,
  /approved\s+(?:up\s+to|for)\s*:?\s*/i,
  /in\s+the\s+amount\s+of\s*/i,
  /loan\s+request\s*:?\s*/i,
  /funding\s+amount\s*:?\s*/i,
  /equipment\s+cost\s*:?\s*/i,
  /max\s+heloc\s*:?\s*/i,
];

export function parseApprovedAmount(notes: string | null | undefined): number | null {
  if (!notes) return null;
  for (const label of AMOUNT_LABELS) {
    const at = notes.search(label);
    if (at < 0) continue;
    // The amount must follow the label closely, or the label isn't about it.
    const after = notes.slice(at).replace(label, "").slice(0, 25);
    const n = money(after);
    if (n != null) return n;
  }
  // No label: only trust a dollar figure that opens the notes ("$400k, 1.32 buy rate…").
  const lead = notes.trimStart();
  return lead.startsWith("$") ? money(lead.slice(0, 20)) : null;
}

const UNIT: Record<string, string> = { day: "days", week: "weeks", month: "months", year: "years" };
const DURATION = /(\d{1,3})\s*-?\s*(day|week|month|year)s?\b/i;

export function parseApprovedTerm(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const fmt = (m: RegExpMatchArray) => `${m[1]} ${UNIT[m[2].toLowerCase()]}`;
  // "Term: 10 years", "Payback Term: 12 Months", "Base Term: 24 months", "Term: 5-Year ARM"
  const labelled = notes.match(new RegExp(`term\\s*:?\\s*${DURATION.source}`, "i"));
  if (labelled) return fmt(labelled);
  // "(12 months)", "over 60 days"
  const loose = notes.match(new RegExp(`(?:\\(|over\\s+)${DURATION.source}`, "i"));
  return loose ? fmt(loose) : null;
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function parseApproval(notes: string | null | undefined): { amount: string | null; term: string | null } {
  const amount = parseApprovedAmount(notes);
  return { amount: amount != null ? usd(amount) : null, term: parseApprovedTerm(notes) };
}
