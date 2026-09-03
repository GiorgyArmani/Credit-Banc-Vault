// src/lib/partner-onboarding.ts
//
// Compliance onboarding for partner_advisor — the referral partners who work
// their own deals through the deal desk.
//
// A plain referral_partner shares a link and we owe them a commission. A
// partner_advisor submits deals and gets paid on funded files, which makes them
// a payee we report on, so before the deal desk opens they must:
//
//   1. Give us a contact phone number
//   2. Sign a W-9 (SignWell, SIGNWELL_W9_TEMPLATE_ID)
//   3. Upload a voided business check, so the commission has somewhere to land
//
// The phone number is the odd one out — it is not a compliance artifact, it is
// a PRODUCT requirement. A partner_advisor is the advisor of record on their
// clients' files, and the client portal shows the client who their advisor is
// and how to reach them. A deal desk with no number behind it hands the client
// a contact card with a blank on it.
//
// Steps 2 and 3 are the SAME two documents internal advisors now owe
// (advisor-onboarding.ts), so the SignWell / storage / webhook mechanics live
// once in compliance-onboarding.ts, keyed by table. This module owns what is
// partner-specific: finding the row for a login, the phone step, and what
// "finished" means for a partner.
//
// EVERYTHING HERE IS SERVICE-ROLE. referral_partners is RLS-locked with zero
// policies ([[referral_partners_db_backed]]), so the partner never selects
// their own row; the server hands the screen exactly what it needs.

import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhoneUS, isValidUsPhone } from "@/lib/phone";
import {
  COMPLIANCE_COLUMNS,
  COMPLIANCE_DOC_BUCKET,
  COMPLIANCE_DOC_PREFIX,
  COMPLIANCE_DOC_TTL_SECONDS,
  ensureW9Document,
  signedComplianceDocUrl,
  storeVoidedCheck,
  storeW9Pdf,
  syncW9,
  type ComplianceFields,
  type ComplianceSubject,
} from "@/lib/compliance-onboarding";

// Kept under their historical names for existing importers.
export { VOIDED_CHECK_MAX_BYTES, VOIDED_CHECK_MIME_TYPES } from "@/lib/compliance-onboarding";
export const PARTNER_DOC_BUCKET = COMPLIANCE_DOC_BUCKET;
export const PARTNER_DOC_PREFIX = COMPLIANCE_DOC_PREFIX.referral_partners;
export const PARTNER_DOC_TTL_SECONDS = COMPLIANCE_DOC_TTL_SECONDS;

/**
 * The partner row the onboarding screens work against.
 *
 * `requires_onboarding` is the one derived flag: the gate is meaningful only for
 * a partner whose deal desk is on and whose paperwork is outstanding — a plain
 * referral_partner has no compliance onboarding at all, and a partner who
 * finished (or was grandfathered by migration 20260825) is done forever.
 */
export interface PartnerOnboardingState extends ComplianceFields {
  id: string;
  name: string;
  email: string | null;
  /** Contact number the client portal shows on their advisor's card. */
  phone: string | null;
  user_id: string | null;
  portal_enabled: boolean;
  deal_desk_enabled: boolean;
  password_set_at: string | null;
  /** deal desk on, and at least one onboarding step still outstanding. */
  requires_onboarding: boolean;
}

// One literal, not a concatenation: PostgREST's typings parse the select string
// at compile time, and a built-up string degrades the result to an error union.
const PARTNER_ONBOARDING_COLUMNS = `id, name, email, phone, user_id, portal_enabled, deal_desk_enabled, password_set_at, ${COMPLIANCE_COLUMNS}`;

function decorate(row: Record<string, unknown>): PartnerOnboardingState {
  const partner = row as unknown as Omit<PartnerOnboardingState, "requires_onboarding">;
  return {
    ...partner,
    requires_onboarding:
      partner.deal_desk_enabled === true && !partner.onboarding_completed_at,
  };
}

function toSubject(partner: PartnerOnboardingState): ComplianceSubject {
  return { ...partner, table: "referral_partners" };
}

/** The partner row for a logged-in user, or null if this login isn't a partner. */
export async function getPartnerOnboardingState(
  userId: string
): Promise<PartnerOnboardingState | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("referral_partners")
    .select(PARTNER_ONBOARDING_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[partner-onboarding] state read failed:", error);
    return null;
  }
  return data ? decorate(data as Record<string, unknown>) : null;
}

