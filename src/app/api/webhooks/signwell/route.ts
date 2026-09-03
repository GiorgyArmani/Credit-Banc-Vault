import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { recordW9Completed } from "@/lib/compliance-onboarding";

// Native SignWell webhook receiver (registered via POST /api/v1/hooks, see
// scripts/signwell-webhooks.mts). SignWell hooks are account-wide: EVERY
// document event lands here, so anything that isn't one of our W-9s (partner
// deal desk OR internal advisor — both tables are checked) is acknowledged with
// a 200 and otherwise ignored. Client contracts keep flowing through the Zapier
// relay at /api/webhooks/signwell-contract.
//
// Why this exists: the partner's browser used to be the only thing recording
// the W-9, and SignWell marks a document Completed a few seconds before the
// signed PDF is downloadable — the one-shot fetch at that instant 404'd and
// nothing ever retried ([[partner_advisor_onboarding]]).

export const runtime = "nodejs";
// Waits out SignWell's PDF render (up to four attempts, three seconds apart).
export const maxDuration = 60;

type SignWellEvent = { type?: unknown; time?: unknown; hash?: unknown };

/**
 * SignWell signs each event as HMAC-SHA256(`${type}@${time}`) keyed by the
 * webhook id (current docs). Older docs keyed it by the API key, so both are
 * accepted and the match is logged — tighten to the id once production has
 * shown which one SignWell really uses.
 */
function verifyEventHash(event: SignWellEvent): "webhook_id" | "api_key" | null {
  if (typeof event.type !== "string" || typeof event.hash !== "string") return null;
  if (typeof event.time !== "number" && typeof event.time !== "string") return null;

  const message = `${event.type}@${event.time}`;
  const received = Buffer.from(event.hash, "utf8");
  const candidates: Array<["webhook_id" | "api_key", string | undefined]> = [
    ["webhook_id", process.env.SIGNWELL_WEBHOOK_ID],
    ["api_key", process.env.SIGNWELL_API_KEY],
  ];
  for (const [label, key] of candidates) {
    if (!key) continue;
    const expected = Buffer.from(createHmac("sha256", key).update(message).digest("hex"), "utf8");
    if (expected.length === received.length && timingSafeEqual(expected, received)) return label;
  }
  return null;
}

export async function POST(request: NextRequest) {
  if (!process.env.SIGNWELL_WEBHOOK_ID) {
    console.error("[signwell-webhook] SIGNWELL_WEBHOOK_ID is not set");
    return NextResponse.json({ success: false, error: "Configuration error" }, { status: 500 });
  }

  let payload: { event?: SignWellEvent; data?: { object?: { id?: unknown } } };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const event = payload?.event ?? {};
  const verifiedWith = verifyEventHash(event);
  if (!verifiedWith) {
    console.warn("[signwell-webhook] rejected event with bad hash", { type: event.type });
    return NextResponse.json({ success: false, error: "Invalid event hash" }, { status: 401 });
  }

  const type = event.type as string;
  const documentId = payload?.data?.object?.id;
  console.log("[signwell-webhook] event", { type, documentId, verifiedWith });

  if (type !== "document_completed") {
    return NextResponse.json({ success: true, ignored: true, type });
  }
  if (typeof documentId !== "string" || !documentId) {
    return NextResponse.json({ success: false, error: "Missing data.object.id" }, { status: 400 });
  }

  const result = await recordW9Completed(documentId);
  switch (result.outcome) {
    case "not_tracked":
      return NextResponse.json({ success: true, ignored: true, reason: "not a tracked W-9" });
    case "not_completed":
      // SignWell's own API disagrees with the event — nothing is written.
      return NextResponse.json({
        success: true,
        ignored: true,
        reason: `SignWell reports status "${result.status ?? "unknown"}"`,
      });
    case "error":
      console.error("[signwell-webhook] W-9 completion failed:", result);
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    case "recorded":
      if (!result.stored) {
        // Signature is recorded; only our PDF copy is outstanding. A non-2xx
        // invites SignWell to redeliver, and the partner-portal page load
        // retries the download regardless.
        console.warn("[signwell-webhook] W-9 signed but PDF not stored yet:", result);
        return NextResponse.json(
          { success: false, recorded: true, stored: false, error: result.error },
          { status: 503, headers: { "Retry-After": "30" } }
        );
      }
      console.log(`[signwell-webhook] W-9 stored on ${result.table}`, result.subjectId);
      return NextResponse.json({ success: true, recorded: true, stored: true, table: result.table });
  }
}

/** Health check so a browser hit shows the route is live and configured. */
export async function GET() {
  return NextResponse.json({
    status: "active",
    endpoint: "/api/webhooks/signwell",
    method: "POST",
    description: "Native SignWell event receiver — records partner and advisor W-9 completions",
    handles: ["document_completed"],
    configured: !!process.env.SIGNWELL_WEBHOOK_ID,
  });
}
