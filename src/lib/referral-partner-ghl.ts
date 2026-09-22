// src/lib/referral-partner-ghl.ts
//
// Mirrors a Level-2 referral partner into GHL as a contact carrying the two
// links their CRM automations merge:
//
//   {{contact.referral_partner_link}}    → their creditbanc.io referral link
//   {{contact.referral_dashboard_link}}  → one-click sign-in to /partner
//
// ONE writer for both callers — the invite action and the weekly refresh cron —
// so the field contract lives in a single place. See [[ghl_integration_contract]].
//
// Two things to keep straight, because the names collide:
//   * `contact.referral_partner_link` lives on the PARTNER's own contact.
//   * `contact.referral_partner` (QOlQRlIm2BsT7EaHYZDh) is ATTRIBUTION, stamped
//     on a referred CLIENT's contact to record who sent them.
//   * The public affiliate program has its own pair again
//     (data_vault_personal_affiliate_link / data_vault_affiliate_dashboard_link).
// Crossing any of these means money attributed to the wrong person
// ([[ghl_affiliate_vs_referral_fields]]).

import {
  ghlUpsertContact,
  ghlResolveFieldId,
  ghlUpdateContact,
  ghlAddTags,
  ghlRemoveTags,
  ghlSearchContacts,
} from "@/lib/ghl-api";
import { generatePartnerPortalMagicLink } from "@/lib/magic-link";
import { partnerReferralUrl } from "@/lib/referral-partners";

/**
 * The durable "this is a referral partner" marker. Add-only everywhere except
 * removeAllPartnerTags (deleting the partner from the referral list), so
 * re-running the cron can't re-trigger a one-time workflow — which is exactly
 * why it is a segment marker and not a `new …` trigger tag like the affiliate
 * program's.
 */
export const PARTNER_TAG = "referral partner";

/**
 * The TIER tag, added alongside PARTNER_TAG when a partner is invited. Both
 * already exist in the live location, and the welcome automations key on them:
 *   tier 1 — shares a link, watches the dashboard (`referral_partner`)
 *   tier 2 — works their own files on the deal desk (`partner_advisor`)
 *
 * Exactly ONE of the two is ever on a contact: promoting a tier-1 partner to
 * the deal desk removes the tier-1 tag as it adds tier 2 (user decision), so a
 * segment filtered on "tier 1 referral partner" stops matching them. That is
 * the one place this module removes a tag — PARTNER_TAG itself stays add-only.
 */
export const PARTNER_TIER_TAGS = {
  1: "tier 1 referral partner",
  2: "tier 2 referral partner",
} as const;

export type PartnerTier = keyof typeof PARTNER_TIER_TAGS;

/** The tier tag to add, and the other one to take off. */
export function partnerTierTags(tier: PartnerTier): { add: string; remove: string } {
  return {
    add: PARTNER_TIER_TAGS[tier],
    remove: PARTNER_TIER_TAGS[tier === 2 ? 1 : 2],
  };
}

/**
 * Native GHL contact type. This location defines its own set rather than the
 * stock lead/customer pair, so the value is env-overridable: if GHL rejects it
 * the upsert is retried WITHOUT a type instead of losing the contact.
 */
const PARTNER_CONTACT_TYPE = process.env.GHL_PARTNER_CONTACT_TYPE || "referral_partner";

/** Field ids confirmed against the live location; merge key is the fallback. */
const FIELD_KEY_PARTNER_LINK = "contact.referral_partner_link";
const FIELD_KEY_DASHBOARD_LINK = "contact.referral_dashboard_link";

export interface PartnerGhlInput {
  id: string;
  name: string | null;
  email: string | null;
  phone?: string | null;
  slug?: string | null;
  company?: string | null;
  /** Known contact id, when we've synced this partner before. */
  ghl_contact_id?: string | null;
  /** The tier this partner is being INVITED as. Only the invite sets it; the
   *  refresh cron omits it, which leaves tier tags untouched. */
  tier?: PartnerTier;
}

export interface PartnerGhlResult {
  synced: boolean;
  contactId: string | null;
  /** Which fields actually got a value, for the cron's report. */
  wroteFields: string[];
  skipReason?: string;
  error?: string;
}

/**
 * Resolves both custom-field ids. Env first (one less API call), merge key as
 * the fallback so a field recreated in GHL under a new id still resolves.
 *
 * A missing field is logged LOUDLY rather than swallowed: the silent failure
 * mode here is an automation merging an empty string into an email, which looks
 * like a broken link to the partner and like nothing at all to us.
 */
