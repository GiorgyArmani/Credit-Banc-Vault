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
//   3. sign a W-9 and 4. upload a voided check — commission money flows to them
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
  /** At least one onboarding step still outstanding. */
  requires_onboarding: boolean;
}

// One literal: PostgREST's typings parse the select string at compile time.
const EXTERNAL_ADVISOR_COLUMNS = `id, user_id, first_name, last_name, email, phone, company_name, password_set_at, active, billing_exempt, subscription_status, current_period_end, cancel_at_period_end, stripe_customer_id, ${COMPLIANCE_COLUMNS}`;

function decorate(row: Record<string, unknown>): ExternalAdvisorOnboardingState {
  const r = row as unknown as Omit<ExternalAdvisorOnboardingState, "name" | "requires_onboarding">;
  return {
    ...r,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || r.email,
    requires_onboarding: !r.onboarding_completed_at,
  };
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
  return data ? decorate(data as Record<string, unknown>) : null;
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
  if (!isValidUsPhone(data.phone)) return { completed: false, error: "Add a contact phone number to finish." };
  if (!data.w9_signed_at) return { completed: false, error: "Your W-9 isn't signed yet." };
  if (!data.voided_check_path) return { completed: false, error: "Upload a voided check to finish." };

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
