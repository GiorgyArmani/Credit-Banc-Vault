// src/lib/advisor-onboarding.ts
//
// Compliance onboarding for INTERNAL advisors — the people invited from
// /admin/team who sign up through /auth/join.
//
// The invite link lands on /auth/advisor-signup, which is one wizard: create
// the account (name, phone, photo, password), then — signed in on the spot,
// same screen — the paperwork finance needs to pay an advisor on a funded
// file: a signed W-9 and a voided check. Those are the same two documents the
// partner deal desk gates on, so the mechanics — SignWell embed, PDF retry,
// webhook, private storage, admin preview — live once in
// compliance-onboarding.ts. This module owns the advisor-specific parts:
// finding the row for a login, and what "finished" means.
//
// Backstop in src/app/advisor/layout.tsx for anyone who closed the tab
// mid-way and signed in later: a TAKEOVER (the workspace is not rendered until
// both documents are in), never a redirect — a layout cannot read the
// pathname, so a redirect would loop on its own target.
//
// Who is gated: rows with referral_partner_id NULL (staff), and only those with
// onboarding_completed_at NULL. Migration 20260903 stamps every advisor who
// existed before it, so in practice only advisors who sign up after the
// migration meet the gate. Partner mirror rows are gated through
// referral_partners and are ignored here.
//
// PRE-MIGRATION SAFETY. Selecting the compliance columns before the migration
// is applied fails the whole query (42703). That is treated as "no onboarding
// state", which means NO gate — the portal keeps working exactly as before the
// feature existed, and the miss is logged. Never turn that into a hard error:
// it would lock every advisor out on deploy.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  COMPLIANCE_COLUMNS,
  ensureW9Document,
  signedComplianceDocUrl,
  storeVoidedCheck,
  syncW9,
  type ComplianceFields,
  type ComplianceSubject,
} from "@/lib/compliance-onboarding";

export interface AdvisorOnboardingState extends ComplianceFields {
  id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  /** NULL for staff; set on the mirror rows of partner advisors. */
  referral_partner_id: string | null;
  /** Staff advisor with at least one document still outstanding. */
  requires_onboarding: boolean;
}

const ADVISOR_ONBOARDING_COLUMNS = `id, user_id, first_name, last_name, email, referral_partner_id, ${COMPLIANCE_COLUMNS}`;

function decorate(row: Record<string, unknown>): AdvisorOnboardingState {
  const fields = row as unknown as ComplianceFields & {
    id: string;
    user_id: string | null;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    referral_partner_id: string | null;
  };
  return {
    ...fields,
    name: [fields.first_name, fields.last_name].filter(Boolean).join(" ").trim() || fields.email || "",
    requires_onboarding: !fields.referral_partner_id && !fields.onboarding_completed_at,
  };
}

function toSubject(advisor: AdvisorOnboardingState): ComplianceSubject {
  return { ...advisor, table: "advisors" };
}

/**
 * The advisor row for a logged-in user, or null if there is none — or if the
 * compliance columns don't exist yet (see the pre-migration note above).
 */
export async function getAdvisorOnboardingState(
  userId: string
): Promise<AdvisorOnboardingState | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("advisors")
    .select(ADVISOR_ONBOARDING_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[advisor-onboarding] state read failed (gate stays open):", error.message);
    return null;
  }
  return data ? decorate(data as Record<string, unknown>) : null;
}

export async function ensureAdvisorW9Document(
  advisor: AdvisorOnboardingState
): Promise<{ url: string } | { error: string }> {
  return ensureW9Document(toSubject(advisor));
}

export async function syncAdvisorW9(
  advisor: AdvisorOnboardingState
): Promise<{ signed: boolean; error?: string }> {
  return syncW9(toSubject(advisor));
}

export async function storeAdvisorVoidedCheck(
  advisor: Pick<AdvisorOnboardingState, "id">,
  file: File
): Promise<{ success: boolean; error?: string }> {
  return storeVoidedCheck({ id: advisor.id, table: "advisors" }, file);
}

/**
 * Stamp the gate open once both documents are in.
 *
 * Re-reads the row rather than trusting the screen that called it: this is the
 * one write that opens the workspace.
 */
export async function completeAdvisorOnboardingIfReady(
  advisorId: string
): Promise<{ completed: boolean; error?: string }> {
  const db = createAdminClient();
  const { data, error: readErr } = await db
    .from("advisors")
    .select("id, w9_signed_at, voided_check_path, onboarding_completed_at")
    .eq("id", advisorId)
    .maybeSingle();

  if (readErr || !data) return { completed: false, error: "Advisor not found." };
  if (data.onboarding_completed_at) return { completed: true };
  if (!data.w9_signed_at) return { completed: false, error: "Your W-9 isn't signed yet." };
  if (!data.voided_check_path) return { completed: false, error: "Upload a voided check to finish." };

  const { error } = await db
    .from("advisors")
    .update({
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", advisorId);
  if (error) {
    console.error("[advisor-onboarding] could not stamp completion:", error);
    return { completed: false, error: "Could not finish onboarding. Try again." };
  }
  return { completed: true };
}

/** Short-lived URL for admins to view an advisor's W-9 or voided check. */
export const signedAdvisorDocUrl = signedComplianceDocUrl;
