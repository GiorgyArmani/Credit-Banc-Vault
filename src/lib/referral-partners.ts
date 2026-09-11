import type { SupabaseClient } from "@supabase/supabase-js";
import { REFERRAL_PARTNERS } from "@/data/referral-partners";

/**
 * The INTERNAL referral-partner program (Level 2: CPAs, bankers, professionals
 * who refer clients and earn a negotiated commission).
 *
 * Distinct from the public affiliate program (affiliates / affiliate_leads,
 * flat gift-card reward, /r/<code> landing). The two must never cross-write —
 * see src/lib/affiliates.ts:126. See [[affiliate_program]], [[role_model]].
 *
 * Every function here takes a SERVICE-ROLE client: referral_partners is
 * RLS-locked with zero policies and its grants are revoked from anon and
 * authenticated (migration 20260807). Authorization is the caller's job.
 */

/** Marketing site that hosts /referral-partner. NOT the vault (vault.creditbanc.io). */
const MARKETING_URL = (
  process.env.NEXT_PUBLIC_MARKETING_URL || "https://creditbanc.io"
).replace(/\/+$/, "");

export type ReferralPartner = {
  id: string;
  name: string;
  slug: string | null;
  active: boolean;
  user_id?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  commission_type?: "percent" | "flat" | null;
  commission_value?: number | null;
  portal_enabled?: boolean;
  invited_at?: string | null;
  last_login_at?: string | null;
  link_clicks?: number;
};

/**
 * Canonical form of a partner URL token.
 *
 * Links in circulation are inconsistent — `Aaron_Sedlacek`, `cesar_silva`, and
 * one with a literal space (`?referral_partner=Vanessa Aviles`, which arrives
 * as `Vanessa+Aviles` or `Vanessa%20Aviles`). Rather than chase the marketing
 * site, every lookup collapses to one form.
 *
 * MIRRORS the SQL function public.normalize_partner_slug(text), which backs the
 * unique index on referral_partners.slug. Change one, change both.
 */
export function normalizePartnerSlug(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = String(raw)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
}

/**
 * The subset of a partner row needed to match a pasted line against it.
 * Deliberately narrow so callers can pass whatever their select returned.
 */
export type PartnerLookupRow = {
  id: string;
  name: string;
  slug?: string | null;
  [key: string]: unknown;
};

export type PartnerLookup<T extends PartnerLookupRow = PartnerLookupRow> = {
  bySlug: Map<string, T>;
  byName: Map<string, T>;
};

/**
 * Index a partner list for repeated lookups, by slug AND by name.
 *
 * Built once per bulk operation rather than querying per line: a 500-line paste
 * against 100+ partners is 500 round trips otherwise, and the bulk actions are
 * already the slowest thing on the page.
 *
 * First writer wins on the name index. Two partners whose names normalize to
 * the same token is a registry problem, not something to resolve by silently
 * picking the later row — the earlier one is at least stable between runs.
 */
export function buildPartnerLookup<T extends PartnerLookupRow>(
  partners: readonly T[]
): PartnerLookup<T> {
  const bySlug = new Map<string, T>();
  const byName = new Map<string, T>();

  for (const p of partners) {
    const slugKey = normalizePartnerSlug(p.slug);
    if (slugKey && !bySlug.has(slugKey)) bySlug.set(slugKey, p);

    const nameKey = normalizePartnerSlug(p.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, p);
  }

  return { bySlug, byName };
}

/**
 * Resolve one pasted identifier to a partner. Slug first, then name — the same
 * order the referral links resolve through, so anything that works as a link
 * works here.
 */
export function lookupPartner<T extends PartnerLookupRow>(
  lookup: PartnerLookup<T>,
  key: string | null | undefined
): T | null {
  const wanted = normalizePartnerSlug(key);
  if (!wanted) return null;
  return lookup.bySlug.get(wanted) ?? lookup.byName.get(wanted) ?? null;
}

export type ParsedPartnerLine = {
  /** The partner identifier — a link slug or a name. Always the first column. */
  key: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  /**
   * Columns we could not identify. Non-empty means the line is NOT safe to
   * act on — see parsePartnerLine.
   */
  unrecognized: string[];
};

/**
 * One pasted line from an admin's partner list.
 *
 * Columns are identified BY SHAPE, not by position: the one containing "@" is
 * the email, the first of the rest with enough digits is the phone, whatever
 * remains is the firm. Position-based parsing meant a name-only list ("just the
 * tier-2 names, they're already in the system") read every name as a malformed
 * email, and a spreadsheet with its columns in a different order failed with no
 * hint as to why.
 *
 * Only the key is required. A line with no email is fine when the partner
 * already has one on file — which, after the first send, is most of them.
 *
 * A leftover column is only read as the FIRM once an email or a phone has been
 * identified on the same line. Otherwise it goes to `unrecognized` and the
 * caller rejects the line. That rule exists because of one specific typo: an
 * address missing its "@" ("Aaron Sedlacek, aaronfirm.com") would otherwise be
 * silently filed as the partner's company, the paste would look like it worked,
 * and the invite would go to whatever stale address was already on record.
 */
