//
// Pure normalizers shared by every lender API provider. Vault data is typed by
// hand in many places (onboarding forms, advisor edits, GHL sync), so every
// value a lender receives passes through here first.
//
// parseUsAddress is best-effort by design: home_address / business_address are
// single free-text fields, frequently with no comma between street and city.
// Its output is only ever a PREFILL that UW confirms in the review panel.

export function nonEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function digitsOnly(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).replace(/\D/g, "");
}

export function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const cleaned = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  if (typeof cleaned !== "number" || !Number.isFinite(cleaned)) return null;
  if (typeof v === "string" && !/\d/.test(v)) return null;
  return Math.round(cleaned);
}

export function toIsoDate(v: unknown): string | null {
  const s = nonEmpty(v);
  if (!s) return null;
  // Date-only and ISO timestamps: take the date part verbatim. new Date() on a
  // bare date would parse as UTC and can shift a day in US timezones.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

export function splitName(full: unknown): { first: string | null; last: string | null } {
  const s = nonEmpty(full);
  if (!s) return { first: null, last: null };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  let lastStart = parts.length - 1;
  if (NAME_SUFFIX.test(parts[lastStart]) && parts.length > 2) lastStart -= 1;
  return { first: parts.slice(0, lastStart).join(" "), last: parts.slice(lastStart).join(" ") };
}

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "puerto rico": "PR", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(STATE_NAMES));
/** Two-letter codes for the 50 states, DC and PR — for lender state dropdowns. */
export const US_STATE_CODES: readonly string[] = Array.from(STATE_CODES).sort();
// Longest first so "west virginia" wins over "virginia".
const STATE_NAME_KEYS = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length);

export function toStateCode(v: unknown): string | null {
  const s = nonEmpty(v);
  if (!s) return null;
  const cleaned = s.replace(/\./g, "").trim();
  if (cleaned.length === 2 && STATE_CODES.has(cleaned.toUpperCase())) return cleaned.toUpperCase();
  return STATE_NAMES[cleaned.toLowerCase().replace(/\s+/g, " ")] ?? null;
}

export function toZip5(v: unknown): string | null {
  const d = digitsOnly(v);
  return d.length === 5 || d.length === 9 ? d.slice(0, 5) : null;
}

export interface ParsedAddress {
  street1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const STREET_SUFFIX =
  /^(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|way|pl|place|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|trl|trail)\.?,?$/i;
const UNIT = /^(apt|apartment|suite|ste|unit|#)\.?$/i;

function trimTail(s: string): string {
  return s.replace(/[\s,]+$/, "");
}

export function parseUsAddress(raw: unknown): ParsedAddress {
  const empty: ParsedAddress = { street1: null, city: null, state: null, zip: null };
  let s = nonEmpty(raw);
  if (!s) return empty;

  s = s
    .replace(/;/g, ",")
    .replace(/\s+/g, " ")
    .replace(/,\s*(usa|us|united states)\.?$/i, "")
    .trim();

  let zip: string | null = null;
  const zipMatch = s.match(/[\s,](\d{5})(?:-\d{4})?\s*$/);
  if (zipMatch && zipMatch.index !== undefined) {
    zip = zipMatch[1];
    s = trimTail(s.slice(0, zipMatch.index));
  }

  let state: string | null = null;
  // A trailing 2-letter token is only a state when a zip followed it or a comma
  // precedes it — otherwise "30 Oak Ct" would read as Connecticut.
  const codeMatch = s.match(/([\s,])([A-Za-z]{2})\.?$/);
  if (codeMatch && codeMatch.index !== undefined && toStateCode(codeMatch[2]) && (zip || codeMatch[1] === ",")) {
    state = toStateCode(codeMatch[2]);
    s = trimTail(s.slice(0, codeMatch.index));
  } else {
    for (const name of STATE_NAME_KEYS) {
      const re = new RegExp(`[\\s,]${name.replace(/ /g, "\\s+")}\\.?$`, "i");
      const m = s.match(re);
      if (m && m.index !== undefined) {
        state = STATE_NAMES[name];
        s = trimTail(s.slice(0, m.index));
        break;
      }
    }
  }

  const commaParts = s.split(",").map((p) => p.trim()).filter(Boolean);
  const lastPart = commaParts[commaParts.length - 1] ?? "";
  const lastStartsWithUnit = UNIT.test(lastPart.split(" ")[0] ?? "");

  if (commaParts.length >= 2 && !lastStartsWithUnit) {
    return { street1: commaParts.slice(0, -1).join(", "), city: lastPart, state, zip };
  }

  const tokens = s.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  let cut = -1;
  for (let i = tokens.length - 2; i >= 1; i--) {
    if (STREET_SUFFIX.test(tokens[i])) {
      cut = i;
      break;
    }
  }
  if (cut >= 0) {
    let end = cut + 1;
    if (end < tokens.length - 1 && UNIT.test(tokens[end])) end += 2;
    const city = tokens.slice(end).join(" ");
    return { street1: tokens.slice(0, end).join(" "), city: city || null, state, zip };
  }

  return { street1: s || null, city: null, state, zip };
}
