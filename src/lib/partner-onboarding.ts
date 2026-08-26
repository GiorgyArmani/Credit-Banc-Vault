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
// Same shape as the client's own onboarding — a SignWell signing step, then a
// document step — and the same Embed SDK, never an iframe
// ([[signwell_embed_and_business_contract_sync]]).
//
// EVERYTHING HERE IS SERVICE-ROLE. referral_partners is RLS-locked with zero
// policies ([[referral_partners_db_backed]]), so the partner never selects
// their own row; the server hands the screen exactly what it needs.

import { createAdminClient } from "@/lib/supabase/admin";
import { signWell } from "@/lib/signwell";
import { formatPhoneUS, isValidUsPhone } from "@/lib/phone";

/**
 * The PRIVATE bucket, deliberately not `user-documents`.
 *
 * `user-documents` is a PUBLIC bucket: anything in it is readable by anyone
 * holding the path, with no auth. A W-9 carries an SSN or EIN and a voided
 * check carries a routing and account number, so neither may live there. Reads
 * go through short-lived signed URLs minted below.
 */
export const PARTNER_DOC_BUCKET = "vault";
export const PARTNER_DOC_PREFIX = "partner-onboarding";
/** Long enough to open and read, short enough that a copied URL is worthless. */
export const PARTNER_DOC_TTL_SECONDS = 60 * 10;

/** What the voided-check step will accept. Deliberately narrow. */
export const VOIDED_CHECK_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
];
export const VOIDED_CHECK_MAX_BYTES = 15 * 1024 * 1024; // 15MB

/**
 * The partner row the onboarding screens work against.
 *
 * `requires_onboarding` is the one thing callers should branch on. It is true
 * only for a partner whose deal desk is on and whose paperwork is outstanding —
 * a plain referral_partner has no compliance onboarding at all, and a partner
 * who finished (or was grandfathered by migration 20260825) is done forever.
 */
export interface PartnerOnboardingState {
  id: string;
  name: string;
  email: string | null;
  /** Contact number the client portal shows on their advisor's card. */
  phone: string | null;
  user_id: string | null;
  portal_enabled: boolean;
  deal_desk_enabled: boolean;
  password_set_at: string | null;
  w9_document_id: string | null;
  w9_contract_url: string | null;
  w9_signed_at: string | null;
  voided_check_path: string | null;
  voided_check_filename: string | null;
  voided_check_uploaded_at: string | null;
  onboarding_completed_at: string | null;
  /** deal desk on, and at least one onboarding step still outstanding. */
  requires_onboarding: boolean;
}

// One literal, not a concatenation: PostgREST's typings parse the select string
// at compile time, and a built-up string degrades the result to an error union.
const PARTNER_ONBOARDING_COLUMNS =
  "id, name, email, phone, user_id, portal_enabled, deal_desk_enabled, password_set_at, w9_document_id, w9_contract_url, w9_signed_at, voided_check_path, voided_check_filename, voided_check_uploaded_at, onboarding_completed_at";

