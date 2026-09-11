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
} from "@/lib/ghl-api";
import { generatePartnerPortalMagicLink } from "@/lib/magic-link";
import { partnerReferralUrl } from "@/lib/referral-partners";

/**
 * The durable "this is a referral partner" marker. Add-only and never removed
 * by the app, so re-running the cron can't re-trigger a one-time workflow —
 * which is exactly why it is a segment marker and not a `new …` trigger tag
 * like the affiliate program's.
 */
export const PARTNER_TAG = "referral partner";

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
      tags: [PARTNER_TAG],
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
 * Adds the tag too: it is add-only and durable, so this is how partners who
 * existed in GHL before the vault ever knew about them pick it up.
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
      await ghlAddTags(contactId, [PARTNER_TAG]);
    } catch (tagErr) {
      console.warn(`[partner-ghl] tag add failed for ${contactId}:`, tagErr);
    }

    return { synced: true, contactId, wroteFields };
  } catch (err: any) {
    console.error(`[partner-ghl] refresh failed for ${contactId}:`, err);
    return { ...empty, error: err?.message || String(err) };
  }
}
