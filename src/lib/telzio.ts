// src/lib/telzio.ts
//
// Telzio adapter for in-app calling and texting (M2 / Communications Hub,
// Phase 2). Server-side only — never import from a client component, it holds
// the API secret.
//
// CALLING MODEL — click-to-call, not a browser softphone. Telzio's
// /dial/outbound takes three numbers:
//
//   From : one of OUR Telzio numbers. This is the caller ID the client sees,
//          and the number the call is billed to. Swapping it is what "switchable
//          numbers" means — a rep can dial as the main line or a campaign line.
//   Aleg : rung FIRST. This is the REP's own phone (desk or cell). They pick up
//          before the client's phone ever rings.
//   Bleg : dialled once Aleg answers. This is the CLIENT.
//
// Getting Aleg and Bleg backwards is the classic failure here: the client would
// be rung first and hear silence while the rep's phone starts ringing.
//
// REQUIRED ENV:
//   TELZIO_API_KEY     — Integrations page → API credentials (Basic auth user)
//   TELZIO_API_SECRET  — the paired secret (Basic auth password)
//   TELZIO_FROM_NUMBER — default outbound caller ID, E.164 (e.g. +15551234567)
// OPTIONAL ENV:
//   TELZIO_API_BASE    — defaults to https://api.telzio.com. Telzio's auth page
//                        shows a /v2-prefixed example while the resource pages
//                        document unprefixed paths; if every call 404s, set this
//                        to https://api.telzio.com/v2 rather than editing paths.

import { toE164 } from "@/lib/communications";

const DEFAULT_API_BASE = "https://api.telzio.com";

export interface TelzioConfig {
    apiKey: string;
    apiSecret: string;
    apiBase: string;
    defaultFromNumber: string | null;
}

/**
 * Reads config, or null when Telzio isn't set up. Callers degrade with a clear
 * message instead of throwing — a missing env var should not 500 a client page.
 */
export function getTelzioConfig(): TelzioConfig | null {
    const apiKey = process.env.TELZIO_API_KEY;
    const apiSecret = process.env.TELZIO_API_SECRET;
    if (!apiKey || !apiSecret) return null;

    return {
        apiKey,
        apiSecret,
        apiBase: (process.env.TELZIO_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, ""),
        defaultFromNumber: toE164(process.env.TELZIO_FROM_NUMBER) ?? null,
    };
}

export function isTelzioConfigured(): boolean {
    return getTelzioConfig() !== null;
}

/** Telzio uses HTTP Basic auth: API key as username, API secret as password. */
function authHeader(config: TelzioConfig): string {
    const encoded = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64");
    return `Basic ${encoded}`;
}

interface TelzioResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    /** Raw body, kept so webhook/timeline rows can store what actually came back. */
    raw?: unknown;
}

