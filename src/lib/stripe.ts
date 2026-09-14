// src/lib/stripe.ts
//
// The one Stripe client. SERVER ONLY — it holds the secret key.
//
// STRIPE_SECRET_KEY should be a RESTRICTED key (rk_test_… / rk_live_…) scoped
// to exactly what Partner+ does: Customers write, Checkout Sessions write,
// Subscriptions read, Invoices read, Customer portal write, Prices read. A
// leaked restricted key can do far less than a leaked sk_.
//
// API version is pinned so a dashboard default bump never changes payload
// shapes under us. On this version (dahlia, and since basil):
//   - current_period_end lives on subscription ITEMS, not the subscription
//   - an invoice's subscription is invoice.parent.subscription_details.subscription

import Stripe from "stripe";

export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set — Partner+ billing is unavailable");
  client = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: { name: "credit-banc-vault" },
  });
  return client;
}

/** The $100/month Partner+ price (Dashboard-created, see scripts/stripe-setup-partner-plus.mts). */
export function partnerPlusPriceId(): string {
  const id = process.env.STRIPE_PRICE_PARTNER_PLUS_MONTHLY;
  if (!id) throw new Error("STRIPE_PRICE_PARTNER_PLUS_MONTHLY is not set");
  return id;
}

export function stripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return secret;
}

/** Dashboard link for staff, pointed at test or live data to match the key in use. */
export function stripeDashboardCustomerUrl(customerId: string): string {
  const key = process.env.STRIPE_SECRET_KEY || "";
  const testMode = key.startsWith("rk_test_") || key.startsWith("sk_test_");
  return `https://dashboard.stripe.com/${testMode ? "test/" : ""}customers/${customerId}`;
}