async function resolveFieldIds(locationId: string) {
  const [partnerLinkFieldId, dashboardFieldId] = await Promise.all([
    process.env.GHL_CF_REFERRAL_PARTNER_LINK ||
      ghlResolveFieldId(locationId, FIELD_KEY_PARTNER_LINK),
    process.env.GHL_CF_REFERRAL_DASHBOARD_LINK ||
      ghlResolveFieldId(locationId, FIELD_KEY_DASHBOARD_LINK),
  ]);

  if (!partnerLinkFieldId) {
    console.error(
      `[partner-ghl] Custom field "${FIELD_KEY_PARTNER_LINK}" not found in location ${locationId} — ` +
        `the referral link will NOT be written. Set GHL_CF_REFERRAL_PARTNER_LINK or create the field.`
    );
  }
  if (!dashboardFieldId) {
    console.error(
      `[partner-ghl] Custom field "${FIELD_KEY_DASHBOARD_LINK}" not found in location ${locationId} — ` +
        `the dashboard link will NOT be written. Set GHL_CF_REFERRAL_DASHBOARD_LINK or create the field.`
    );
  }

  return { partnerLinkFieldId, dashboardFieldId };
}

/**
 * Put the partner tags on a contact: the durable marker, plus exactly one tier
 * tag when a tier is known (adding the current one, removing the other).
 *
 * Add-only for PARTNER_TAG; the tier pair is the one place this module removes
 * a tag, so a promoted partner stops matching a tier-1 segment.
 *
 * Throws — callers wrap it, since a tag write must never fail the work that
 * came before it.
 */
export async function syncPartnerTags(
  contactId: string,
  tier?: PartnerTier
): Promise<void> {
  if (!tier) {
    await ghlAddTags(contactId, [PARTNER_TAG]);
    return;
  }
  const { add, remove } = partnerTierTags(tier);
  await ghlAddTags(contactId, [PARTNER_TAG, add]);
  try {
    await ghlRemoveTags(contactId, [remove]);
  } catch (removeErr) {
    // The tag that matters is on. A stale opposite tag is worth a log, not a
    // thrown invite.
    console.warn(`[partner-ghl] could not remove "${remove}" from ${contactId}:`, removeErr);
  }
}

/**
 * Strip every partner tag from the CRM contact — the marker AND both tier tags.
 *
 * ONLY for deleting a partner from the referral list (admin decision). Nothing
 * else removes PARTNER_TAG: deactivating, or dropping the deal desk, leaves
 * someone who is still a referral partner, and pulling the marker would quietly
 * drop them out of every partner campaign.
 *
 * The GHL CONTACT is left in place. They may be a client, a lead, or a past
 * partner with history worth keeping; this only says "not a partner any more".
 *
 * NEVER THROWS — the row is already gone from the vault by the time this runs,
 * and a CRM hiccup must not turn a completed delete into an error.
 */
export async function removeAllPartnerTags(args: {
  email: string | null;
  ghl_contact_id?: string | null;
}): Promise<{ synced: boolean; contactId: string | null; skipReason?: string }> {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) return { synced: false, contactId: null, skipReason: "no GHL_LOCATION_ID" };

  const email = (args.email ?? "").trim().toLowerCase();
  let contactId = args.ghl_contact_id ?? null;

  try {
    if (!contactId) {
      if (!email) return { synced: false, contactId: null, skipReason: "no email on file" };
      const found = await ghlSearchContacts({ email, locationId });
      contactId = found[0]?.id ?? null;
    }
    if (!contactId) return { synced: false, contactId: null, skipReason: "no GHL contact" };

    await ghlRemoveTags(contactId, [PARTNER_TAG, PARTNER_TIER_TAGS[1], PARTNER_TIER_TAGS[2]]);
    return { synced: true, contactId };
  } catch (err: any) {
    console.error(`[partner-ghl] tag cleanup failed for ${email || contactId}:`, err);
    return { synced: false, contactId, skipReason: err?.message || String(err) };
  }
}

