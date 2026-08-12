// src/lib/referral-partner-attribution.ts
//
// How a Level-2 referral partner gets attached to a client vault.
//
// The partner links in circulation point at the MARKETING site, not the vault:
//   https://creditbanc.io/referral-partner?referral_partner=Aaron_Sedlacek
// That page is a GHL embed form, so the param lands on the CRM contact as a
// custom field. By the time a vault is created we are talking to that same
// contact, so attribution is a read back out of GHL — there is no route of ours
// the prospect ever touched. See [[ghl_integration_contract]].
//
// Precedence, highest first:
//   1. The partner who CREATED the deal — a partner advisor working their own
//      file. This is a primary key off their advisors row, not a string to
//      match, so it is the one path that cannot silently miss. See
//      [[referral_partner_portal]].
//   2. An explicit name chosen by staff (the client-card picker / signup form).
//      A human who says "this was Jane" outranks whatever the CRM holds.
//   3. The GHL contact's referral-partner custom field.
//   4. Nothing — leave the vault unattributed rather than guess.
//
// Everything here is best-effort and non-throwing: a missing GHL token, an
// unknown partner or a network hiccup must never fail a signup.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ghlGetContact, ghlResolveFieldId } from "@/lib/ghl-api";
import {
  resolvePartnerById,
  resolvePartnerByName,
  resolvePartnerBySlug,
  stampPartnerOnVault,
  type ReferralPartner,
} from "@/lib/referral-partners";

/**
 * GHL merge keys to try when GHL_CF_REFERRAL_ASSIGNED isn't set, in order.
 *
 * The first is the field this program OWNS — "Referral Assigned", created for
 * exactly this purpose so the two referral programs stop sharing one field:
 *
 *   Name       Referral Assigned
 *   Merge key  {{contact.data_vault_referral_assigned}}
 *
 * GHL can't rename a field key after creation, so the key is the stable handle.
 * Resolve its id with `npx tsx scripts/find-ghl-referral-field.mts` and set
 * GHL_CF_REFERRAL_ASSIGNED — that skips this probe entirely.
 *
 * The rest are fallbacks for contacts stamped before the new field existed.
 * `affiliate_partner` is LAST and deliberately so: it belongs to the public
 * affiliate program, and a value there is more likely to be an affiliate than a
 * Level-2 partner. It stays only so historic contacts still resolve.
 */
const CANDIDATE_FIELD_KEYS = [
  "contact.data_vault_referral_assigned",
  "contact.referral_partner",
  "contact.referral_partner_name",
  "contact.affiliate_partner",
];

/** Pull the referral-partner token off a GHL contact. Returns null on any miss. */
export async function readPartnerTokenFromGhl(
  ghlContactId: string
): Promise<string | null> {
  if (!ghlContactId || !process.env.GHL_TOKEN) return null;

  try {
    const contact = await ghlGetContact(ghlContactId);
    const fields = contact?.customFields ?? [];
    if (!fields.length) return null;

    // A GHL custom field value arrives as `value` on some payloads and
    // `fieldValue` on others; both have been seen from this endpoint.
    const valueOf = (id: string): string | null => {
      const hit = fields.find((f) => f.id === id);
      const raw = hit?.value ?? hit?.fieldValue;
      if (raw === undefined || raw === null) return null;
      const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
      return s || null;
    };

    // Explicit field id wins and skips the lookup entirely.
    //
    // Note this no longer falls back to AFFILIATE_ASSIGNED. That field belongs
    // to the public affiliate program; reading it here is how the two programs
    // got tangled in the first place. Historic contacts are still covered by
    // the `contact.affiliate_partner` probe below, which is explicitly last.
    const explicitId = process.env.GHL_CF_REFERRAL_ASSIGNED;
    if (explicitId) {
      const v = valueOf(explicitId);
      if (v) return v;
    }

    const locationId = process.env.GHL_LOCATION_ID;
    if (!locationId) return null;

    for (const key of CANDIDATE_FIELD_KEYS) {
      const fieldId = await ghlResolveFieldId(locationId, key); // cached in-process
      if (!fieldId) continue;
      const v = valueOf(fieldId);
      if (v) return v;
    }

    return null;
  } catch (err) {
    console.error("[partner-attribution] GHL read failed (non-fatal):", err);
    return null;
  }
}

/**
 * Resolve and stamp the referral partner for a freshly created vault.
 *
 * Call AFTER the vault row exists and the GHL contact is linked. Returns the
 * partner it attributed to, or null.
 */
