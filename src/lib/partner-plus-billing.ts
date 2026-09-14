// src/lib/partner-plus-billing.ts
//
// Partner+ billing state: provisioning a paid signup, mirroring the Stripe
// subscription onto external_advisors, and the access predicate the freeze runs
// on. SERVER ONLY, service role throughout.
//
// Spec: docs/superpowers/specs/2026-09-08-partner-plus-design.md.

import crypto from "crypto";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeDashboardCustomerUrl } from "@/lib/stripe";
import { generateDeskMagicLink } from "@/lib/magic-link";
import {
  send_partner_plus_payment_failed_email,
  send_partner_plus_provisioning_error_notification,
  send_partner_plus_welcome_email,
} from "@/lib/partner-plus-email";

/** Tag on every Stripe object we create, so the webhook ignores anything else in the account. */
export const PARTNER_PLUS_PROGRAM = "partner_plus";

// ── Access ──────────────────────────────────────────────────────────────────

/**
 * Statuses that keep the desk open. past_due PASSES: Stripe retries for about
 * two weeks before giving up, and an expired card should not cost a producing
 * rep their desk over a weekend. Locks at unpaid / canceled / incomplete /
 * incomplete_expired / paused / NULL.
 *
 * MUST match private.partner_plus_has_access() in migration 20260914.
 */
export const DESK_ACCESS_STATUSES = ["active", "trialing", "past_due"] as const;

export interface DeskAccessFields {
  active: boolean;
  billing_exempt: boolean;
  subscription_status: string | null;
}

export function hasDeskAccess(row: DeskAccessFields | null | undefined): boolean {
  if (!row || !row.active) return false;
  if (row.billing_exempt) return true;
  return (DESK_ACCESS_STATUSES as readonly string[]).includes(row.subscription_status ?? "");
}

/** Open, but the card failed — show the banner. */
export function isPastDue(row: DeskAccessFields | null | undefined): boolean {
  return !!row && row.active && !row.billing_exempt && row.subscription_status === "past_due";
}

// ── Email conflicts ─────────────────────────────────────────────────────────

/** ilike treats % and _ as wildcards; an email is matched literally. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Why this email can't become a Partner+ login, or null if it can.
 *
 * Checked at checkout (before the card) and again at provisioning (two tabs can
 * race). `advisors.email` is NOT NULL UNIQUE, so a collision there would fail
 * the mirror insert halfway through provisioning.
 */
export async function findEmailConflict(
  email: string,
  opts: { ignoreUserId?: string } = {}
): Promise<string | null> {
  const db = createAdminClient();
  const pattern = likeLiteral(email.trim());

  const { data: user } = await db.from("users").select("id").ilike("email", pattern).maybeSingle();
  if (user && user.id !== opts.ignoreUserId) return "That email already has a Credit Banc login.";

  const { data: advisor } = await db
    .from("advisors")
    .select("id, user_id")
    .ilike("email", pattern)
    .maybeSingle();
  if (advisor && (!opts.ignoreUserId || advisor.user_id !== opts.ignoreUserId)) {
    return "That email belongs to an existing advisor.";
  }

  return null;
}

// ── Subscription sync ───────────────────────────────────────────────────────

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/**
 * The subscription an invoice belongs to.
 *
 * On the pinned API version it lives under parent.subscription_details. But a
 * webhook payload is rendered in the ENDPOINT's API version, not the SDK's — the
 * account default here was 2020-08-27, where it is a top-level `subscription`.
 * Reading only the new path made invoice.paid / invoice.payment_failed silent
 * no-ops on an old-version endpoint, so both shapes are accepted.
 */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  return idOf(invoice.parent?.subscription_details?.subscription ?? legacy ?? null);
}

function subscriptionFields(sub: Stripe.Subscription) {
  // current_period_end moved from the subscription onto its items (basil+).
  const periodEnd = sub.items.data[0]?.current_period_end ?? null;
  return {
    subscription_status: sub.status,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end,
  };
}

/**
 * Write the subscription's CURRENT state onto its external_advisors row.
 *
 * Re-reads from Stripe instead of using the event payload: Stripe does not
 * guarantee delivery order, so an old `updated` landing after a newer one must
 * not roll the status back. A subscription with no row yet (events can beat
 * checkout.session.completed) is fine — provisioning reads the same state.
 */
export async function syncSubscription(subscriptionId: string): Promise<void> {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  if (sub.metadata?.program !== PARTNER_PLUS_PROGRAM) return;

  const db = createAdminClient();
  const { error } = await db
    .from("external_advisors")
    .update({ ...subscriptionFields(sub), updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscriptionId);
  if (error) throw new Error(`external_advisors sync failed: ${error.message}`);
}

/** Past-due email. Best-effort — a failed send must not make Stripe redeliver. */
export async function notifyPaymentFailed(subscriptionId: string): Promise<void> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("external_advisors")
    .select("first_name, email, user_id, billing_exempt")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (!row?.user_id || row.billing_exempt) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
  try {
    await send_partner_plus_payment_failed_email({
      first_name: row.first_name,
      email: row.email,
      billing_url: `${appUrl}/desk/billing`,
    });
  } catch (err) {
    console.error("[partner-plus] payment-failed email failed:", err);
  }
}

// ── Provisioning ────────────────────────────────────────────────────────────

export type ProvisionOutcome =
  | "skipped"
  | "not_paid"
  | "already_provisioned"
  | "provisioned"
  | "conflict";