async function telzioRequest<T>(
    config: TelzioConfig,
    path: string,
    init: { method: "GET" | "POST" | "PUT"; body?: Record<string, unknown> },
): Promise<TelzioResponse<T>> {
    const url = `${config.apiBase}${path}`;

    try {
        const response = await fetch(url, {
            method: init.method,
            headers: {
                Authorization: authHeader(config),
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: init.body ? JSON.stringify(init.body) : undefined,
            // Telco APIs can hang; don't let a dial click block a request thread.
            signal: AbortSignal.timeout(15_000),
        });

        const text = await response.text();
        let parsed: any = undefined;
        try {
            parsed = text ? JSON.parse(text) : undefined;
        } catch {
            // Some endpoints answer with a bare string on success.
            parsed = text || undefined;
        }

        if (!response.ok) {
            const message =
                (parsed && (parsed.Message || parsed.message || parsed.error)) ||
                `Telzio responded ${response.status}`;
            return { success: false, error: String(message), raw: parsed ?? text };
        }

        return { success: true, data: parsed as T, raw: parsed ?? text };
    } catch (error: any) {
        const message =
            error?.name === "TimeoutError"
                ? "Telzio did not respond in time"
                : error?.message || String(error);
        console.error(`Telzio ${init.method} ${path} failed:`, message);
        return { success: false, error: message };
    }
}

// ── Calling ──────────────────────────────────────────────────────────────────

export interface DialParams {
    /** The rep's own phone. Rings first. */
    repNumber: string;
    /** The client. Rung once the rep picks up. */
    clientNumber: string;
    /** Caller ID the client sees. Defaults to TELZIO_FROM_NUMBER. */
    fromNumber?: string | null;
}

export interface DialResult {
    success: boolean;
    /** Present when Telzio returns a call identifier we can reconcile against. */
    callUuid?: string | null;
    /** The caller ID actually used, for the timeline row. */
    fromNumber?: string;
    error?: string;
    raw?: unknown;
}

/**
 * Places a click-to-call: rings the rep, then bridges to the client.
 *
 * Every number is normalized to E.164 first and the call is refused outright if
 * any of them can't be — client_data_vault.client_phone has never been
 * format-constrained, so free-text junk genuinely reaches this path, and Telzio
 * would either reject it or, worse, dial something unintended.
 */
export async function dialOutbound(params: DialParams): Promise<DialResult> {
    const config = getTelzioConfig();
    if (!config) {
        return {
            success: false,
            error: "Telzio isn't configured (set TELZIO_API_KEY and TELZIO_API_SECRET).",
        };
    }

    const from = toE164(params.fromNumber) ?? config.defaultFromNumber;
    const aleg = toE164(params.repNumber);
    const bleg = toE164(params.clientNumber);

    if (!from) {
        return {
            success: false,
            error: "No outbound caller ID configured (set TELZIO_FROM_NUMBER).",
        };
    }
    if (!aleg) {
        return {
            success: false,
            error: "Your own phone number isn't set or isn't a valid US number — add it to your advisor profile.",
        };
    }
    if (!bleg) {
        return { success: false, error: "This client's phone number isn't a valid US number." };
    }

    const response = await telzioRequest<any>(config, "/dial/outbound", {
        method: "POST",
        body: { From: from, Aleg: aleg, Bleg: bleg },
    });

    if (!response.success) {
        return { success: false, error: response.error, raw: response.raw };
    }

    return {
        success: true,
        // Telzio's dial docs don't pin down the response shape, so accept the
        // usual spellings and treat "no id" as fine — the call is still placed,
        // we just can't reconcile its outcome automatically.
        callUuid:
            response.data?.CallUUID ??
            response.data?.CallUuid ??
            response.data?.callUuid ??
            response.data?.UUID ??
            null,
        fromNumber: from,
        raw: response.raw,
    };
}

// ── Texting ──────────────────────────────────────────────────────────────────

export interface SendSmsParams {
    clientNumber: string;
    message: string;
    /** Sending number. Defaults to TELZIO_FROM_NUMBER. */
    fromNumber?: string | null;
}

export interface SendSmsResult {
    success: boolean;
    fromNumber?: string;
    error?: string;
    raw?: unknown;
}

/** Sends one SMS from a Telzio number. */
export async function sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    const config = getTelzioConfig();
    if (!config) {
        return {
            success: false,
            error: "Telzio isn't configured (set TELZIO_API_KEY and TELZIO_API_SECRET).",
        };
    }

    const from = toE164(params.fromNumber) ?? config.defaultFromNumber;
    const to = toE164(params.clientNumber);
    const message = params.message.trim();

    if (!from) {
        return { success: false, error: "No sending number configured (set TELZIO_FROM_NUMBER)." };
    }
    if (!to) {
        return { success: false, error: "This client's phone number isn't a valid US number." };
    }
    if (!message) {
        return { success: false, error: "Message is empty." };
    }

    const response = await telzioRequest<any>(config, "/sms/send", {
        method: "POST",
        body: { From: from, To: to, Message: message },
    });

    if (!response.success) {
        return { success: false, error: response.error, raw: response.raw };
    }

    return { success: true, fromNumber: from, raw: response.raw };
}

// ── Numbers ──────────────────────────────────────────────────────────────────

export interface TelzioNumber {
    number_id: number | null;
    e164: string;
}

/**
 * Lists the account's Telzio numbers — the options behind the dialer's
 * switchable caller ID.
 *
 * Returns [] rather than throwing when Telzio is unreachable so the dialer falls
 * back to TELZIO_FROM_NUMBER instead of blocking the rep from calling at all.
 */
export async function listNumbers(): Promise<TelzioNumber[]> {
    const config = getTelzioConfig();
    if (!config) return [];

    const response = await telzioRequest<any>(config, "/numbers?PageSize=100", { method: "GET" });
    if (!response.success) return [];

    // Telzio documents a bare array; tolerate a wrapped shape too.
    const rows: any[] = Array.isArray(response.data)
        ? response.data
        : Array.isArray(response.data?.Numbers)
            ? response.data.Numbers
            : [];

    return rows
        .map((row) => ({
            number_id: typeof row?.NumberID === "number" ? row.NumberID : null,
            e164: toE164(row?.E164) ?? "",
        }))
        .filter((n) => !!n.e164);
}