/**
 * Move a partner's tier tags when the deal-desk toggle flips — the one manual,
 * reviewed promotion path, so it is safe to let it trigger a GHL workflow.
 *
 *   promoted  → add "tier 2 referral partner", remove "tier 1 referral partner"
 *   demoted   → remove BOTH tier tags (admin decision)
 *
 * The demotion strips the tier tags and adds none back: re-adding tier 1 would
 * re-trigger the tier-1 welcome automation for someone who has been a partner
 * for months. Both are removed rather than just tier 2, so a tag added by hand
 * in GHL can't leave a demoted partner sitting in a tier segment.
 *
 * PARTNER_TAG survives a demotion: turning the deal desk off makes someone a
 * plain referral partner again, not a non-partner, and dropping the marker
 * would silently pull them out of every partner campaign.
 *
 * NEVER THROWS: the role flip has already happened and is what actually grants
 * the deal desk; the CRM tag is bookkeeping on top of it.
 */
export async function applyPartnerTierPromotion(args: {
  email: string | null;
  ghl_contact_id?: string | null;
  /** true when the deal desk was just turned ON. */
  promoted: boolean;
}): Promise<{ synced: boolean; contactId: string | null; skipReason?: string }> {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) return { synced: false, contactId: null, skipReason: "no GHL_LOCATION_ID" };

  const email = (args.email ?? "").trim().toLowerCase();
  let contactId = args.ghl_contact_id ?? null;

  try {
    if (!contactId) {
      if (!email) return { synced: false, contactId: null, skipReason: "no email on file" };
      const found = await ghlSearchContacts({ email, locationId });
      contactId = found[0]?.id ?? null;
    }
    if (!contactId) return { synced: false, contactId: null, skipReason: "no GHL contact" };

    if (args.promoted) {
      await syncPartnerTags(contactId, 2);
    } else {
      await ghlRemoveTags(contactId, [PARTNER_TIER_TAGS[1], PARTNER_TIER_TAGS[2]]);
    }
    return { synced: true, contactId };
  } catch (err: any) {
    console.error(`[partner-ghl] tier tag change failed for ${email || contactId}:`, err);
    return { synced: false, contactId, skipReason: err?.message || String(err) };
  }
}

/**
 * Upsert this partner into GHL and stamp both link fields.
 *
 * NEVER THROWS. Every caller has already done the thing that matters (granted
 * portal access, sent the welcome email), and a CRM hiccup must not undo it.
 * Failures come back on the result so the cron can report them.
 *
 * The upsert matches on email, so partners migrated in from the main GHL
 * account are FOUND AND FILLED rather than duplicated.
 *
 * The dashboard link is a working credential on a 30-day TTL. That is why
 * /api/cron/refresh-partner-links re-stamps it weekly instead of this being a
 * write-once field — a stamp left alone becomes a ?error=verification_failed
 * bounce about a month later, silently.
 */