/**
 * Turn a completed Partner+ checkout into an account.
 *
 * Order mirrors applyDealDesk (admin/referral-partners/actions.ts): users.role
 * drives is_advisor_user() in RLS, the advisors row is what
 * is_assigned_advisor_for() resolves through — both are required.
 *
 *   1. auth user (random password; entry is the magic link)
 *   2. users row, role = partner_plus
 *   3. external_advisors row (upsert on stripe_subscription_id)
 *   4. advisors mirror with external_advisor_id → is_external = true
 *   5. welcome email with the magic link
 *
 * RETRY-SAFE: any throw releases the event claim and Stripe redelivers. A
 * redelivery after a partial run resumes — the auth user it created is found by
 * email and recognised as ours (role partner_plus, no other desk), and every
 * later write is an upsert or guarded insert.
 *
 * A genuine email collision does NOT throw (a retry would never succeed): the
 * row is recorded with provisioning_error and admins are emailed, because this
 * person has paid.
 */
export async function provisionFromCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<ProvisionOutcome> {
  if (session.mode !== "subscription" || session.metadata?.program !== PARTNER_PLUS_PROGRAM) {
    return "skipped";
  }
  // Delayed payment methods complete the session before the money arrives;
  // checkout.session.async_payment_succeeded brings them back here once paid.
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return "not_paid";
  }

  const customerId = idOf(session.customer);
  const subscriptionId = idOf(session.subscription);
  if (!customerId || !subscriptionId) {
    throw new Error(`checkout ${session.id} has no customer/subscription`);
  }

  const db = createAdminClient();
  const stripe = getStripe();

  const { data: existing } = await db
    .from("external_advisors")
    .select("id, user_id")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (existing?.user_id) {
    await syncSubscription(subscriptionId);
    return "already_provisioned";
  }

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) throw new Error(`customer ${customerId} was deleted`);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const meta = customer.metadata ?? {};
  const email = (customer.email || session.customer_details?.email || "").trim().toLowerCase();
  if (!email) throw new Error(`customer ${customerId} has no email`);
  const firstName = (meta.first_name || "").trim() || email.split("@")[0];
  const lastName = (meta.last_name || "").trim() || firstName;
  const phone = (meta.phone || "").trim() || null;
  const companyName = (meta.company_name || "").trim() || null;
  const now = new Date().toISOString();

  const baseRow = {
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    company_name: companyName,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    ...subscriptionFields(subscription),
    updated_at: now,
  };

  // Resume a partial run: an auth user we already created for this checkout.
  let userId: string | null = null;
  const { data: priorUser } = await db
    .from("users")
    .select("id, role")
    .ilike("email", likeLiteral(email))
    .maybeSingle();
  if (priorUser?.role === "partner_plus") {
    const { data: otherDesk } = await db
      .from("external_advisors")
      .select("id")
      .eq("user_id", priorUser.id)
      .neq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (!otherDesk) userId = priorUser.id;
  }

  const conflict = await findEmailConflict(email, { ignoreUserId: userId ?? undefined });
  if (conflict) {
    await recordProvisioningError(baseRow, conflict);
    return "conflict";
  }

  if (!userId) {
    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      password: `Cb-${crypto.randomUUID()}`,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });
    if (createErr || !created?.user) {
      throw new Error(`auth user create failed: ${createErr?.message ?? "no user returned"}`);
    }
    userId = created.user.id;
  }

  const { error: userErr } = await db
    .from("users")
    .upsert(
      { id: userId, email, first_name: firstName, last_name: lastName, role: "partner_plus" },
      { onConflict: "id" }
    );
  if (userErr) throw new Error(`users upsert failed: ${userErr.message}`);

  const { data: ea, error: eaErr } = await db
    .from("external_advisors")
    .upsert(
      { ...baseRow, user_id: userId, provisioning_error: null },
      { onConflict: "stripe_subscription_id" }
    )
    .select("id")
    .single();
  if (eaErr || !ea) throw new Error(`external_advisors upsert failed: ${eaErr?.message}`);

  const { data: mirror } = await db
    .from("advisors")
    .select("id")
    .eq("external_advisor_id", ea.id)
    .maybeSingle();
  if (!mirror) {
    const { error: advErr } = await db.from("advisors").insert({
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      is_active: true,
      external_advisor_id: ea.id,
    });
    if (advErr) throw new Error(`advisors insert failed: ${advErr.message}`);
  }

  const magicLink = await generateDeskMagicLink(email);
  if (magicLink) {
    try {
      await send_partner_plus_welcome_email({ first_name: firstName, email, magic_link: magicLink });
    } catch (err) {
      // The account exists; a resend is an admin action, not a reason to
      // re-run provisioning.
      console.error("[partner-plus] welcome email failed:", err);
    }
  }

  console.log(`[partner-plus] provisioned ${email} (sub ${subscriptionId})`);
  return "provisioned";
}

async function recordProvisioningError(
  row: Record<string, unknown> & { email: string; first_name: string; last_name: string; company_name: string | null; stripe_customer_id: string },
  reason: string
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("external_advisors")
    .upsert({ ...row, provisioning_error: reason }, { onConflict: "stripe_subscription_id" });
  if (error) throw new Error(`could not record provisioning error: ${error.message}`);

  console.error(`[partner-plus] PAID signup not provisioned for ${row.email}: ${reason}`);

  const { data: admins } = await db.from("users").select("email").eq("role", "admin");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
  try {
    await send_partner_plus_provisioning_error_notification({
      admin_emails: (admins ?? []).map((a) => a.email).filter(Boolean),
      customer_name: `${row.first_name} ${row.last_name}`.trim(),
      customer_email: row.email,
      company_name: row.company_name ?? "",
      reason,
      admin_url: `${appUrl}/admin/partner-plus`,
      stripe_url: stripeDashboardCustomerUrl(row.stripe_customer_id),
    });
  } catch (err) {
    console.error("[partner-plus] provisioning-error notification failed:", err);
  }
}
