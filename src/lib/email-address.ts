// Minimal email-shape validation for PUBLIC forms.
//
// Deliberately not an RFC 5322 parser. The only questions worth answering at an
// API boundary are "is this plausibly an address" and "will it break the things
// we hand it to" — GoHighLevel, the mail transport, and a UNIQUE index that
// treats it as an identity. Anything stricter rejects real addresses; anything
// looser lets "asdf" become a lead row and a CRM contact.
const EMAIL_RE = /^[^\s@,;:<>"'()[\]\\]+@[^\s@.,;:<>"'()[\]\\]+(\.[^\s@.,;:<>"'()[\]\\]+)+$/;

/** Longest address we will store. Well above any real one; caps abuse payloads. */
export const MAX_EMAIL_LENGTH = 254;

export function isValidEmailShape(value?: string | null): boolean {
  const v = (value ?? "").trim();
  if (!v || v.length > MAX_EMAIL_LENGTH) return false;
  return EMAIL_RE.test(v);
}
