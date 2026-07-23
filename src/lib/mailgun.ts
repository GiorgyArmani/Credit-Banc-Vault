// src/lib/mailgun.ts
//
// Mailgun adapter for two-way email threading (M2 / Communications Hub, Phase 3).
// Server-side only — never import from a client component.
//
// WHY THIS EXISTS ALONGSIDE lib/email.ts: that module sends TRANSACTIONAL mail
// (welcome, doc reminders, magic links) over nodemailer SMTP, and SMTP gives us
// no reliable Message-Id back and no way to receive anything. This module drives
// the Mailgun HTTP API instead, which returns the Message-Id of every send —
// the anchor the whole threading model hangs off — and pairs with an Inbound
// Route that POSTs replies back to us. The two coexist on purpose: transactional
// blasts have no reason to migrate, and moving them would risk the flows that
// already work in production.
//
// THREADING MODEL: every conversation is identified by `thread_key`, which is
// the Message-Id of the message that STARTED the thread. On send we set
// In-Reply-To/References so the client's mail app threads it correctly; on
// receive we read References/In-Reply-To to find which conversation a reply
// belongs to. See resolveThreadKey().
//
// REQUIRED ENV:
//   MAILGUN_API_KEY              — private API key ("Sending API key" also works)
//   MAILGUN_DOMAIN               — verified sending domain, e.g. mg.creditbanc.io
//   MAILGUN_WEBHOOK_SIGNING_KEY  — HTTP webhook signing key (Mailgun → API
//                                  Security). This is NOT the API key; inbound
//                                  route POSTs are signed with this one.
// OPTIONAL ENV:
//   MAILGUN_API_HOST             — https://api.eu.mailgun.net for EU accounts
//   MAILGUN_REPLY_DOMAIN         — domain for machine-readable Reply-To
//                                  addresses; defaults to MAILGUN_DOMAIN
//   MAILGUN_FROM_NAME            — display name on staff email

import crypto from "crypto";
import formData from "form-data";
import Mailgun from "mailgun.js";
import { escape_html } from "@/lib/email";

const DEFAULT_API_HOST = "https://api.mailgun.net";

/** Local-part prefix of the address clients reply to. See buildReplyAddress(). */
const REPLY_PREFIX = "reply";

export interface MailgunConfig {
    apiKey: string;
    domain: string;
    apiHost: string;
    replyDomain: string;
    fromName: string;
    /** Envelope/header From address. See getMailgunConfig() for why it matters. */
    fromEmail: string;
}

/**
 * Reads config, or returns null when Mailgun isn't set up. Callers degrade
 * instead of throwing: an advisor missing an env var should see "email sending
 * isn't configured", not a 500 on the client detail page.
 */
export function getMailgunConfig(): MailgunConfig | null {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;
    if (!apiKey || !domain) return null;

    // The From address must sit on the sending domain, or SPF/DKIM alignment
    // fails and the mail lands in spam (or Mailgun refuses it outright). That
    // rules out reusing SMTP_FROM_EMAIL, which is on vault.creditbanc.net while
    // the Mailgun sending domain is creditbanc.net. Default to a real-looking
    // mailbox rather than postmaster@, which reads as machine noise to a client.
    const fromEmail = process.env.MAILGUN_FROM_EMAIL || `no-reply@${domain}`;

    return {
        apiKey,
        domain,
        apiHost: process.env.MAILGUN_API_HOST || DEFAULT_API_HOST,
        replyDomain: process.env.MAILGUN_REPLY_DOMAIN || domain,
        fromName: process.env.MAILGUN_FROM_NAME || process.env.SMTP_FROM_NAME || "Credit Banc",
        fromEmail,
    };
}

export function isMailgunConfigured(): boolean {
    return getMailgunConfig() !== null;
}

function getClient(config: MailgunConfig) {
    // mailgun.js needs form-data injected — it targets both node and browser.
    const mailgun = new Mailgun(formData);
    return mailgun.client({
        username: "api",
        key: config.apiKey,
        url: config.apiHost,
    });
}

// ── Reply addressing ─────────────────────────────────────────────────────────