/**
 * Record the partner's contact phone number.
 *
 * TWO WRITES, on purpose. `referral_partners.phone` is the partner record; the
 * client portal reads the ADVISOR record, and a partner_advisor has a mirrored
 * `advisors` row created when the deal desk was switched on (see
 * /admin/referral-partners actions). That mirror is populated from
 * `referral_partners.phone` at the moment of the toggle — which for an invited
 * partner is null, because nobody had asked them yet. Writing only the partner
 * row would leave the advisors row null forever and the client's contact card
 * blank, which is the entire reason this step exists.
 *
 * The advisors write is best-effort: it is scoped to this partner's own mirror
 * row, and a partner whose desk was never enabled has none. Failing the step
 * over a missing mirror would gate a partner out of their portal for a row they
 * cannot see or fix.
 *
 * Stored in the canonical display form ("(555) 123-4567") like every other
 * phone in the vault — comparisons elsewhere go through phoneKey(), so the
 * stored format never has to be exact ([[src/lib/phone.ts]]).
 */
export async function savePartnerPhone(
  partner: PartnerOnboardingState,
  rawPhone: string
): Promise<{ success: boolean; phone?: string; error?: string }> {
  if (!isValidUsPhone(rawPhone)) {
    return { success: false, error: "Enter a valid 10-digit US phone number." };
  }
  const phone = formatPhoneUS(rawPhone);

  const db = createAdminClient();
  const { error } = await db
    .from("referral_partners")
    .update({ phone, updated_at: new Date().toISOString() })
    .eq("id", partner.id);

  if (error) {
    console.error("[partner-onboarding] could not save phone:", error);
    return { success: false, error: "Could not save your number. Try again." };
  }

  if (partner.user_id) {
    const { error: mirrorErr } = await db
      .from("advisors")
      .update({ phone, updated_at: new Date().toISOString() })
      .eq("user_id", partner.user_id)
      .eq("referral_partner_id", partner.id);
    if (mirrorErr) {
      console.error("[partner-onboarding] advisors phone mirror failed:", mirrorErr);
    }
  }

  return { success: true, phone };
}

/** Create (or resume) the partner's W-9 in SignWell. See ensureW9Document. */
export async function ensurePartnerW9Document(
  partner: PartnerOnboardingState
): Promise<{ url: string } | { error: string }> {
  return ensureW9Document(toSubject(partner));
}

/** Pull our copy of the signed PDF into the vault bucket. See storeW9Pdf. */
export async function storePartnerW9Pdf(
  partner: Pick<PartnerOnboardingState, "id" | "w9_document_id" | "w9_file_path">,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<{ stored: boolean; path: string | null; error?: string }> {
  return storeW9Pdf({ ...partner, table: "referral_partners" }, opts);
}

/** Ask SignWell whether the W-9 is signed, and record it if so. See syncW9. */
export async function syncPartnerW9(
  partner: PartnerOnboardingState
): Promise<{ signed: boolean; error?: string }> {
  return syncW9(toSubject(partner));
}

/** Store the voided check for a partner. See storeVoidedCheck. */
export async function storePartnerVoidedCheck(
  partner: Pick<PartnerOnboardingState, "id">,
  file: File
): Promise<{ success: boolean; error?: string }> {
  return storeVoidedCheck({ id: partner.id, table: "referral_partners" }, file);
}

/**
 * Stamp the gate open once EVERY step is done.
 *
 * Re-reads the row rather than trusting what the caller was handed: this is the
 * one write that opens the deal desk, and the state a screen was rendered with
 * can be minutes old.
 */
export async function completePartnerOnboardingIfReady(
  partnerId: string
): Promise<{ completed: boolean; error?: string }> {
  const db = createAdminClient();

  const { data, error: readErr } = await db
    .from("referral_partners")
    .select("id, phone, w9_signed_at, voided_check_path, onboarding_completed_at")
    .eq("id", partnerId)
    .maybeSingle();

  if (readErr || !data) return { completed: false, error: "Partner not found." };
  if (data.onboarding_completed_at) return { completed: true };

  if (!isValidUsPhone(data.phone)) {
    return { completed: false, error: "Add a contact phone number to finish." };
  }
  if (!data.w9_signed_at) return { completed: false, error: "Your W-9 isn't signed yet." };
  if (!data.voided_check_path) {
    return { completed: false, error: "Upload a voided check to finish." };
  }

  const { error } = await db
    .from("referral_partners")
    .update({
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", partnerId);

  if (error) {
    console.error("[partner-onboarding] could not stamp completion:", error);
    return { completed: false, error: "Could not finish onboarding. Try again." };
  }

  return { completed: true };
}

/** Short-lived URL for staff to view a partner's W-9 or voided check. */
export const signedPartnerDocUrl = signedComplianceDocUrl;
