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
