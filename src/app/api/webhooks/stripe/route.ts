// src/app/api/webhooks/stripe/route.ts
//
// Stripe → Partner+ subscription state. Public (no session) via the
// /api/webhooks/ prefix in src/proxy.ts; authenticated by the signature.
//
// Events (configure exactly these on the endpoint / `stripe listen --events`):
//   checkout.session.completed               provision the account
//   checkout.session.async_payment_succeeded provision (delayed payment methods)
//   customer.subscription.updated|deleted    sync status
//   invoice.paid                             sync status (clears past-due)
//   invoice.payment_failed                   sync status + past-due email
//
// Two mechanical rules:
//   1. The RAW body is what's signed — req.text(), never req.json().
//   2. Idempotency: stripe_events is claimed BEFORE handling; a redelivery that
//      finds the id already there is a no-op. If handling throws, the claim is
//      released and we answer 500, so Stripe's retry actually retries instead
//      of being swallowed by our own guard.
//
// Handlers never trust payload ordering: they re-read the subscription from
// Stripe and write its CURRENT state (see syncSubscription).

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, stripeWebhookSecret } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  invoiceSubscriptionId,
  notifyPaymentFailed,
  provisionFromCheckoutSession,
  syncSubscription,
} from "@/lib/partner-plus-billing";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, stripeWebhookSecret());
  } catch (err) {
    console.warn("[stripe-webhook] signature verification failed:", (err as Error).message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: claimed, error: claimErr } = await db
    .from("stripe_events")
    .upsert({ id: event.id, type: event.type }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");

  if (claimErr) {
    console.error("[stripe-webhook] could not claim event:", claimErr.message);
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }
  if (!claimed?.length) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handle(event);
  } catch (err) {
    console.error(`[stripe-webhook] ${event.type} ${event.id} failed:`, err);
    await db.from("stripe_events").delete().eq("id", event.id);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handle(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await provisionFromCheckoutSession(event.data.object);
      return;

    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object.id);
      return;

    case "invoice.paid": {
      const subId = invoiceSubscriptionId(event.data.object);
      if (subId) await syncSubscription(subId);
      return;
    }

    case "invoice.payment_failed": {
      const subId = invoiceSubscriptionId(event.data.object);
      if (!subId) return;
      await syncSubscription(subId);
      await notifyPaymentFailed(subId);
      return;
    }

    default:
      // Not ours to handle. 200 so Stripe stops sending it.
      return;
  }
}
