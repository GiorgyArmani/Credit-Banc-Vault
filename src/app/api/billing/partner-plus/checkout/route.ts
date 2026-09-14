// src/app/api/billing/partner-plus/checkout/route.ts
//
// PUBLIC. Starts a Partner+ subscription: validates the signup form, creates a
// Stripe Customer carrying the rep's identity in metadata, and returns a
// Stripe-hosted Checkout URL. No account exists until the card clears — the
// webhook provisions it (src/lib/partner-plus-billing.ts). An abandoned
// checkout therefore leaves nothing in our database.
//
// No sales tax is collected (decided 2026-09-14), so no automatic_tax.
// Never pass payment_method_types: payment methods come from the Dashboard.

import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { formatPhoneUS, isValidUsPhone } from "@/lib/phone";
import { getStripe, partnerPlusPriceId } from "@/lib/stripe";
import { findEmailConflict, PARTNER_PLUS_PROGRAM } from "@/lib/partner-plus-billing";

const SignupSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(80),
  last_name: z.string().trim().min(1, "Last name is required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  phone: z.string().trim().refine(isValidUsPhone, "Enter a valid 10-digit US phone number"),
  company_name: z.string().trim().max(160).optional().default(""),
});

/** Checkout-flow label for the Dashboard, with the required 8-letter suffix. */
function integrationIdentifier(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.randomBytes(8);
  return `partner-plus-${Array.from(bytes, (b) => letters[b % letters.length]).join("")}`;
}

export async function POST(req: Request) {
  const { allowed } = await checkRateLimit(req, RATE_LIMITS.partnerPlusCheckout);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again in an hour." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the form and try again." },
      { status: 400 }
    );
  }
  const { first_name, last_name, email, company_name } = parsed.data;
  const phone = formatPhoneUS(parsed.data.phone);

  // Refuse BEFORE the card is taken. The webhook re-checks (two tabs can race),
  // but a rep should never have to be refunded for a typo'd existing email.
  const conflict = await findEmailConflict(email);
  if (conflict) {
    return NextResponse.json(
      { error: `${conflict} Use a different email, or contact us if this is you.` },
      { status: 409 }
    );
  }

  // Return the rep to the site they started on, not NEXT_PUBLIC_APP_URL: that
  // env points at production, so a local or preview checkout was bouncing to a
  // prod deployment without these routes (and into its login redirect).
  const appUrl = new URL(req.url).origin;
  try {
    const stripe = getStripe();
    const customer = await stripe.customers.create({
      email,
      name: `${first_name} ${last_name}`,
      phone,
      metadata: { program: PARTNER_PLUS_PROGRAM, first_name, last_name, phone, company_name },
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: partnerPlusPriceId(), quantity: 1 }],
      metadata: { program: PARTNER_PLUS_PROGRAM },
      subscription_data: { metadata: { program: PARTNER_PLUS_PROGRAM } },
      integration_identifier: integrationIdentifier(),
      success_url: `${appUrl}/partner-plus/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/partner-plus?canceled=1`,
    });

    if (!session.url) throw new Error("Checkout session has no URL");
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[partner-plus-checkout] failed:", err);
    return NextResponse.json(
      { error: "We couldn't start checkout. Please try again." },
      { status: 502 }
    );
  }
}