export function parsePartnerLine(line: string): ParsedPartnerLine | null {
  const cols = String(line ?? "")
    .split(/\t|,/)
    .map((c) => c.trim())
    .filter(Boolean);

  const key = cols.shift() ?? "";
  if (!key) return null;

  const emailAt = cols.findIndex((c) => c.includes("@"));
  const email = emailAt === -1 ? null : cols.splice(emailAt, 1)[0].toLowerCase();

  // 7 digits is the shortest thing worth storing as a phone; it keeps a firm
  // name with a number in it ("1st Choice Tax") out of the phone column.
  const phoneAt = cols.findIndex((c) => (c.match(/\d/g) ?? []).length >= 7);
  const phone = phoneAt === -1 ? null : cols.splice(phoneAt, 1)[0];

  const identified = email !== null || phone !== null;

  return {
    key,
    email,
    phone,
    company: identified ? (cols[0] ?? null) : null,
    unrecognized: identified ? [] : cols,
  };
}

/** Suggested slug for a partner who doesn't have one yet: "Jane Doe" → "Jane_Doe". */
export function partnerSlugFromName(name: string): string {
  return (
    String(name || "")
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "partner"
  );
}

/** The link a partner shares. Lives on the marketing site, feeding a GHL form. */
export function partnerReferralUrl(slug: string): string {
  return `${MARKETING_URL}/referral-partner?referral_partner=${encodeURIComponent(slug)}`;
}

/**
 * Alphabetized list of ACTIVE partner NAMES for the client-card dropdown and the
 * client-creation forms. Falls back to the static seed list
 * ([[refactor_alongside_production]]) if the table can't be read, so the picker
 * is never empty.
 */
export async function getActiveReferralPartners(
  db: SupabaseClient
): Promise<string[]> {
  try {
    const { data, error } = await db
      .from("referral_partners")
      .select("name")
      .eq("active", true)
      .order("name", { ascending: true });

    if (error || !data) {
      console.error("[referral-partners] read failed, using static fallback:", error);
      return [...REFERRAL_PARTNERS];
    }
    return data.map((r: { name: string }) => r.name);
  } catch (err) {
    console.error("[referral-partners] read threw, using static fallback:", err);
    return [...REFERRAL_PARTNERS];
  }
}

/**
 * Resolve a partner from a URL token (`Aaron_Sedlacek`, `cesar_silva`, …).
 *
 * Matches on the normalized slug first, then falls back to the normalized NAME —
 * some GHL forms were filled with the display name rather than the slug, and a
 * near-miss should still attribute rather than silently drop the referral.
 *
 * Deactivated partners still resolve: a deal referred before someone was
 * deactivated is still theirs.
 */
export async function resolvePartnerBySlug(
  db: SupabaseClient,
  raw: string | null | undefined
): Promise<ReferralPartner | null> {
  const wanted = normalizePartnerSlug(raw);
  if (!wanted) return null;

  try {
    const { data, error } = await db
      .from("referral_partners")
      .select("id, name, slug, active");

    if (error || !data) {
      console.error("[referral-partners] resolvePartnerBySlug read failed:", error);
      return null;
    }

    const rows = data as ReferralPartner[];
    return (
      rows.find((r) => normalizePartnerSlug(r.slug) === wanted) ??
      rows.find((r) => normalizePartnerSlug(r.name) === wanted) ??
      null
    );
  } catch (err) {
    console.error("[referral-partners] resolvePartnerBySlug threw:", err);
    return null;
  }
}

/**
 * Resolve a partner by primary key.
 *
 * Used when the partner is already known for certain — chiefly
 * `advisors.referral_partner_id`, i.e. a partner advisor creating their own
 * deal. No normalizing, no fuzzy matching: this is the one path where
 * attribution cannot be wrong.
 */
export async function resolvePartnerById(
  db: SupabaseClient,
  id: string | null | undefined
): Promise<ReferralPartner | null> {
  if (!id) return null;

  try {
    const { data, error } = await db
      .from("referral_partners")
      .select("id, name, slug, active")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[referral-partners] resolvePartnerById failed:", error);
      return null;
    }
    return (data as ReferralPartner) ?? null;
  } catch (err) {
    console.error("[referral-partners] resolvePartnerById threw:", err);
    return null;
  }
}

/** Resolve a partner from the exact display name stored on client_data_vault. */
export async function resolvePartnerByName(
  db: SupabaseClient,
  name: string | null | undefined
): Promise<ReferralPartner | null> {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;

  try {
    const { data, error } = await db
      .from("referral_partners")
      .select("id, name, slug, active")
      .ilike("name", clean)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[referral-partners] resolvePartnerByName failed:", error);
      return null;
    }
    return (data as ReferralPartner) ?? null;
  } catch (err) {
    console.error("[referral-partners] resolvePartnerByName threw:", err);
    return null;
  }
}

/**
 * Stamp a partner onto a vault, writing BOTH the FK and the mirrored name.
 *
 * The name column can't be dropped: the client-card picker, both signup routes
 * and the GHL "Referral Assigned" sync all read it. The FK is what the portal
 * resolves a partner's book of business with, so writing only one of the two
 * leaves either the staff UI or the partner dashboard wrong.
 *
 * Non-throwing — attribution must never break the caller.
 */
export async function stampPartnerOnVault(
  db: SupabaseClient,
  vaultId: string,
  partner: Pick<ReferralPartner, "id" | "name"> | null
): Promise<void> {
  try {
    await db
      .from("client_data_vault")
      .update({
        referral_partner: partner?.name ?? null,
        referral_partner_id: partner?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", vaultId);
  } catch (err) {
    console.error("[referral-partners] stampPartnerOnVault failed (non-fatal):", err);
  }
}
