// src/lib/communications.ts
//
// Shared vocabulary for the communications log (M2 / Communications Hub).
//
// This module is deliberately provider-free — no Telzio, no Mailgun, no network
// calls. It holds the types and pure helpers that the DB rows, the server
// actions and the timeline UI all agree on, so that when the Telzio and Mailgun
// adapters land they translate INTO this shape rather than leaking their own.
//
// See supabase/migrations/20260722_communications_log.sql for the table these
// types mirror, including why status is normalized here instead of storing each
// provider's raw wording.

export type CommunicationChannel = "call" | "sms" | "email";
export type CommunicationDirection = "inbound" | "outbound";

export type CommunicationStatus =
    | "queued"
    | "sent"
    | "delivered"
    | "received"
    | "completed"
    | "missed"
    | "failed"
    | "logged";

export type CommunicationProvider = "manual" | "telzio" | "mailgun" | "ghl" | "smtp";

/** One row of public.communications, as the UI consumes it. */
export interface CommunicationRow {
    id: string;
    client_id: string;
    business_profile_id: string | null;
    staff_user_id: string | null;
    staff_name: string | null;
    staff_role: string | null;
    channel: CommunicationChannel;
    direction: CommunicationDirection;
    status: CommunicationStatus;
    from_address: string | null;
    to_address: string | null;
    subject: string | null;
    body: string | null;
    body_html: string | null;
    duration_seconds: number | null;
    recording_url: string | null;
    provider: CommunicationProvider;
    provider_status: string | null;
    provider_message_id: string | null;
    thread_key: string | null;
    in_reply_to: string | null;
    is_automated: boolean;
    error_message: string | null;
    occurred_at: string;
    created_at: string;
}

/**
 * What a caller hands to logCommunication(). client_id is supplied separately by
 * the action (it is the thing being access-checked), and every field the DB
 * defaults is optional here.
 */
export interface CommunicationInput {
    channel: CommunicationChannel;
    direction: CommunicationDirection;
    status?: CommunicationStatus;
    business_profile_id?: string | null;
    from_address?: string | null;
    to_address?: string | null;
    subject?: string | null;
    body?: string | null;
    body_html?: string | null;
    duration_seconds?: number | null;
    recording_url?: string | null;
    provider?: CommunicationProvider;
    provider_status?: string | null;
    provider_message_id?: string | null;
    /** Raw provider event, kept verbatim so undocumented fields aren't lost. */
    provider_payload?: unknown;
    thread_key?: string | null;
    in_reply_to?: string | null;
    is_automated?: boolean;
    error_message?: string | null;
    /** ISO string. Defaults to now() — pass it when logging a past interaction. */
    occurred_at?: string | null;
}

/**
 * Statuses that mean "this contact attempt did not reach the client". The
 * timeline dims these, and the activity-age calculation still counts them (a
 * rep trying and missing is real work on the file).
 */
export const UNREACHED_STATUSES: readonly CommunicationStatus[] = ["missed", "failed"];

export function isUnreached(status: CommunicationStatus): boolean {
    return UNREACHED_STATUSES.includes(status);
}

/** Short label for a row's status pill. */
export function statusLabel(status: CommunicationStatus): string {
    switch (status) {
        case "queued": return "Queued";
        case "sent": return "Sent";
        case "delivered": return "Delivered";
        case "received": return "Received";
        case "completed": return "Connected";
        case "missed": return "No answer";
        case "failed": return "Failed";
        case "logged": return "Logged";
    }
}

export function channelLabel(channel: CommunicationChannel): string {
    switch (channel) {
        case "call": return "Call";
        case "sms": return "Text";
        case "email": return "Email";
    }
}

/**
 * "Outbound call — Connected · 4m 12s" style one-liner used as the timeline
 * entry header and as the summary on collapsed sections.
 */
export function describeCommunication(row: Pick<CommunicationRow, "channel" | "direction" | "status" | "duration_seconds">): string {
    const lead = `${row.direction === "inbound" ? "Inbound" : "Outbound"} ${channelLabel(row.channel).toLowerCase()}`;
    const parts = [statusLabel(row.status)];
    if (row.channel === "call" && row.duration_seconds != null && row.duration_seconds > 0) {
        parts.push(formatDuration(row.duration_seconds));
    }
    return `${lead} — ${parts.join(" · ")}`;
}

/** 272 -> "4m 32s", 45 -> "45s", 3700 -> "1h 1m". */
export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

/**
 * Best-effort E.164 for US/CA numbers, which is everything this book of business
 * dials. Returns null when the input can't be a phone number, so callers can
 * refuse to place a call rather than sending garbage to the provider.
 *
 * Kept permissive on input (accepts "(555) 010-1234", "555.010.1234",
 * "+1 555 010 1234") because these strings come from client_data_vault.client_phone,
 * which has never been format-constrained.
 */
export function toE164(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    // Already-normalized international numbers pass through untouched.
    if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;

    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return null;
}

/** "+15550101234" -> "(555) 010-1234". Falls back to the input when unparseable. */
export function formatPhone(raw: string | null | undefined): string {
    if (!raw) return "";
    const digits = raw.replace(/\D/g, "");
    const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (local.length !== 10) return raw;
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}
