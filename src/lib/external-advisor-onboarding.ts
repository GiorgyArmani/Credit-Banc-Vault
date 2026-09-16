// src/lib/external-advisor-onboarding.ts
//
// Compliance onboarding for Partner+ reps — paying external advisors
// (docs/superpowers/specs/2026-09-08-partner-plus-design.md).
//
// Before the desk opens a rep must:
//   1. choose a password (they arrive on a magic link; the account was created
//      by the Stripe webhook with a random password nobody saw)
//   2. give a contact phone number — a PRODUCT requirement: they are the advisor
//      of record, and the client portal puts that number on the contact card
//   3. add a profile photo — same reasoning as the phone, and REQUIRED for the
//      same reason staff-profile.ts exists: while it was optional it was skipped
//      every time, leaving every one of their borrowers looking at a grey
//      initials circle on the "Your Advisor" card
//   4. sign a W-9 and 5. upload a voided check — commission money flows to them
//
// The photo is the one artifact that does NOT live on external_advisors: it is
// advisors.profile_pic_url on the Partner+ mirror row, which is what
// components/advisor-display.tsx already renders. Kept there rather than
// mirrored onto external_advisors so there is one source of truth for a face.
//
// Steps 3–4 are the same two documents partners and internal advisors owe, so
// the SignWell / storage / webhook mechanics live once in
// compliance-onboarding.ts, keyed by table. This module mirrors
// partner-onboarding.ts: finding the row for a login, the phone step, and what
// "finished" means.
//
// EVERYTHING HERE IS SERVICE-ROLE. external_advisors is RLS-locked with zero
// policies; callers resolve the row from the SESSION, never from a client id.

import { createAdminClient } from "@/lib/supabase/admin";
import { formatPhoneUS, isValidUsPhone } from "@/lib/phone";
import {
  backfillW9Pdf,
  COMPLIANCE_COLUMNS,
  ensureW9Document,
  signedComplianceDocUrl,
  storeVoidedCheck,
  syncW9,
  type ComplianceFields,
  type ComplianceSubject,
} from "@/lib/compliance-onboarding";

export interface ExternalAdvisorOnboardingState extends ComplianceFields {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  password_set_at: string | null;
  active: boolean;
  billing_exempt: boolean;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  /** advisors.profile_pic_url from the Partner+ mirror row, not this table. */
  profile_pic_url: string | null;
  /** At least one onboarding step still outstanding. */
  requires_onboarding: boolean;
}

/**
 * The artifacts a rep owes before the desk opens, in the order the wizard asks
 * for them. `password` is deliberately absent: the wizard sequences it first,
 * but the server gate has never required it — they are already authenticated by
 * the magic link, and hard-gating it would strand a rep whose password update
 * failed after their paperwork was accepted.
 */
export type OnboardingRequirement = "phone" | "photo" | "w9" | "check";

/** What a rep is told when the server refuses to open the desk. */
export const ONBOARDING_REQUIREMENT_MESSAGE: Record<OnboardingRequirement, string> = {
  phone: "Add a contact phone number to finish.",
  photo: "Add a profile photo to finish.",
  w9: "Your W-9 isn't signed yet.",
  check: "Upload a voided check to finish.",
};

/**
 * The single definition of "finished" — pure, so the wizard's order and the
 * server's refusal can never drift apart. Returns the EARLIEST outstanding
 * requirement in wizard order, or null when the desk can open.
 */
export function missingOnboardingRequirement(row: {
  phone: string | null;
  profile_pic_url: string | null;
  w9_signed_at: string | null;
  voided_check_path: string | null;
}): OnboardingRequirement | null {
  if (!isValidUsPhone(row.phone)) return "phone";
  if (!row.profile_pic_url?.trim()) return "photo";
  if (!row.w9_signed_at) return "w9";
  if (!row.voided_check_path) return "check";
  return null;
}

// One literal: PostgREST's typings parse the select string at compile time.
const EXTERNAL_ADVISOR_COLUMNS = `id, user_id, first_name, last_name, email, phone, company_name, password_set_at, active, billing_exempt, subscription_status, current_period_end, cancel_at_period_end, stripe_customer_id, ${COMPLIANCE_COLUMNS}`;

function decorate(
  row: Record<string, unknown>,
  profilePicUrl: string | null
): ExternalAdvisorOnboardingState {
  const r = row as unknown as Omit<
    ExternalAdvisorOnboardingState,
    "name" | "requires_onboarding" | "profile_pic_url"
  >;
  return {
    ...r,
    profile_pic_url: profilePicUrl,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.email,
    // The completion stamp is the authority, NOT a live re-check of the four
    // artifacts: a rep whose photo is later replaced or removed must not be
    // thrown back into the wizard with a desk full of live deals behind it.
    requires_onboarding: !r.onboarding_completed_at,
  };
}