export async function syncReferralPartnerToGhl(
  partner: PartnerGhlInput
): Promise<PartnerGhlResult> {
  const empty: PartnerGhlResult = { synced: false, contactId: null, wroteFields: [] };

  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) {
    console.warn("[partner-ghl] GHL_LOCATION_ID not set — skipping CRM sync");
    return { ...empty, skipReason: "no GHL_LOCATION_ID" };
  }

  const email = (partner.email ?? "").trim().toLowerCase();
  if (!email) {
    // Expected for most of the roster: partners imported as name + slug only.
    // preparePartnerInvites is how emails get attached.
    return { ...empty, skipReason: "no email on file" };
  }

  try {
    const { partnerLinkFieldId, dashboardFieldId } = await resolveFieldIds(locationId);

    const referralUrl = partner.slug ? partnerReferralUrl(partner.slug) : null;
    // Lands on /partner/welcome, which forwards straight through to the
    // dashboard once they've set a password — so ONE link works for a partner
    // who has never activated and for one who signed in yesterday.
    const dashboardUrl = await generatePartnerPortalMagicLink(email);

    const wroteFields: string[] = [];
    const customFields: Array<{ id: string; value: string }> = [];
    if (partnerLinkFieldId && referralUrl) {
      customFields.push({ id: partnerLinkFieldId, value: referralUrl });
      wroteFields.push("referral_partner_link");
    }
    if (dashboardFieldId && dashboardUrl) {
      customFields.push({ id: dashboardFieldId, value: dashboardUrl });
      wroteFields.push("referral_dashboard_link");
    }

    const [firstName, ...restName] = (partner.name || "").trim().split(/\s+/);
    const contact = {
      firstName: firstName || partner.name,
      lastName: restName.join(" ") || null,
      name: (partner.name || "").trim() || email,
      email,
      phone: partner.phone || undefined,
      companyName: partner.company || undefined,
      country: "US",
      locationId,
      // Both tags on invite: the durable "referral partner" marker and the tier
      // the welcome automation branches on.
      tags: partner.tier ? [PARTNER_TAG, PARTNER_TIER_TAGS[partner.tier]] : [PARTNER_TAG],
      ...(customFields.length ? { customFields } : {}),
    };

    let contactId: string | null = null;
    try {
      contactId = await ghlUpsertContact({ ...contact, type: PARTNER_CONTACT_TYPE });
    } catch (typeErr) {
      // Same lesson the affiliate push learned: don't lose the contact over a
      // contact-type value this location doesn't define. The tag is what the
      // CRM segments on.
      console.error(
        `[partner-ghl] GHL rejected contact type "${PARTNER_CONTACT_TYPE}" — retrying without it. ` +
          `Set GHL_PARTNER_CONTACT_TYPE to the value this location stores for Referral Partner.`,
        typeErr
      );
      contactId = await ghlUpsertContact(contact);
    }

    if (!contactId) {
      return { ...empty, error: "GHL upsert returned no contact id" };
    }

    // Promotion: a partner invited to the deal desk should no longer match a
    // tier-1 segment. Separate and best-effort — the upsert above already
    // carries the tag that matters, and a stale opposite tag must not report
    // the sync as failed.
    if (partner.tier) {
      const { remove } = partnerTierTags(partner.tier);
      try {
        await ghlRemoveTags(contactId, [remove]);
      } catch (tagErr) {
        console.warn(`[partner-ghl] could not remove "${remove}" from ${contactId}:`, tagErr);
      }
    }


    return { synced: true, contactId, wroteFields };
  } catch (err: any) {
    console.error(`[partner-ghl] sync failed for ${email}:`, err);
    return { ...empty, error: err?.message || String(err) };
  }
}

/**
 * Re-stamp both fields on a contact we already know the id of. Used by the cron
 * on its happy path — one PUT instead of an upsert round trip.
 *
 * Adds PARTNER_TAG too: it is add-only and durable, so this is how partners who
 * existed in GHL before the vault ever knew about them pick it up.
 *
 * TIER-BLIND, and the cron passes no tier on purpose (admin decision,
 * 2026-09-22): the existing roster is being tagged by hand, and a tier tag is a
 * live workflow trigger — a weekly sweep across 100+ contacts would fire the
 * tier welcome at partners onboarded months ago. Tier tags are written only by
 * the two deliberate, reviewed actions: the invite and the deal-desk promotion.
 */
export async function refreshPartnerLinkFields(
  contactId: string,
  partner: PartnerGhlInput
): Promise<PartnerGhlResult> {
  const empty: PartnerGhlResult = { synced: false, contactId, wroteFields: [] };

  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) return { ...empty, skipReason: "no GHL_LOCATION_ID" };

  const email = (partner.email ?? "").trim().toLowerCase();
  if (!email) return { ...empty, skipReason: "no email on file" };

  try {
    const { partnerLinkFieldId, dashboardFieldId } = await resolveFieldIds(locationId);

    const referralUrl = partner.slug ? partnerReferralUrl(partner.slug) : null;
    const dashboardUrl = await generatePartnerPortalMagicLink(email);

    const wroteFields: string[] = [];
    const customFields: Array<{ id: string; value: string }> = [];
    if (partnerLinkFieldId && referralUrl) {
      customFields.push({ id: partnerLinkFieldId, value: referralUrl });
      wroteFields.push("referral_partner_link");
    }
    if (dashboardFieldId && dashboardUrl) {
      customFields.push({ id: dashboardFieldId, value: dashboardUrl });
      wroteFields.push("referral_dashboard_link");
    }

    if (!customFields.length) {
      return { ...empty, skipReason: "no field ids resolved and nothing to write" };
    }

    await ghlUpdateContact(contactId, { customFields } as any);

    // Best-effort and separate: a tag failure must not make a successful field
    // refresh report as failed.
    try {
      await syncPartnerTags(contactId, partner.tier);
    } catch (tagErr) {
      console.warn(`[partner-ghl] tag add failed for ${contactId}:`, tagErr);
    }

    return { synced: true, contactId, wroteFields };
  } catch (err: any) {
    console.error(`[partner-ghl] refresh failed for ${contactId}:`, err);
    return { ...empty, error: err?.message || String(err) };
  }
}
