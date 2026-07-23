/**
 * Phone number handling — one place, three representations.
 *
 * Phones arrive from advisors typing free-form ("555.123.4567 x2",
 * "+1 (555) 123-4567") and have to line up with GHL, which stores E.164. The
 * mismatch is what let a pre-qualified contact slip past the "does this contact
 * already exist?" check and get rejected as a duplicate on write.
 *
 * The three forms and where each belongs:
 *   phoneKey()      "5551234567"        — comparison / dedupe only, never stored
 *   toE164()        "+15551234567"      — what we send to GHL
 *   formatPhoneUS() "(555) 123-4567"    — what we store in the vault and show
 *
 * The vault keeps the display form so client pages, tel: links and the SignWell
 * application read naturally; every comparison goes through phoneKey(), so the
 * stored format never has to be exact.
 */

/** Every digit, nothing else. */
export function phoneDigits(value?: string | null): string {
  return (value || '').replace(/\D/g, '');
}

/**
 * Comparison key: the 10-digit US subscriber number. An optional US country
 * code is dropped, so "+15551234567", "(555) 123-4567" and "555.123.4567" all
 * collapse to "5551234567".
 *
 * Anything that isn't exactly 10 digits (with or without the leading 1) returns
 * '' — deliberately strict. Slicing 10 digits out of a longer string can't tell
 * an extension from an international number, and silently keying
 * "(555) 123-4567 x22" to the wrong subscriber is worse than rejecting it.
 */
export function phoneKey(value?: string | null): string {
  const digits = phoneDigits(value);
  const core = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return core.length === 10 ? core : '';
}

/** True when the value contains a usable 10-digit US number. */
export function isValidUsPhone(value?: string | null): boolean {
  return phoneKey(value).length === 10;
}

/**
 * E.164 for GHL / SMS ("+15551234567"). Returns null when the input isn't a
 * complete US number — callers should fall back to sending nothing rather than
 * pushing a half-typed number into the CRM.
 */
export function toE164(value?: string | null): string | null {
  const key = phoneKey(value);
  return key ? `+1${key}` : null;
}

/**
 * Canonical stored/display form: "(555) 123-4567".
 * Anything that isn't a complete US number is returned trimmed and untouched —
 * we don't mangle international or legacy values we can't parse.
 */
export function formatPhoneUS(value?: string | null): string {
  const key = phoneKey(value);
  if (!key) return (value || '').trim();
  return `(${key.slice(0, 3)}) ${key.slice(3, 6)}-${key.slice(6)}`;
}

/**
 * Progressive mask for a controlled <input> — formats as the advisor types and
 * refuses anything past 10 digits, so the stored value is clean before it ever
 * reaches the API. Handles paste of "+1..." and of already-formatted numbers.
 */
export function formatPhoneInput(value: string): string {
  let digits = phoneDigits(value);
  // Paste of a +1-prefixed or 11-digit number: drop the country code.
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  digits = digits.slice(0, 10);

  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