/** The photo lives on the advisors mirror; read it by the FK we set ourselves. */
async function readMirrorPhoto(
  db: ReturnType<typeof createAdminClient>,
  externalAdvisorId: string
): Promise<string | null> {
  const { data, error } = await db
    .from("advisors")
    .select("profile_pic_url")
    .eq("external_advisor_id", externalAdvisorId)
    .maybeSingle();
  if (error) {
    console.error("[external-advisor-onboarding] mirror photo read failed:", error.message);
    return null;
  }
  return (data?.profile_pic_url as string | null) ?? null;
}

function toSubject(advisor: ExternalAdvisorOnboardingState): ComplianceSubject {
  return { ...advisor, table: "external_advisors" };
}

/** The Partner+ row for a logged-in user, or null if this login isn't one. */
export async function getExternalAdvisorState(
  userId: string
): Promise<ExternalAdvisorOnboardingState | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("external_advisors")
    .select(EXTERNAL_ADVISOR_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[external-advisor-onboarding] state read failed:", error.message);
    return null;
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return decorate(row, await readMirrorPhoto(db, row.id as string));
}

/** Record that the rep chose their own password (Supabase can't tell us). */
export async function stampExternalAdvisorPasswordSet(id: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("external_advisors")
    .update({ password_set_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[external-advisor-onboarding] password stamp failed:", error);
}

/**
 * Record the rep's contact number — on their row AND their advisors mirror,
 * because the client portal reads the advisors record. Same two-write reasoning
 * as savePartnerPhone.
 */
export async function saveExternalAdvisorPhone(
  advisor: ExternalAdvisorOnboardingState,
  rawPhone: string
): Promise<{ success: boolean; phone?: string; error?: string }> {
  if (!isValidUsPhone(rawPhone)) {
    return { success: false, error: "Enter a valid 10-digit US phone number." };
  }
  const phone = formatPhoneUS(rawPhone);
  const db = createAdminClient();

  const { error } = await db
    .from("external_advisors")
    .update({ phone, updated_at: new Date().toISOString() })
    .eq("id", advisor.id);
  if (error) {
    console.error("[external-advisor-onboarding] could not save phone:", error);
    return { success: false, error: "Could not save your number. Try again." };
  }

  const { error: mirrorErr } = await db
    .from("advisors")
    .update({ phone, updated_at: new Date().toISOString() })
    .eq("external_advisor_id", advisor.id);
  if (mirrorErr) console.error("[external-advisor-onboarding] advisors phone mirror failed:", mirrorErr);

  return { success: true, phone };
}

export async function ensureExternalAdvisorW9Document(
  advisor: ExternalAdvisorOnboardingState
): Promise<{ url: string } | { error: string }> {
  return ensureW9Document(toSubject(advisor));
}

export async function syncExternalAdvisorW9(
  advisor: ExternalAdvisorOnboardingState
): Promise<{ signed: boolean; error?: string }> {
  return syncW9(toSubject(advisor));
}

export async function storeExternalAdvisorVoidedCheck(
  advisor: Pick<ExternalAdvisorOnboardingState, "id">,
  file: File
): Promise<{ success: boolean; error?: string }> {
  return storeVoidedCheck({ id: advisor.id, table: "external_advisors" }, file);
}

/**
 * Stamp the gate open once every step is done. Re-reads the row: this is the
 * one write that opens the desk.
 */
export async function completeExternalAdvisorOnboardingIfReady(
  id: string
): Promise<{ completed: boolean; error?: string }> {
  const db = createAdminClient();
  const { data, error: readErr } = await db
    .from("external_advisors")
    .select("id, phone, w9_signed_at, voided_check_path, onboarding_completed_at")
    .eq("id", id)
    .maybeSingle();

  if (readErr || !data) return { completed: false, error: "Account not found." };
  if (data.onboarding_completed_at) return { completed: true };

  const missing = missingOnboardingRequirement({
    phone: data.phone,
    profile_pic_url: await readMirrorPhoto(db, id),
    w9_signed_at: data.w9_signed_at,
    voided_check_path: data.voided_check_path,
  });
  if (missing) return { completed: false, error: ONBOARDING_REQUIREMENT_MESSAGE[missing] };

  const { error } = await db
    .from("external_advisors")
    .update({ onboarding_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("[external-advisor-onboarding] could not stamp completion:", error);
    return { completed: false, error: "Could not finish onboarding. Try again." };
  }
  return { completed: true };
}

/** Short-lived URL for admins to view a rep's W-9 or voided check. */
export const signedExternalAdvisorDocUrl = signedComplianceDocUrl;

/** Fetch a W-9 PDF copy SignWell had not rendered yet when we last asked. */
export async function backfillExternalAdvisorW9Pdf(id: string): Promise<string | null> {
  return backfillW9Pdf("external_advisors", id);
}
