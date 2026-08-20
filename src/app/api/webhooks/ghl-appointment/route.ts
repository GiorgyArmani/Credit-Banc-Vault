// src/app/api/webhooks/ghl-appointment/route.ts
//
// PUBLIC (secret-authenticated) — GoHighLevel calls this when a contact books an
// appointment. It RECORDS the booking on the affiliate lead. It sends nothing:
// the affiliate is emailed at pre-qualification now, in-process, and a second
// notice for the same referral would be a duplicate.
//
// WHY A WEBHOOK AT ALL. The pre-qual stepper at /r/[code] is ours and we know
// exactly when someone qualifies — but the booking that follows happens inside
// an embedded GHL calendar iframe (see components/affiliate-lead-form.tsx). The
// app never observes it. GHL is the only party that knows a slot was taken, so
// it has to tell us.
//
// WHY THE EMAIL MOVED TO PRE-QUAL. Qualifying is not booking, and firing on the
// stronger milestone was the right call on paper. In practice this endpoint was
// never wired up on the GHL side: `booked_at` was NULL on every row the program
// had ever produced, contacts carried GHL's own `appointment booked` tag while
// we knew nothing, and not one affiliate was ever told their link worked. A
// notice that depends on an external automation someone has to remember to
// configure is a notice that silently does not exist. The email now fires from
// /api/refer/[code]/submit the moment a lead qualifies and their GHL contact is
// created — ours, in-process, unskippable. See notifyAffiliateLinkUsed.
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
import { secretsMatch } from "@/lib/secret-compare";
import { createAdminClient } from "@/lib/supabase/admin";

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
    if (!secretsMatch(clean(payload?.secret), webhookSecret)) {
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

    // ── 3. Record the booking ─────────────────────────────────────────────
    // The conditional update IS the lock. GHL re-fires appointment webhooks on
    // reschedule, on confirmation, and on its own retry after a non-2xx, so the
    // first writer wins and the rest are no-ops. Nothing is sent either way —
    // this only has to be written once and correctly.
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
      return NextResponse.json({ ok: true, matched: true, already_recorded: true });
    }

    // ── 4. Recorded, not announced ────────────────────────────────────────
    // The affiliate already heard from us the moment this person pre-qualified
    // and their GHL contact was created (notifyAffiliateLinkUsed, called from
    // /api/refer/[code]/submit). Emailing again here would be a second "someone
    // used your link" for one referral.
    //
    // booked_at still earns its keep: it flips the affiliate dashboard's pill
    // from "Qualified" to "Booked", which is how anyone tells a referral who
    // took a slot from one who closed the tab at the calendar.
    console.log(`✅ [ghl-appointment] booking recorded for lead ${lead.id}`);
    return NextResponse.json({ ok: true, matched: true, recorded: true });
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