/**
 * The Reply-To we stamp on staff email: `reply+<clientVaultId>@<replyDomain>`.
 *
 * Plus-addressing is what lets an inbound reply be attributed to the right file
 * even when the client replies from an address we've never seen (a personal
 * Gmail, their bookkeeper, a phone with a different alias). Matching on sender
 * alone would drop all of those on the floor.
 *
 * Set up a Mailgun Inbound Route matching `match_recipient("^reply\\+.*@<domain>$")`
 * with a forward() action pointing at /api/webhooks/mailgun-inbound.
 *
 * NOTE the token is not a secret and must never be treated as authentication —
 * anyone can send mail to this address. The webhook cross-checks the sender and
 * flags mismatches rather than trusting the token blindly.
 */
export function buildReplyAddress(clientVaultId: string, config?: MailgunConfig): string | null {
    const cfg = config ?? getMailgunConfig();
    if (!cfg) return null;
    return `${REPLY_PREFIX}+${clientVaultId}@${cfg.replyDomain}`;
}

/**
 * From header for staff mail: "Jane Doe (Credit Banc) <no-reply@…>".
 *
 * The rep's name goes in the display name rather than the address so the client
 * sees a person, not a system mailbox, while the address stays on the verified
 * sending domain. Quotes are stripped because an unescaped `"` in a display name
 * produces a malformed header.
 */
export function buildFromHeader(staffName?: string | null, config?: MailgunConfig): string | null {
    const cfg = config ?? getMailgunConfig();
    if (!cfg) return null;
    const clean = (staffName ?? "").replace(/["<>\r\n]/g, "").trim();
    const display = clean ? `${clean} (${cfg.fromName})` : cfg.fromName;
    return `${display} <${cfg.fromEmail}>`;
}

/** Pulls the client vault id back out of a `reply+<id>@…` recipient. */
export function parseReplyAddress(recipient: string | null | undefined): string | null {
    if (!recipient) return null;
    // The recipient field can arrive as "Name <addr>" — take the addr part.
    const angle = recipient.match(/<([^>]+)>/);
    const address = (angle ? angle[1] : recipient).trim().toLowerCase();
    const match = address.match(/^reply\+([0-9a-f-]{36})@/);
    return match ? match[1] : null;
}

// ── Sending ──────────────────────────────────────────────────────────────────

export interface SendEmailParams {
    to: string;
    subject: string;
    /** Plain-text body as the rep typed it. */
    text: string;
    /** Optional pre-rendered HTML. Omit to auto-wrap `text` safely. */
    html?: string;
    /** Where replies should land — normally buildReplyAddress(clientVaultId). */
    replyTo?: string | null;
    /** Message-Id being replied to, for correct client-side threading. */
    inReplyTo?: string | null;
    /** Existing References chain; the new Message-Id is appended by the client. */
    references?: string | null;
    cc?: string[];
    /** Mailgun tags, for per-advisor / per-purpose analytics in their dashboard. */
    tags?: string[];
    /** Overrides the default `fromName <postmaster@domain>` sender. */
    from?: string;
}

export interface SendEmailResult {
    success: boolean;
    /** Message-Id with angle brackets, e.g. "<2026…@mg.creditbanc.io>". */
    messageId?: string;
    error?: string;
}

/**
 * Sends one email through the Mailgun API and returns its Message-Id.
 *
 * The Message-Id is the whole point of using the API here rather than SMTP: it
 * is what a later inbound reply's In-Reply-To/References will point at, and thus
 * the only way to stitch a two-way conversation together.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const config = getMailgunConfig();
    if (!config) {
        return {
            success: false,
            error: "Mailgun is not configured (set MAILGUN_API_KEY and MAILGUN_DOMAIN).",
        };
    }

    try {
        const mg = getClient(config);

        // MailgunMessageData types the standard fields but not the `h:` /
        // `o:` header-and-option passthroughs we rely on for threading, so the
        // payload is assembled loosely and handed over at the call site.
        const payload: Record<string, any> = {
            from: params.from || `${config.fromName} <${config.fromEmail}>`,
            to: params.to,
            subject: params.subject,
            text: params.text,
            html: params.html ?? renderPlainTextAsHtml(params.text),
        };

        if (params.cc?.length) payload.cc = params.cc;
        if (params.replyTo) payload["h:Reply-To"] = params.replyTo;
        // Both headers matter: In-Reply-To is what most clients thread on,
        // References is what keeps long chains from fragmenting.
        if (params.inReplyTo) payload["h:In-Reply-To"] = params.inReplyTo;
        if (params.references) payload["h:References"] = params.references;
        if (params.tags?.length) payload["o:tag"] = params.tags;

        const response: any = await mg.messages.create(config.domain, payload as any);

        return { success: true, messageId: normalizeMessageId(response?.id) };
    } catch (error: any) {
        // Mailgun surfaces the useful part in `details`; the bare message is
        // usually just the status code.
        const detail = error?.details || error?.message || String(error);
        console.error("Mailgun sendEmail error:", detail);
        return { success: false, error: typeof detail === "string" ? detail : "Mailgun send failed" };
    }
}

/**
 * Wraps rep-typed plain text in minimal, safe HTML.
 *
 * Escaping first is mandatory — this body is operator-supplied free text going
 * into an HTML email, the same injection surface the transactional templates
 * guard with escape_email_strings().
 */
export function renderPlainTextAsHtml(text: string): string {
    const escaped = escape_html(text).replace(/\r?\n/g, "<br>");
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1e293b;">${escaped}</div>`;
}

/** Mailgun returns "<id@domain>"; keep the brackets so header comparisons match. */
export function normalizeMessageId(id: string | null | undefined): string | undefined {
    if (!id) return undefined;
    const trimmed = id.trim();
    if (!trimmed) return undefined;
    return trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
}

// ── Inbound ──────────────────────────────────────────────────────────────────

/**
 * Verifies an inbound route / webhook POST really came from Mailgun.
 *
 * signature = HMAC-SHA256(timestamp + token) keyed with the HTTP WEBHOOK SIGNING
 * KEY — deliberately not the API key, a mix-up that silently rejects every
 * request. Comparison is constant-time, and stale timestamps are refused so a
 * captured payload can't be replayed later.
 */
export function verifyMailgunSignature(params: {
    timestamp: string;
    token: string;
    signature: string;
    /** Replay window. Mailgun's own guidance is 15 minutes. */
    toleranceSeconds?: number;
}): { valid: boolean; reason?: string } {
    const signingKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    if (!signingKey) {
        return { valid: false, reason: "MAILGUN_WEBHOOK_SIGNING_KEY is not set" };
    }

    const { timestamp, token, signature } = params;
    if (!timestamp || !token || !signature) {
        return { valid: false, reason: "Missing timestamp, token or signature" };
    }

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > (params.toleranceSeconds ?? 900)) {
        return { valid: false, reason: "Timestamp outside the accepted window" };
    }

    const expected = crypto
        .createHmac("sha256", signingKey)
        .update(timestamp + token)
        .digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    // timingSafeEqual throws on length mismatch, so check that first.
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { valid: false, reason: "Signature mismatch" };
    }

    return { valid: true };
}

