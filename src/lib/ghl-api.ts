// src/lib/ghl.ts
import { phoneKey as normalizePhone } from "./phone";

const BASE = process.env.GHL_BASE ?? "https://services.leadconnectorhq.com";

function authHeaders() {
  const token = process.env.GHL_TOKEN;
  if (!token) throw new Error("Missing GHL_TOKEN env");
  return {
    Authorization: `Bearer ${token}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  };
}

export type GhlContactPayload = {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  website?: string | null;
  timezone?: string | null;
  dnd?: boolean;
  tags?: string[];
  companyName?: string | null;
  country?: string | null;
  locationId: string;                 // REQUIRED by GHL
  assignedTo?: string | null;
  customFields?: Array<{ id: string; value: any }>;
};

async function handle(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} :: ${JSON.stringify(data)}`);
  return data;
}

// idempotent upsert
export async function ghlUpsertContact(body: GhlContactPayload) {
  const res = await fetch(`${BASE}/contacts/upsert`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await handle(res);
  // API may return {contact:{id}} or {id}
  return (data?.contact?.id ?? data?.id) as string;
}



export async function ghlUpdateContact(contactId: string, body: Partial<GhlContactPayload>) {
  const res = await fetch(`${BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return handle(res);
}

/**
 * Fetch a single contact by id, including its owner (`assignedTo`).
 * The search endpoint doesn't reliably return `assignedTo`, so when we need
 * the contact owner (e.g. to mirror GHL round-robin ownership into the vault)
 * we read the full contact here.
 */
export async function ghlGetContact(
  contactId: string
): Promise<{ id: string; assignedTo?: string | null; email?: string | null; phone?: string | null } | null> {
  const res = await fetch(`${BASE}/contacts/${contactId}`, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store",
  });
  const data = await handle(res);
  const contact = data?.contact ?? data;
  if (!contact?.id) return null;
  return {
    id: contact.id,
    assignedTo: contact.assignedTo ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
  };
}

export type GhlCustomField = { id: string; name: string; key: string; objectType: string };

export async function ghlFetchCustomFields(locationId: string) {
  // Change: custom-fields → customFields (camelCase)
  const res = await fetch(`${BASE}/locations/${locationId}/customFields`, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store",
  });
  return handle(res) as Promise<{ customFields: GhlCustomField[] }>;
}

/** Crea un índice { "contact.slug_key": "cf_xxx_id" } a partir del listado */
export function buildFieldIndex(list: GhlCustomField[]) {
  const map: Record<string, string> = {};
  for (const f of list) map[f.key] = f.id; // p.ej. "contact.documents_requested" -> "cf_abc123"
  return map;
}

// Cache resolved custom-field ids per location+key so we don't hit the API on
// every call. Value is null when the field doesn't exist in the location.
const _fieldIdCache: Record<string, string | null> = {};

/**
 * Resolve a GHL custom field id from its merge key (e.g. "contact.affiliate_partner").
 * Returns null if the field can't be found. Cached in-process.
 */
export async function ghlResolveFieldId(locationId: string, key: string): Promise<string | null> {
  const cacheKey = `${locationId}:${key}`;
  if (cacheKey in _fieldIdCache) return _fieldIdCache[cacheKey];
  try {
    const { customFields } = await ghlFetchCustomFields(locationId);
    const id = buildFieldIndex(customFields)[key] ?? null;
    _fieldIdCache[cacheKey] = id;
    return id;
  } catch (e) {
    console.error(`[ghl] ghlResolveFieldId failed for ${key}:`, e);
    return null;
  }
}

export async function ghlAddTags(contactId: string, tags: string[]) {
  if (!tags?.length) return;
  const res = await fetch(`${BASE}/contacts/${contactId}/tags`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ tags }),
  });
  return handle(res);
}

export async function ghlRemoveTags(contactId: string, tags: string[]) {
  if (!tags?.length) return;
  const res = await fetch(`${BASE}/contacts/${contactId}/tags`, {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify({ tags }),
  });
  return handle(res);
}

export async function ghlAddContactFollowers(contactId: string, followers: string[]) {
  if (!followers?.length) return;
  const res = await fetch(`${BASE}/contacts/${contactId}/followers`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ followers }),
  });
  return handle(res);
}

export async function ghlRemoveContactFollowers(contactId: string, followers: string[]) {
  if (!followers?.length) return;
  const res = await fetch(`${BASE}/contacts/${contactId}/followers`, {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify({ followers }),
  });
  return handle(res);
}

/**
 * Last 10 digits of a phone number — the only form that compares reliably.
 * The vault stores the display form ("(555) 123-4567") while GHL stores E.164
 * ("+15551234567"), so a raw string compare never matches.
 */
export { normalizePhone };

/**
 * One page of GHL's fuzzy contact search, unfiltered.
 * GHL's own timeout on this endpoint is 30s and it answers with a 400 when it
 * trips — long enough to stall a signup the advisor is watching, so we give up
 * first and let the caller move on.
 */
async function ghlQueryContacts(locationId: string, query: string): Promise<any[]> {
  const res = await fetch(
    `${BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(query)}`,
    { method: "GET", headers: authHeaders(), signal: AbortSignal.timeout(CONTACT_SEARCH_TIMEOUT_MS) }
  );
  const data = await handle(res);
  // API returns { contacts: [...] }
  return data?.contacts || [];
}

const CONTACT_SEARCH_TIMEOUT_MS = 12_000;

export type GhlContactMatch = { id: string; email?: string; phone?: string; contactName?: string };

/**
 * Search for existing contacts in GHL by email, phone, or name.
 * This is used to find contacts that were added in bulk before vault account
 * creation — typically a pre-qualified lead the setter already spoke to.
 *
 * GHL only takes ONE query string, so we search email first and fall back to
 * phone when that finds nothing. Skipping the phone pass is what used to push
 * pre-qualified contacts (same phone, different email) down the "create" path,
 * where GHL rejects the write with a duplicated-contacts 400.
 *
 * Returns `searchFailed` so callers that treat "no contact" as a hard block can
 * tell an empty CRM from an unreachable one — GHL times this endpoint out often
 * enough that the difference matters to the message an advisor sees.
 *
 * @param query - Search criteria (email is the most reliable)
 */
export async function ghlFindContacts(query: {
  email?: string;
  phone?: string;
  name?: string;
  locationId: string;
}): Promise<{ contacts: GhlContactMatch[]; searchFailed: boolean }> {
  const { email, phone, name, locationId } = query;
  const normalizedPhone = normalizePhone(phone);

  // Try each identifier on its own — most unique first — and stop at the first
  // one that produces a verified match.
  const searchTerms = [
    email || null,
    normalizedPhone.length >= 10 ? normalizedPhone : null,
    name || null,
  ].filter((t): t is string => !!t);

  if (searchTerms.length === 0) {
    return { contacts: [], searchFailed: false };
  }

  const matches = (contact: any): boolean => {
    if (email && contact.email?.toLowerCase() === email.toLowerCase()) return true;
    if (normalizedPhone.length >= 10 && normalizePhone(contact.phone) === normalizedPhone) return true;
    if (name && contact.contactName?.toLowerCase().includes(name.toLowerCase())) return true;
    return false;
  };

  // Each term is tried independently: a failed email lookup must not cost us
  // the phone lookup behind it.
  let failures = 0;
  for (const term of searchTerms) {
    let contacts: any[];
    try {
      contacts = await ghlQueryContacts(locationId, term);
    } catch (error: any) {
      failures++;
      console.error(`[ghl] contact search failed for "${term}":`, error?.message || error);
      continue;
    }

    // GHL search is fuzzy, so we verify every hit before trusting it.
    const verified = contacts.filter(matches);
    if (verified.length === 0) continue;

    return {
      contacts: verified.map((contact: any) => ({
        id: contact.id,
        email: contact.email,
        phone: contact.phone,
        contactName: contact.contactName,
      })),
      searchFailed: false,
    };
  }

  const searchFailed = failures === searchTerms.length;
  if (searchFailed) {
    console.error(`[ghl] contact search unavailable — all ${failures} lookup(s) failed`);
  }
  return { contacts: [], searchFailed };
}

/**
 * Contacts-only wrapper around {@link ghlFindContacts} for callers that treat a
 * failed search the same as an empty one — they fall back to /contacts/upsert,
 * which dedupes on email/phone server-side, so a missed match can't strand a
 * duplicate contact.
 */
export async function ghlSearchContacts(query: {
  email?: string;
  phone?: string;
  name?: string;
  locationId: string;
}): Promise<GhlContactMatch[]> {
  const { contacts } = await ghlFindContacts(query);
  return contacts;
}

/**
 * Pull the existing contact id out of GHL's "duplicated contacts" 400.
 * GHL answers a colliding create with
 *   { message: "...duplicated contacts...", meta: { contactId, matchingField } }
 * wrapped in whatever prefix the caller's fetch helper added, so we scan for
 * the JSON body rather than assuming a delimiter.
 * Returns null when the error is something else.
 */
export function extractGhlDuplicateContactId(message: string): string | null {
  if (!message || !message.toLowerCase().includes('duplicated contacts')) return null;
  const start = message.indexOf('{');
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(message.slice(start));
    return parsed?.meta?.contactId || parsed?.meta?.contact?.id || null;
  } catch {
    // Fall back to a direct scan — the body may be truncated or double-wrapped.
    const m = message.match(/"contactId"\s*:\s*"([^"]+)"/);
    return m ? m[1] : null;
  }
}
