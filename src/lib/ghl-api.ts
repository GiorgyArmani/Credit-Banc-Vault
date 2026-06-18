// src/lib/ghl.ts
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
 * Search for existing contacts in GHL by email, phone, or name
 * This is used to find contacts that were added in bulk before vault account creation
 * @param query - Search criteria (email is the most reliable)
 * @returns Array of matching contacts with their IDs
 */
export async function ghlSearchContacts(query: {
  email?: string;
  phone?: string;
  name?: string;
  locationId: string;
}): Promise<Array<{ id: string; email?: string; phone?: string; contactName?: string }>> {
  const { email, phone, name, locationId } = query;

  // Build search query - prioritize email as it's the most unique identifier
  const searchQuery = email || phone || name;

  if (!searchQuery) {
    return [];
  }

  try {
    const res = await fetch(`${BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(searchQuery)}`, {
      method: "GET",
      headers: authHeaders(),
    });

    const data = await handle(res);

    // API returns { contacts: [...] }
    const contacts = data?.contacts || [];

    // Filter results to find exact matches
    // GHL search can be fuzzy, so we verify the match
    return contacts.filter((contact: any) => {
      if (email && contact.email?.toLowerCase() === email.toLowerCase()) {
        return true;
      }
      if (phone && contact.phone === phone) {
        return true;
      }
      if (name && contact.contactName?.toLowerCase().includes(name.toLowerCase())) {
        return true;
      }
      return false;
    }).map((contact: any) => ({
      id: contact.id,
      email: contact.email,
      phone: contact.phone,
      contactName: contact.contactName
    }));
  } catch (error) {
    console.error('Error searching GHL contacts:', error);
    return []; // Return empty array on error to allow fallback to upsert
  }
}
