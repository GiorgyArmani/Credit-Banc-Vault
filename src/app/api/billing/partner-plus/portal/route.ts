// src/app/api/billing/partner-plus/portal/route.ts
//
// Opens the Stripe Billing Portal for the signed-in Partner+ rep: update card,
// see invoices, cancel. No card UI is built here and no card data touches our
// servers. Deliberately reachable while LOCKED (src/proxy.ts lets /api/billing/
// through) — this is how a frozen rep unfreezes.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const db = createAdminClient();
  const { data: userRow } = await db.from("users").select("role").eq("id", user.id).maybeSingle();
  if (userRow?.role !== "partner_plus") {
    return NextResponse.json({ error: "Partner+ accounts only" }, { status: 403 });
  }

  const { data: row } = await db
    .from("external_advisors")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row?.stripe_customer_id) {
    // A comped (billing_exempt) account has no Stripe customer at all.
    return NextResponse.json({ error: "No billing account on file." }, { status: 404 });
  }

  // Back to the site the rep is on (local, preview or prod), not the env default.
  const appUrl = new URL(req.url).origin;
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${appUrl}/desk/billing`,
      // Optional: a portal configuration created by scripts/stripe-setup-partner-plus.mts.
      // Without it Stripe uses the account's default configuration.
      ...(process.env.STRIPE_PORTAL_CONFIGURATION_ID
        ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID }
        : {}),
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing-portal] session create failed:", err);
    return NextResponse.json({ error: "Could not open billing. Try again." }, { status: 502 });
  }
}