export async function attributeReferralPartnerToVault(
  db: SupabaseClient,
  args: {
    vaultId: string;
    /**
     * The partner who CREATED this deal — `advisors.referral_partner_id` of the
     * session's advisor row, set when a partner advisor works their own file.
     * Highest precedence, and deliberately so: it is a primary key rather than a
     * name to match, so it is the only attribution path that cannot silently
     * miss. Everything downstream — the commission ledger above all — keys off
     * `client_data_vault.referral_partner_id`, and a partner who had to pick
     * their own name from a dropdown would lose the commission on every deal
     * where the string didn't match the registry exactly.
     */
    creatorPartnerId?: string | null;
    /** Name picked by staff on the signup form, if any. Wins over GHL. */
    explicitName?: string | null;
    ghlContactId?: string | null;
  }
): Promise<ReferralPartner | null> {
  const { vaultId, creatorPartnerId, explicitName, ghlContactId } = args;
  if (!vaultId) return null;

  try {
    let partner: ReferralPartner | null = null;

    if (creatorPartnerId) {
      partner = await resolvePartnerById(db, creatorPartnerId);
      if (!partner) {
        console.warn(
          `[partner-attribution] vault ${vaultId}: creator partner ${creatorPartnerId} not found — falling through`
        );
      }
    }

    if (partner) {
      // Already resolved from the creator; skip the weaker signals below.
    } else if (explicitName && explicitName.trim()) {
      partner = await resolvePartnerByName(db, explicitName);
      if (!partner) {
        // Staff typed a name we have no registry row for. The name is already
        // on the vault from the signup insert; leave it there (it is what the
        // client card and the GHL sync read) and just skip the FK, rather than
        // inventing a partner row nobody approved.
        console.warn(
          `[partner-attribution] vault ${vaultId}: no registry row for "${explicitName}" — name kept, FK left null`
        );
        return null;
      }
    } else if (ghlContactId) {
      const token = await readPartnerTokenFromGhl(ghlContactId);
      if (token) {
        partner = await resolvePartnerBySlug(db, token);
        if (!partner) {
          console.warn(
            `[partner-attribution] vault ${vaultId}: GHL token "${token}" matched no partner`
          );
        }
      }
    }

    if (!partner) return null;

    await stampPartnerOnVault(db, vaultId, partner);
    console.log(
      `[partner-attribution] vault ${vaultId} → ${partner.name} (${partner.slug ?? "no slug"})`
    );
    return partner;
  } catch (err) {
    console.error("[partner-attribution] failed (non-fatal):", err);
    return null;
  }
}

// ============================================================================
// Outbound: which GHL field carries the partner name
// ============================================================================

/** Merge key of the field this program owns. GHL can't rename keys — this is the
 *  stable handle; the id is what the API needs. */
export const PARTNER_ASSIGNED_FIELD_KEY = "contact.data_vault_referral_assigned";

/**
 * The custom-field id to write a partner name into.
 *
 * Prefers GHL_CF_REFERRAL_ASSIGNED, then resolves by merge key (cached
 * in-process by ghlResolveFieldId). The key fallback means the sync keeps
 * working before anyone sets the env — a missing env should degrade to one extra
 * lookup, not to attribution silently vanishing from the CRM.
 */
export async function resolvePartnerAssignedFieldId(): Promise<string | null> {
  const fromEnv = process.env.GHL_CF_REFERRAL_ASSIGNED;
  if (fromEnv) return fromEnv;

  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) return null;

  const id = await ghlResolveFieldId(locationId, PARTNER_ASSIGNED_FIELD_KEY);
  if (!id) {
    console.warn(
      `[partner-attribution] no GHL field for "${PARTNER_ASSIGNED_FIELD_KEY}" and ` +
        `GHL_CF_REFERRAL_ASSIGNED is unset — partner names are not syncing to the CRM. ` +
        `Run: npx tsx scripts/find-ghl-referral-field.mts`
    );
  }
  return id;
}

/**
 * customFields payload for a partner assignment. Pass null to clear.
 *
 * Writes ONLY the referral-partner field. AFFILIATE_ASSIGNED belongs to the
 * public affiliate program, and writing partner names into it is what made "who
 * referred this" ambiguous on every contact.
 *
 * If a GHL workflow or smart list still filters on AFFILIATE_ASSIGNED for
 * partners, set GHL_CF_REFERRAL_ASSIGNED_ALSO_LEGACY=true to dual-write while
 * you repoint it, then remove the flag. Opt-in, because leaving it on
 * indefinitely just recreates the ambiguity.
 */
export async function partnerAssignedCustomFields(
  partnerName: string | null
): Promise<Array<{ id: string; value: string }>> {
  const value = partnerName ?? "";
  const fields: Array<{ id: string; value: string }> = [];

  const primary = await resolvePartnerAssignedFieldId();
  if (primary) fields.push({ id: primary, value });

  if (
    process.env.GHL_CF_REFERRAL_ASSIGNED_ALSO_LEGACY === "true" &&
    process.env.AFFILIATE_ASSIGNED
  ) {
    fields.push({ id: process.env.AFFILIATE_ASSIGNED, value });
  }

  return fields;
}
