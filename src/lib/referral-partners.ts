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
