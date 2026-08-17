// src/app/api/webhooks/ghl-appointment/route.ts
//
// PUBLIC (secret-authenticated) — GoHighLevel calls this when a contact books an
// appointment. Its only job is the affiliate program: if the person who booked
// came in through an affiliate link, tell that affiliate their link worked.
//
// WHY A WEBHOOK AT ALL. The pre-qual stepper at /r/[code] is ours and we know
// exactly when someone qualifies — but the booking that follows happens inside
// an embedded GHL calendar iframe (see components/affiliate-lead-form.tsx). The
// app never observes it. GHL is the only party that knows a slot was taken, so
// it has to tell us.
//
// WHY NOT FIRE ON PRE-QUAL INSTEAD. Qualifying is not booking. A meaningful
// share of qualified leads never pick a slot, and an email saying "someone
// booked a call" for a person who didn't is the kind of thing an affiliate
// notices exactly once before distrusting every later message.
//
// This is deliberately NOT folded into /api/webhooks/ghl-tags: that endpoint
// resolves contacts against client_data_vault and 404s when there is no vault,
// which is every affiliate lead — they have not signed up yet, they have only
// booked a call.
//
// GHL-SIDE SETUP (this endpoint does nothing until it exists):
//   Automation trigger "Appointment" → status Booked
//   → Webhook POST https://vault.creditbanc.io/api/webhooks/ghl-appointment
//   → body: { "contactId": "{{contact.id}}", "email": "{{contact.email}}",
//             "secret": "<GHL_WEBHOOK_SECRET>" }
//
// See [[affiliate_program]], [[ghl_integration_contract]].

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { send_affiliate_link_used_email } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GHL sends JSON, form-urlencoded, or JSON-in-a-string depending on how the
 *  automation was built. Same tolerance as /api/webhooks/ghl-tags. */
async function parseBody(request: Request): Promise<any> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await request.json();
  }
  const text = await request.text();
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
}

/** GHL/Zapier sometimes wrap values in quotes or pad them. */
function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  return trimmed || null;
}

