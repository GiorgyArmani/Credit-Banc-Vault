// src/app/api/webhooks/mailgun-inbound/route.ts
//
// Receives client email replies from a Mailgun Inbound Route and files them on
// the right client's timeline (M2 / Communications Hub, Phase 3).
//
// MAILGUN SETUP (do this once, in the Mailgun dashboard → Receiving → Routes):
//   Expression: match_recipient("^reply\+.*@<MAILGUN_REPLY_DOMAIN>$")
//   Action:     forward("https://vault.creditbanc.io/api/webhooks/mailgun-inbound")
//   Priority:   0
// The route must also have the domain's MX records pointed at Mailgun, or
// nothing will ever arrive.
//
// PAYLOAD SHAPE: routes POST application/x-www-form-urlencoded (or
// multipart/form-data when the reply carries attachments) with fully parsed
// fields — NOT the Webhooks-2.0 JSON envelope used for delivery events. request
// .formData() handles both encodings, so we read it that way rather than
// json().
//
// SECURITY: the POST is verified with HMAC-SHA256(timestamp + token) keyed on
// the HTTP WEBHOOK SIGNING KEY (Mailgun → API Security), which is a different
// secret from MAILGUN_API_KEY. That proves the request came from Mailgun. It
// does NOT prove who sent the underlying email — anyone can mail a reply+
// address — so sender identity is cross-checked separately below.
//
// RESPONSE CONTRACT: every processed-but-unusable payload returns 200. Mailgun
// retries non-2xx for hours, and a reply we cannot attribute is not going to
// become attributable on the fifth attempt. Only signature failures (401) and
// genuine server faults (500) are non-2xx.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tryWriteCommunication } from "@/lib/communications-log";
import {
    verifyMailgunSignature,
    parseReplyAddress,
    extractEmailAddress,
    resolveThreadKey,
    readMimeHeader,
    normalizeMessageId,
} from "@/lib/mailgun";

/** Inbound bodies can be large; give the parse room. */
export const maxDuration = 30;

export async function POST(request: NextRequest) {
    try {
        const form = await request.formData();
        const field = (name: string): string | null => {
            const value = form.get(name);
            return typeof value === "string" ? value : null;
        };

        // 1. Prove it came from Mailgun.
        const verification = verifyMailgunSignature({
            timestamp: field("timestamp") ?? "",
            token: field("token") ?? "",
            signature: field("signature") ?? "",
        });

        if (!verification.valid) {
            console.error("Mailgun inbound rejected:", verification.reason);
            return NextResponse.json(
                { success: false, error: "Invalid signature" },
                { status: 401 },
            );
        }

        // 2. Pull the parsed message apart.
        const recipient = field("recipient");
        const sender = extractEmailAddress(field("sender") ?? field("from"));
        const subject = field("subject") ?? "(no subject)";
        const messageHeaders = field("message-headers");

        // stripped-text is the reply with the quoted history and signature
        // removed — far more readable on a timeline than the full body-plain,
        // which repeats the entire prior conversation on every reply.
        const body = field("stripped-text") || field("body-plain") || "";
        const bodyHtml = field("stripped-html") || field("body-html");

        const messageId = normalizeMessageId(
            readMimeHeader(messageHeaders, "Message-Id") ?? field("Message-Id"),
        );
        const inReplyTo = normalizeMessageId(readMimeHeader(messageHeaders, "In-Reply-To"));
        const references = readMimeHeader(messageHeaders, "References");
        const threadKey = resolveThreadKey({ references, inReplyTo, messageId });

        const attachmentCount = Number(field("attachment-count") ?? "0") || 0;

        // 3. Work out which client this belongs to.
        const resolution = await resolveClient({
            recipient,
            sender,
            threadKey,
        });

        if (!resolution.clientId) {
            // Nothing to attach it to. Logged loudly because a run of these
            // usually means the Reply-To stamping regressed, not that clients
            // are emailing us from nowhere.
            console.warn("Mailgun inbound could not be attributed", {
                recipient,
                sender,
                threadKey,
            });
            return NextResponse.json({ success: true, attributed: false });
        }

        // 4. File it.
        const result = await tryWriteCommunication(resolution.clientId, {
            channel: "email",
            direction: "inbound",
            status: "received",
            from_address: sender,
            to_address: extractEmailAddress(recipient),
            subject,
            body: attachmentCount > 0
                ? `${body}\n\n[${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}]`
                : body,
            body_html: bodyHtml,
            provider: "mailgun",
            provider_message_id: messageId ?? null,
            thread_key: threadKey,
            in_reply_to: inReplyTo,
            is_automated: false,
            // Surfaced on the timeline so a rep can see the reply arrived from
            // an address we don't have on file, rather than silently trusting it.
            error_message: resolution.senderMismatch
                ? `Reply came from ${sender}, which is not the address on file for this client.`
                : null,
        });

        if (!result.success) {
            // The write failed for a real reason (missing table, DB down).
            // 500 so Mailgun retries — this one IS worth retrying.
            console.error("Mailgun inbound write failed:", result.error);
            return NextResponse.json(
                { success: false, error: "Could not record message" },
                { status: 500 },
            );
        }

        return NextResponse.json({
            success: true,
            attributed: true,
            client_id: resolution.clientId,
            matched_by: resolution.matchedBy,
        });
    } catch (error: any) {
        console.error("Mailgun inbound handler error:", error);
        return NextResponse.json(
            { success: false, error: "Handler error" },
            { status: 500 },
        );
    }
}

