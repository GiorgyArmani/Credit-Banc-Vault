// src/app/api/webhooks/telzio/route.ts
//
// Receives Telzio call and SMS events and keeps the communications timeline in
// sync with what actually happened on the wire (M2 / Communications Hub).
//
// TELZIO SETUP (Telzio dashboard → Webhooks):
//   URL:    https://vault.creditbanc.io/api/webhooks/telzio
//   Format: JSON
//   Auth:   Bearer token — paste the same value as TELZIO_WEBHOOK_TOKEN
//   Events: Call Ended, SMS Received, Recording Ready (Call Created optional)
//
// SECURITY: Telzio does NOT sign its webhooks. The only thing standing between
// this endpoint and the open internet is the shared bearer token you configure
// on their side, so the handler refuses every request unless TELZIO_WEBHOOK_TOKEN
// is set and matches. Comparison is constant-time.
//
// TIMING: Telzio gives a consumer 15 seconds to accept an event and then DISCARDS
// it — there are no retries. So this handler does the minimum work needed and
// returns; anything that fails is logged for reconciliation rather than retried.
//
// PAYLOAD NOTES: field names below follow Telzio's Call Ended documentation
// (EventType, call_id, parent_call_id, call_status, reason, from, to, duration,
// billed_duration, date). Their SMS event payload is not documented publicly, so
// the SMS branch accepts several plausible spellings and always stores the raw
// body in provider_payload — check a real payload and tighten readMessageText()
// once one has been observed.

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tryWriteCommunication } from "@/lib/communications-log";
import { toE164 } from "@/lib/communications";

export async function POST(request: NextRequest) {
    try {
        // 1. Shared-secret gate. Fails closed when unset — an unauthenticated
        // write endpoint into client history is worse than a broken webhook.
        const expected = process.env.TELZIO_WEBHOOK_TOKEN;
        if (!expected) {
            console.error("Telzio webhook rejected: TELZIO_WEBHOOK_TOKEN is not set");
            return NextResponse.json({ success: false }, { status: 401 });
        }

        const presented = (request.headers.get("authorization") ?? "")
            .replace(/^Bearer\s+/i, "")
            .trim();

        if (!timingSafeMatch(presented, expected)) {
            return NextResponse.json({ success: false }, { status: 401 });
        }

        // 2. Telzio sends either JSON or x-www-form-urlencoded, configurable per
        // webhook — accept whichever arrived.
        const payload = await readPayload(request);
        if (!payload) {
            return NextResponse.json({ success: true, ignored: "unparseable" });
        }

        const eventType = String(
            payload.EventType ?? payload.event_type ?? request.headers.get("x-telzio-event-type") ?? "",
        ).toLowerCase();

        switch (eventType) {
            case "call_ended":
                await handleCallEnded(payload);
                break;
            case "recording_ready":
                await handleRecordingReady(payload);
                break;
            case "sms_received":
                await handleSmsReceived(payload);
                break;
            default:
                // call_created, sms_sent and friends carry nothing we don't
                // already know from having initiated the action ourselves.
                return NextResponse.json({ success: true, ignored: eventType || "unknown" });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Telzio webhook error:", error);
        // Still 200: Telzio does not retry, and a non-2xx only produces noise.
        return NextResponse.json({ success: true, error: "handled" });
    }
}

function timingSafeMatch(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

async function readPayload(request: NextRequest): Promise<Record<string, any> | null> {
    const contentType = request.headers.get("content-type") ?? "";
    try {
        if (contentType.includes("application/json")) {
            return await request.json();
        }
        const form = await request.formData();
        return Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]));
    } catch {
        return null;
    }
}

// ── Call events ──────────────────────────────────────────────────────────────

/**
 * Fills in the outcome of a call we placed — or records one we didn't.
 *
 * `billed_duration` is Telzio's "part of the call where voice was exchanged", so
 * zero means nobody ever picked up. That is a far more trustworthy answered /
 * missed signal than `duration`, which includes ring time and is non-zero even
 * for a call that rang out.
 */