export async function POST(request: Request) {
  try {
    const payload = await parseBody(request);

    // ── 1. Authenticate ───────────────────────────────────────────────────
    const webhookSecret = process.env.GHL_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[ghl-appointment] GHL_WEBHOOK_SECRET is not configured");
      return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }
    if (clean(payload?.secret) !== webhookSecret) {
      console.error("[ghl-appointment] unauthorized: secret mismatch");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contactId = clean(payload?.contactId ?? payload?.contact_id);
    const email = clean(payload?.email)?.toLowerCase() ?? null;

    if (!contactId && !email) {
      return NextResponse.json(
        { error: "contactId or email is required" },
        { status: 400 }
      );
    }

    const db = createAdminClient();

    // ── 2. Is this booking one of ours? ───────────────────────────────────
    // ghl_contact_id first — it is the machine link stamped at /r/[code]
    // submit time. Email is the fallback for automations that don't pass a
    // contact id, and matches because submit lowercases before storing.
    const columns =
      "id, affiliate_id, first_name, last_name, email, booked_at, status";
    let lead: any = null;

    // Disqualified leads are excluded from both lookups. They now DO carry a
    // ghl_contact_id (submit tags them `disqualified - *` so a GHL workflow can
    // work the rejection), which means a workflow that puts one on a calendar
    // would otherwise stamp booked_at and email the affiliate "your referral
    // booked a call" about somebody we already turned down.
    if (contactId) {
      const { data } = await db
        .from("affiliate_leads")
        .select(columns)
        .eq("ghl_contact_id", contactId)
        .neq("status", "disqualified")
        .maybeSingle();
      lead = data ?? null;
    }
    if (!lead && email) {
      const { data } = await db
        .from("affiliate_leads")
        .select(columns)
        .eq("email", email)
        .neq("status", "disqualified")
        .maybeSingle();
      lead = data ?? null;
    }

    // NOT AN ERROR, AND DELIBERATELY A 200. Most bookings in the account have
    // nothing to do with the affiliate program. A 404 here would make GHL retry
    // and mark the automation as failing on every ordinary appointment.
    if (!lead) {
      return NextResponse.json({ ok: true, matched: false });
    }
    if (!lead.affiliate_id) {
      return NextResponse.json({ ok: true, matched: false, reason: "no_affiliate" });
    }

    // ── 3. Claim the booking ──────────────────────────────────────────────
    // The conditional update IS the lock. GHL re-fires appointment webhooks on
    // reschedule, on confirmation, and on its own retry after a non-2xx, so
    // without this one booking emails the affiliate several times. Whoever
    // flips booked_at from NULL wins and is the only one that sends.
    const bookedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await db
      .from("affiliate_leads")
      .update({ booked_at: bookedAt, updated_at: bookedAt })
      .eq("id", lead.id)
      .is("booked_at", null)
      .select("id")
      .maybeSingle();

    if (claimError) {
      console.error("[ghl-appointment] claim failed:", claimError);
      return NextResponse.json({ error: "Failed to record booking" }, { status: 500 });
    }
    if (!claimed) {
      // Already booked — a reschedule or a duplicate delivery. Nothing to do,
      // and reporting success stops GHL retrying.
      return NextResponse.json({ ok: true, matched: true, already_notified: true });
    }

    // ── 4. Who do we tell? ────────────────────────────────────────────────
    const { data: affiliate } = await db
      .from("affiliates")
      .select("id, first_name, last_name, email, user_id, status")
      .eq("id", lead.affiliate_id)
      .maybeSingle();

    if (!affiliate?.email) {
      // The claim stands — the booking genuinely happened and the milestone is
      // worth keeping even though there is nobody to email.
      console.warn(
        `[ghl-appointment] lead ${lead.id} booked but affiliate ${lead.affiliate_id} has no email`
      );
      return NextResponse.json({ ok: true, matched: true, emailed: false });
    }

    const referralName =
      [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "Someone";
    const affiliateName =
      [affiliate.first_name, affiliate.last_name].filter(Boolean).join(" ").trim() || "there";

    // Same clamp as the payout path in @/lib/affiliates — the figure is only
    // quoted here, never paid, but the two must not disagree in front of the
    // affiliate.
    const configured = Number(process.env.AFFILIATE_COMMISSION_AMOUNT ?? 500);
    const ceilingRaw = Number(process.env.AFFILIATE_COMMISSION_MAX ?? 1000);
    const ceiling = Number.isFinite(ceilingRaw) && ceilingRaw > 0 ? ceilingRaw : 1000;
    const commission = Math.min(
      Number.isFinite(configured) && configured > 0 ? configured : 500,
      ceiling
    );
    const rewardStr = commission.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";

    try {
      await send_affiliate_link_used_email({
        affiliate_name: affiliateName,
        affiliate_email: affiliate.email,
        referral_name: referralName,
        reward_amount: rewardStr,
        dashboard_url: `${appUrl}/affiliate/dashboard`,
        terms_url: `${appUrl}/affiliate`,
      });
    } catch (emailErr) {
      // RELEASE THE CLAIM. Unlike the payout email — where the money is already
      // recorded and a lost email is a support question — this notification IS
      // the entire feature. Handing the claim back and answering 5xx lets GHL's
      // retry deliver it, which is worth the small risk of a duplicate if the
      // send actually succeeded and then threw.
      console.error("[ghl-appointment] affiliate email failed, releasing claim:", emailErr);
      await db
        .from("affiliate_leads")
        .update({ booked_at: null })
        .eq("id", lead.id);
      return NextResponse.json({ error: "Notification failed" }, { status: 500 });
    }

    // In-app, for affiliates who have a portal login. Best-effort: the email is
    // the real delivery and has already succeeded by this point, so a failure
    // here must not undo the claim or fail the webhook.
    if (affiliate.user_id) {
      try {
        await db.from("in_app_notifications").insert({
          user_id: affiliate.user_id,
          title: "Someone used your link 👀",
          message: `${referralName} booked a call with Credit Banc through your affiliate link.`,
        });
      } catch (notifErr) {
        console.error("[ghl-appointment] in-app notification failed (non-fatal):", notifErr);
      }
    }

    console.log(
      `✅ [ghl-appointment] affiliate ${affiliate.id} notified of booking by lead ${lead.id}`
    );
    return NextResponse.json({ ok: true, matched: true, emailed: true });
  } catch (error: any) {
    console.error("[ghl-appointment] unexpected error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}

/** Health check — mirrors /api/webhooks/ghl-tags so both are probeable. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/ghl-appointment",
    description:
      "Receives GHL appointment-booked events and emails the affiliate whose link brought the lead in.",
    expectedPayload: {
      contactId: "string (GHL contact ID) — preferred",
      email: "string — fallback when no contact id is sent",
      secret: "string (GHL_WEBHOOK_SECRET)",
    },
  });
}