interface ClientResolution {
    clientId: string | null;
    matchedBy: "reply-token" | "thread" | "sender" | null;
    /** True when we identified the file but the reply came from an unknown address. */
    senderMismatch: boolean;
}

/**
 * Attribution, most to least reliable:
 *
 *   1. the `reply+<vaultId>@` token we stamped on our own outbound Reply-To —
 *      survives the client replying from any address
 *   2. the thread the message is a reply to — covers a forwarded thread coming
 *      back from a different person on the client's side
 *   3. the sender address matching a client on file — the last resort, and the
 *      only one that works for a cold inbound email
 *
 * The reply token is NOT authentication (anyone can mail that address), so
 * whenever we attribute by token we still compare the sender against the address
 * on file and report a mismatch to the caller for display.
 */
async function resolveClient(params: {
    recipient: string | null;
    sender: string | null;
    threadKey: string | null;
}): Promise<ClientResolution> {
    const supabase = createAdminClient();

    // 1. Reply token.
    const tokenClientId = parseReplyAddress(params.recipient);
    if (tokenClientId) {
        const { data: client } = await supabase
            .from("client_data_vault")
            .select("id, client_email")
            .eq("id", tokenClientId)
            .maybeSingle();

        if (client) {
            const onFile = (client.client_email ?? "").trim().toLowerCase();
            return {
                clientId: client.id,
                matchedBy: "reply-token",
                senderMismatch: !!params.sender && !!onFile && params.sender !== onFile,
            };
        }
    }

    // 2. Existing thread.
    if (params.threadKey) {
        const { data: priorMessage } = await supabase
            .from("communications")
            .select("client_id")
            .eq("thread_key", params.threadKey)
            .limit(1)
            .maybeSingle();

        if (priorMessage?.client_id) {
            return { clientId: priorMessage.client_id, matchedBy: "thread", senderMismatch: false };
        }
    }

    // 3. Sender on file. ilike keeps this case-insensitive without assuming the
    // stored address was ever normalized.
    if (params.sender) {
        const { data: client } = await supabase
            .from("client_data_vault")
            .select("id")
            .ilike("client_email", params.sender)
            .limit(1)
            .maybeSingle();

        if (client?.id) {
            return { clientId: client.id, matchedBy: "sender", senderMismatch: false };
        }
    }

    return { clientId: null, matchedBy: null, senderMismatch: false };
}