function decorate(row: Record<string, unknown>): PartnerOnboardingState {
  const partner = row as unknown as Omit<PartnerOnboardingState, "requires_onboarding">;
  return {
    ...partner,
    requires_onboarding:
      partner.deal_desk_enabled === true && !partner.onboarding_completed_at,
  };
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
  return data ? decorate(data) : null;
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

/**
 * Create (or resume) the partner's W-9 in SignWell.
 *
 * Resuming matters: `w9_document_id` is the idempotency key, so a partner who
 * reloads mid-signing lands back on the SAME document. Without it every reload
 * would mint another envelope, leaving orphans in the SignWell account and a
 * signed copy of whichever one they happened to finish.
 *
 * NOTHING IS PREFILLED, on purpose. The template's fields come back from the
 * API as bare positional ids (`TextField_1`… `CheckBox_8`) with empty labels —
 * there is no way to know which box is the TIN and which is the entity
 * classification without guessing at coordinates on a tax form. A wrong TIN or
 * a wrong entity checkbox on a W-9 is worse than an empty one, so the partner
 * fills their own.
 */
export async function ensurePartnerW9Document(
  partner: PartnerOnboardingState
): Promise<{ url: string } | { error: string }> {
  if (partner.w9_contract_url) return { url: partner.w9_contract_url };

  const templateId = process.env.SIGNWELL_W9_TEMPLATE_ID;
  if (!templateId) {
    console.error("[partner-onboarding] SIGNWELL_W9_TEMPLATE_ID is not set");
    return { error: "W-9 signing isn't configured yet. Contact support." };
  }

  const email = (partner.email || "").trim().toLowerCase();
  if (!email) {
    return { error: "This partner has no email address on file." };
  }

  try {
    const { signingUrl, embeddedSigningUrl, documentId } = await signWell.createDocument({
      templateId,
      recipientEmail: email,
      recipientName: partner.name,
      fields: {},
    });

    // Same `?doc_id=` convention as the client contract URL — it is what lets
    // the browser hand the document id back on completion without a round trip.
    const base = embeddedSigningUrl || signingUrl;
    const url = `${base}${base.includes("?") ? "&" : "?"}doc_id=${documentId}`;

    const db = createAdminClient();
    const { error } = await db
      .from("referral_partners")
      .update({
        w9_document_id: documentId,
        w9_contract_url: url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", partner.id);

    if (error) {
      // The document exists in SignWell either way. Returning the URL lets them
      // sign now; the miss is that a reload mints a second envelope.
      console.error("[partner-onboarding] could not persist W-9 url:", error);
    }

    return { url };
  } catch (err) {
    console.error("[partner-onboarding] SignWell W-9 creation failed:", err);
    return { error: "Could not open the W-9 for signing. Try again in a moment." };
  }
}

/**
 * Ask SignWell whether the W-9 is signed, and record it if so.
 *
 * Called on every load of the onboarding screen and again when the embed fires
 * `completed`. That is the whole backstop: no webhook is wired for this
 * document, because the partner is sitting in the browser when they sign, and a
 * partner who closed the tab mid-signature gets picked up by the next load.
 *
 * Storing the PDF is best-effort. SignWell holds the original regardless, and
 * blocking a partner from their portal because our copy failed to download
 * helps nobody — the signature is what the gate is about.
 */
export async function syncPartnerW9(
  partner: PartnerOnboardingState
): Promise<{ signed: boolean; error?: string }> {
  if (partner.w9_signed_at) return { signed: true };
  if (!partner.w9_document_id) return { signed: false };

  const db = createAdminClient();

  let status: string | undefined;
  try {
    const doc = await signWell.getDocument(partner.w9_document_id);
    status = doc?.status;
  } catch (err) {
    console.error("[partner-onboarding] SignWell status check failed:", err);
    return { signed: false, error: "Could not reach SignWell. Try again in a moment." };
  }

  // SignWell reports the DOCUMENT status title-cased ("Completed") while the
  // per-recipient status is lower-case. Compare case-insensitively or a signed
  // W-9 polls forever.
  if (status?.toLowerCase() !== "completed") return { signed: false };

  let filePath: string | null = null;
  try {
    const { blob } = await signWell.getCompletedPDF({
      documentId: partner.w9_document_id,
      urlOnly: false,
    });
    if (blob) {
      const path = `${PARTNER_DOC_PREFIX}/${partner.id}/w9_${Date.now()}.pdf`;
      const { error: uploadErr } = await db.storage
        .from(PARTNER_DOC_BUCKET)
        .upload(path, await blob.arrayBuffer(), {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadErr) {
        console.error("[partner-onboarding] W-9 PDF upload failed:", uploadErr);
      } else {
        filePath = path;
      }
    }
  } catch (err) {
    console.error("[partner-onboarding] W-9 PDF fetch failed (non-fatal):", err);
  }

  const { error } = await db
    .from("referral_partners")
    .update({
      w9_signed_at: new Date().toISOString(),
      ...(filePath ? { w9_file_path: filePath } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", partner.id);

  if (error) {
    console.error("[partner-onboarding] could not stamp w9_signed_at:", error);
    return { signed: false, error: "Signed, but we couldn't record it. Try again." };
  }

  return { signed: true };
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
export async function signedPartnerDocUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const db = createAdminClient();
  const { data, error } = await db.storage
    .from(PARTNER_DOC_BUCKET)
    .createSignedUrl(path, PARTNER_DOC_TTL_SECONDS);
  if (error) {
    console.error("[partner-onboarding] signed URL failed:", error);
    return null;
  }
  return data?.signedUrl ?? null;
}