async function handleCallEnded(payload: Record<string, any>) {
    const callId = str(payload.call_id);
    const parentCallId = str(payload.parent_call_id);
    const duration = int(payload.duration);
    const billed = int(payload.billed_duration);
    const connected = (billed ?? 0) > 0;

    const supabase = createAdminClient();

    // The click-to-call row was written when we placed the call; find it by the
    // id Telzio gave us then, or by its parent leg.
    const candidateIds = [callId, parentCallId].filter((v): v is string => !!v);
    if (candidateIds.length > 0) {
        const { data: existing } = await supabase
            .from("communications")
            .select("id")
            .eq("provider", "telzio")
            .in("provider_message_id", candidateIds)
            .limit(1)
            .maybeSingle();

        if (existing?.id) {
            await supabase
                .from("communications")
                .update({
                    status: connected ? "completed" : "missed",
                    duration_seconds: connected ? billed ?? duration : null,
                    provider_status: str(payload.call_status) ?? str(payload.reason),
                    provider_payload: payload,
                })
                .eq("id", existing.id);
            return;
        }
    }

    // No row: a call that didn't originate in the app (the rep dialled from
    // their handset, or the client called in). Log it so it still counts.
    const from = toE164(str(payload.from));
    const to = toE164(str(payload.to));

    // Telzio's `from`/`to` can be a username rather than a number for internal
    // legs; whichever side resolved to a real number is the client's.
    const clientId =
        (await findClientByPhone(to)) ?? (await findClientByPhone(from));
    if (!clientId) return;

    const inbound = !!(await findClientByPhone(from));

    await tryWriteCommunication(clientId, {
        channel: "call",
        direction: inbound ? "inbound" : "outbound",
        status: connected ? "completed" : "missed",
        from_address: from,
        to_address: to,
        duration_seconds: connected ? billed ?? duration : null,
        provider: "telzio",
        provider_message_id: callId,
        provider_status: str(payload.call_status) ?? str(payload.reason),
        provider_payload: payload,
        occurred_at: isoDate(payload.date),
    });
}

/** Attaches a recording to the call it belongs to, once Telzio has produced it. */
async function handleRecordingReady(payload: Record<string, any>) {
    const callId = str(payload.call_id);
    const url = str(payload.url) ?? str(payload.recording_url) ?? str(payload.RecordingUrl);
    if (!callId || !url) return;

    const supabase = createAdminClient();
    await supabase
        .from("communications")
        .update({ recording_url: url })
        .eq("provider", "telzio")
        .eq("provider_message_id", callId);
}

// ── SMS events ───────────────────────────────────────────────────────────────

async function handleSmsReceived(payload: Record<string, any>) {
    const from = toE164(str(payload.from));
    const to = toE164(str(payload.to));
    const message = readMessageText(payload);

    if (!from) return;

    const clientId = await findClientByPhone(from);
    if (!clientId) {
        console.warn("Telzio inbound SMS from an unknown number", { from });
        return;
    }

    await tryWriteCommunication(clientId, {
        channel: "sms",
        direction: "inbound",
        status: "received",
        from_address: from,
        to_address: to,
        body: message,
        provider: "telzio",
        provider_message_id: str(payload.sms_id) ?? str(payload.id) ?? null,
        provider_payload: payload,
        occurred_at: isoDate(payload.date),
    });
}

/** Telzio's SMS payload isn't documented; accept the plausible spellings. */
function readMessageText(payload: Record<string, any>): string {
    return (
        str(payload.Message) ??
        str(payload.message) ??
        str(payload.text) ??
        str(payload.body) ??
        ""
    );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Finds the client that owns a phone number.
 *
 * client_data_vault.client_phone has never been format-constrained — it holds
 * "(555) 010-1234", "555.010.1234", "+1 555 010 1234" — so an equality match on
 * E.164 would miss almost everything. Narrow with a LIKE on the last 7 digits,
 * which survives every formatting variant, then confirm by normalizing in JS.
 */
async function findClientByPhone(e164: string | null): Promise<string | null> {
    if (!e164) return null;

    const digits = e164.replace(/\D/g, "");
    if (digits.length < 7) return null;
    const tail = digits.slice(-7);

    const supabase = createAdminClient();
    const { data } = await supabase
        .from("client_data_vault")
        .select("id, client_phone")
        .like("client_phone", `%${tail}%`)
        .limit(25);

    for (const row of data ?? []) {
        if (toE164(row.client_phone) === e164) return row.id;
    }
    return null;
}

function str(value: unknown): string | null {
    if (value == null) return null;
    const s = String(value).trim();
    return s ? s : null;
}

function int(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : null;
}

/** Telzio sends ISO 8601; fall back to now() if it's unparseable. */
function isoDate(value: unknown): string | null {
    const raw = str(value);
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