/** Bare address out of "Display Name <someone@example.com>". */
export function extractEmailAddress(value: string | null | undefined): string | null {
    if (!value) return null;
    const angle = value.match(/<([^>]+)>/);
    const candidate = (angle ? angle[1] : value).trim().toLowerCase();
    return candidate.includes("@") ? candidate : null;
}

/**
 * Decides which conversation an inbound message belongs to.
 *
 * References holds the whole ancestry, oldest first, so its FIRST entry is the
 * message that started the thread — exactly what we store as thread_key. Using
 * In-Reply-To instead would key off the immediate parent and split one
 * conversation into a new thread at every reply.
 */
export function resolveThreadKey(headers: {
    references?: string | null;
    inReplyTo?: string | null;
    messageId?: string | null;
}): string | null {
    const references = headers.references?.trim();
    if (references) {
        const first = references.split(/\s+/).find((r) => r.startsWith("<"));
        if (first) return first;
    }
    const inReplyTo = normalizeMessageId(headers.inReplyTo);
    if (inReplyTo) return inReplyTo;
    // No ancestry: this message starts its own thread.
    return normalizeMessageId(headers.messageId) ?? null;
}

/**
 * Mailgun sends `message-headers` as a JSON string of [name, value] pairs.
 * Header names are case-insensitive, so look them up that way.
 */
export function readMimeHeader(messageHeaders: string | null | undefined, name: string): string | null {
    if (!messageHeaders) return null;
    try {
        const parsed = JSON.parse(messageHeaders);
        if (!Array.isArray(parsed)) return null;
        const wanted = name.toLowerCase();
        for (const entry of parsed) {
            if (Array.isArray(entry) && String(entry[0]).toLowerCase() === wanted) {
                return entry[1] == null ? null : String(entry[1]);
            }
        }
        return null;
    } catch {
        return null;
    }
}
