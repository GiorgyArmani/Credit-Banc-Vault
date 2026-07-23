"use server";

// src/app/actions/communications.ts
//
// The user-facing read/write surface for the communications log
// (M2 / Communications Hub).
//
// EVERY EXPORT OF THIS FILE IS A BROWSER-REACHABLE RPC ENDPOINT. Each one must
// therefore begin with requireStaffForClient(), and nothing un-gated may be
// exported from here — the un-gated writer deliberately lives in
// src/lib/communications-log.ts for exactly that reason.
//
// public.communications has RLS enabled with ZERO policies, so anon and
// authenticated clients cannot reach it directly; all access runs on the service
// role behind the checks below. That mirrors referral_partners / affiliates /
// document_share_links, and avoids adding an RLS policy that joins
// client_followers — the known trigger for 42P17 recursion on this schema.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkClientAccess } from "@/lib/client-access";
import { writeCommunication, COMMUNICATION_COLUMNS } from "@/lib/communications-log";
import {
    sendEmail,
    buildReplyAddress,
    buildFromHeader,
    isMailgunConfigured,
    normalizeMessageId,
} from "@/lib/mailgun";
import {
    dialOutbound,
    sendSms,
    listNumbers,
    isTelzioConfigured,
} from "@/lib/telzio";
import { toE164 } from "@/lib/communications";
import type {
    CommunicationInput,
    CommunicationRow,
    CommunicationChannel,
} from "@/lib/communications";

/** Postgres "relation does not exist" — the migration hasn't been applied yet. */
const UNDEFINED_TABLE = "42P01";

interface StaffIdentity {
    userId: string;
    name: string;
    role: string;
}

/**
 * Auth gate for the log. Staff who work a file may read and write its
 * communications:
 *   * admin / underwriting — role alone is sufficient (they work every file)
 *   * advisor / setter     — must own or follow the client
 *   * free (clients)       — never
 *
 * Returns the caller's identity so inserts can denormalize staff_name /
 * staff_role onto the row (the client_internal_notes pattern: the attribution
 * label has to survive the staff account being deleted).
 */
async function requireStaffForClient(clientId: string): Promise<StaffIdentity> {
    const supabase = await createClient();
    const supabaseAdmin = createAdminClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: profile } = await supabaseAdmin
        .from("users")
        .select("role, first_name, last_name")
        .eq("id", user.id)
        .maybeSingle();

    const role = (profile?.role as string) ?? "";
    if (!role || role === "free") {
        throw new Error("Access denied: staff only");
    }

    // Admin and underwriting work every file; advisors and setters only theirs.
    if (role !== "admin" && role !== "underwriting") {
        const access = await checkClientAccess(supabase, user.id, clientId);
        if (!access.isOwner && !access.isFollower && !access.isAdmin) {
            throw new Error("Access denied: You do not have access to this client");
        }
    }

    const name = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim();

    return { userId: user.id, name: name || "Staff", role };
}

export interface ListCommunicationsOptions {
    /** Restrict to one channel (the timeline's Calls / Texts / Emails filter). */
    channel?: CommunicationChannel;
    /**
     * Hide system-generated mail (doc reminders, magic links) so a rep sees only
     * real human contact. Defaults to false — the full record.
     */
    humanOnly?: boolean;
    limit?: number;
}

/**
 * Newest-first communications for one client.
 *
 * Returns an empty list (not an error) when the table is missing, so a deploy
 * that lands ahead of the migration renders the empty timeline rather than
 * breaking the whole client detail page.
 */
export async function listCommunications(
    clientId: string,
    options: ListCommunicationsOptions = {},
): Promise<{ success: boolean; communications: CommunicationRow[]; error?: string }> {
    try {
        await requireStaffForClient(clientId);

        const supabaseAdmin = createAdminClient();
        let query = supabaseAdmin
            .from("communications")
            .select(COMMUNICATION_COLUMNS)
            .eq("client_id", clientId)
            .order("occurred_at", { ascending: false })
            .limit(options.limit ?? 200);

        if (options.channel) query = query.eq("channel", options.channel);
        if (options.humanOnly) query = query.eq("is_automated", false);

        const { data, error } = await query;

        if (error) {
            if (error.code === UNDEFINED_TABLE) {
                return { success: true, communications: [] };
            }
            throw error;
        }

        return {
            success: true,
            communications: (data ?? []) as unknown as CommunicationRow[],
        };
    } catch (error: any) {
        console.error("listCommunications error:", error);
        return { success: false, communications: [], error: error.message };
    }
}

/**
 * Writes one communication on behalf of the signed-in staff member. Used by the
 * "log a call" form today; the Telzio and Mailgun adapters write through
 * lib/communications-log.ts instead, since they run without a user session.
 */
export async function logCommunication(
    clientId: string,
    input: CommunicationInput,
): Promise<{ success: boolean; communication?: CommunicationRow; error?: string }> {
    try {
        const staff = await requireStaffForClient(clientId);
        return await writeCommunication(clientId, input, {
            userId: staff.userId,
            name: staff.name,
            role: staff.role,
        });
    } catch (error: any) {
        console.error("logCommunication error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Convenience wrapper for the "log the call I just made" form — the one writer
 * that exists before the Telzio integration lands. Also covers a manually
 * logged text, since reps text from their own handset today.
 */
export async function logManualContact(params: {
    clientId: string;
    channel?: CommunicationChannel;
    direction: "inbound" | "outbound";
    /** false = tried but didn't reach them; still counts as activity on the file. */
    connected: boolean;
    notes?: string;
    durationSeconds?: number | null;
    businessProfileId?: string | null;
    /** ISO string. Omit for "just now"; pass it when back-filling yesterday's call. */
    occurredAt?: string | null;
}): Promise<{ success: boolean; communication?: CommunicationRow; error?: string }> {
    return logCommunication(params.clientId, {
        channel: params.channel ?? "call",
        direction: params.direction,
        status: params.connected ? "completed" : "missed",
        body: params.notes?.trim() || null,
        duration_seconds: params.durationSeconds ?? null,
        business_profile_id: params.businessProfileId ?? null,
        occurred_at: params.occurredAt ?? null,
        provider: "manual",
    });
}

/**
 * Places a click-to-call and logs it.
 *
 * Telzio rings the REP first (their own desk or cell), then bridges to the
 * client once they pick up — so nothing here streams audio through the browser,
 * and the rep's handset is the phone that rings.
 *
 * The row is written with status "sent" (Telzio accepted the request) because
 * the outcome isn't known yet; whether it connected, and for how long, is filled
 * in later by call-event reconciliation.
 */
export async function placeCall(params: {
    clientId: string;
    /** Caller ID to show the client. Defaults to TELZIO_FROM_NUMBER. */
    fromNumber?: string | null;
    businessProfileId?: string | null;
}): Promise<{ success: boolean; communication?: CommunicationRow; error?: string }> {
    try {
        const staff = await requireStaffForClient(params.clientId);

        if (!isTelzioConfigured()) {
            throw new Error(
                "Calling isn't configured yet — TELZIO_API_KEY and TELZIO_API_SECRET must both be set."
            );
        }

        const supabaseAdmin = createAdminClient();

        const [{ data: client }, { data: advisor }] = await Promise.all([
            supabaseAdmin
                .from("client_data_vault")
                .select("id, client_phone")
                .eq("id", params.clientId)
                .maybeSingle(),
            supabaseAdmin
                .from("advisors")
                .select("phone")
                .eq("user_id", staff.userId)
                .maybeSingle(),
        ]);

        if (!client?.client_phone) throw new Error("This client has no phone number on file");
        if (!advisor?.phone) {
            throw new Error(
                "Add your own phone number to your advisor profile first — that's the phone we ring before connecting the client."
            );
        }

        const result = await dialOutbound({
            repNumber: advisor.phone,
            clientNumber: client.client_phone,
            fromNumber: params.fromNumber,
        });

        const author = { userId: staff.userId, name: staff.name, role: staff.role };

        if (!result.success) {
            // A failed dial attempt is still a fact about the file.
            await writeCommunication(
                params.clientId,
                {
                    channel: "call",
                    direction: "outbound",
                    status: "failed",
                    from_address: toE164(params.fromNumber ?? null),
                    to_address: toE164(client.client_phone),
                    provider: "telzio",
                    business_profile_id: params.businessProfileId ?? null,
                    error_message: result.error ?? "Could not place the call",
                },
                author,
            );
            throw new Error(result.error ?? "Could not place the call");
        }

        return await writeCommunication(
            params.clientId,
            {
                channel: "call",
                direction: "outbound",
                status: "sent",
                from_address: result.fromNumber ?? null,
                to_address: toE164(client.client_phone),
                provider: "telzio",
                provider_message_id: result.callUuid ?? null,
                business_profile_id: params.businessProfileId ?? null,
            },
            author,
        );
    } catch (error: any) {
        console.error("placeCall error:", error);
        return { success: false, error: error.message };
    }
}

/** Sends an SMS from a Telzio number and logs it on the timeline. */
export async function sendClientSms(params: {
    clientId: string;
    message: string;
    fromNumber?: string | null;
    businessProfileId?: string | null;
}): Promise<{ success: boolean; communication?: CommunicationRow; error?: string }> {
    try {
        const staff = await requireStaffForClient(params.clientId);

        if (!isTelzioConfigured()) {
            throw new Error(
                "Texting isn't configured yet — TELZIO_API_KEY and TELZIO_API_SECRET must both be set."
            );
        }

        const message = params.message.trim();
        if (!message) throw new Error("Message is empty");

        const supabaseAdmin = createAdminClient();
        const { data: client } = await supabaseAdmin
            .from("client_data_vault")
            .select("id, client_phone")
            .eq("id", params.clientId)
            .maybeSingle();

        if (!client?.client_phone) throw new Error("This client has no phone number on file");

        const result = await sendSms({
            clientNumber: client.client_phone,
            message,
            fromNumber: params.fromNumber,
        });

        const author = { userId: staff.userId, name: staff.name, role: staff.role };

        if (!result.success) {
            await writeCommunication(
                params.clientId,
                {
                    channel: "sms",
                    direction: "outbound",
                    status: "failed",
                    to_address: toE164(client.client_phone),
                    body: message,
                    provider: "telzio",
                    business_profile_id: params.businessProfileId ?? null,
                    error_message: result.error ?? "Could not send the text",
                },
                author,
            );
            throw new Error(result.error ?? "Could not send the text");
        }

        return await writeCommunication(
            params.clientId,
            {
                channel: "sms",
                direction: "outbound",
                status: "sent",
                from_address: result.fromNumber ?? null,
                to_address: toE164(client.client_phone),
                body: message,
                provider: "telzio",
                business_profile_id: params.businessProfileId ?? null,
            },
            author,
        );
    } catch (error: any) {
        console.error("sendClientSms error:", error);
        return { success: false, error: error.message };
    }
}

export interface CommunicationCapabilities {
    /** Telzio click-to-call is available. */
    calling: boolean;
    /** Telzio SMS is available. */
    texting: boolean;
    /** Mailgun sending is available. */
    email: boolean;
    /** Caller-ID options for the number switcher. */
    numbers: string[];
    /** The rep's own phone is on file — required before any call can be placed. */
    repPhoneOnFile: boolean;
}

/**
 * What this rep can actually do from the lead record right now.
 *
 * The UI asks once on mount and hides or explains the actions it can't perform,
 * so a half-configured environment shows "calling isn't set up" rather than
 * offering a button that always fails.
 */
export async function getCommunicationCapabilities(): Promise<CommunicationCapabilities> {
    const empty: CommunicationCapabilities = {
        calling: false,
        texting: false,
        email: false,
        numbers: [],
        repPhoneOnFile: false,
    };

    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return empty;

        const telzio = isTelzioConfigured();

        const supabaseAdmin = createAdminClient();
        const { data: advisor } = await supabaseAdmin
            .from("advisors")
            .select("phone")
            .eq("user_id", user.id)
            .maybeSingle();

        const numbers = telzio ? (await listDialerNumbers()).numbers : [];

        return {
            calling: telzio,
            texting: telzio,
            email: isMailgunConfigured(),
            numbers,
            repPhoneOnFile: !!toE164(advisor?.phone ?? null),
        };
    } catch (error: any) {
        console.error("getCommunicationCapabilities error:", error);
        return empty;
    }
}

/**
 * The caller-ID options for the dialer's number switcher.
 *
 * Falls back to the configured default when Telzio can't be reached, so an API
 * hiccup degrades the picker rather than blocking calls entirely.
 */
export async function listDialerNumbers(): Promise<{ numbers: string[]; configured: boolean }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { numbers: [], configured: false };

        if (!isTelzioConfigured()) return { numbers: [], configured: false };

        const numbers = await listNumbers();
        if (numbers.length > 0) {
            return { numbers: numbers.map((n) => n.e164), configured: true };
        }

        const fallback = toE164(process.env.TELZIO_FROM_NUMBER ?? null);
        return { numbers: fallback ? [fallback] : [], configured: true };
    } catch (error: any) {
        console.error("listDialerNumbers error:", error);
        return { numbers: [], configured: false };
    }
}

/**
 * Sends an email to the client from inside the app and records it on the
 * timeline, so an advisor never has to leave the file to write to a client and
 * nothing they send goes unlogged.
 *
 * Threading: replies carry In-Reply-To and References pointing at the message
 * being answered, and inherit that conversation's thread_key. A fresh message
 * starts its own thread, keyed on the Message-Id Mailgun hands back. The
 * client's reply comes home via the `reply+<vaultId>@` Reply-To and lands in
 * /api/webhooks/mailgun-inbound.
 */
export async function sendClientEmail(params: {
    clientId: string;
    subject: string;
    body: string;
    /** id of the communication being replied to, if this is a reply. */
    replyToCommunicationId?: string | null;
    businessProfileId?: string | null;
    cc?: string[];
}): Promise<{ success: boolean; communication?: CommunicationRow; error?: string }> {
    try {
        const staff = await requireStaffForClient(params.clientId);

        if (!isMailgunConfigured()) {
            throw new Error(
                "Email sending isn't configured yet — MAILGUN_API_KEY and MAILGUN_DOMAIN must both be set."
            );
        }

        const subject = params.subject.trim();
        const body = params.body.trim();
        if (!subject) throw new Error("Subject is required");
        if (!body) throw new Error("Message body is required");

        const supabaseAdmin = createAdminClient();

        const { data: client } = await supabaseAdmin
            .from("client_data_vault")
            .select("id, client_email, client_name")
            .eq("id", params.clientId)
            .maybeSingle();

        if (!client?.client_email) {
            throw new Error("This client has no email address on file");
        }

        // Resolve the conversation we're continuing, if any.
        let inReplyTo: string | null = null;
        let references: string | null = null;
        let threadKey: string | null = null;

        if (params.replyToCommunicationId) {
            const { data: parent } = await supabaseAdmin
                .from("communications")
                .select("client_id, provider_message_id, thread_key")
                .eq("id", params.replyToCommunicationId)
                .maybeSingle();

            // Ignore a parent belonging to a different client rather than
            // cross-linking two files' conversations.
            if (parent && parent.client_id === params.clientId) {
                inReplyTo = normalizeMessageId(parent.provider_message_id) ?? null;
                threadKey = parent.thread_key ?? inReplyTo;
                // Oldest first: thread root, then immediate parent.
                references = [threadKey, inReplyTo]
                    .filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i)
                    .join(" ") || null;
            }
        }

        const result = await sendEmail({
            to: client.client_email,
            subject,
            text: body,
            // Shows the client the rep's name, not a system mailbox.
            from: buildFromHeader(staff.name) ?? undefined,
            replyTo: buildReplyAddress(params.clientId),
            inReplyTo,
            references,
            cc: params.cc,
            tags: ["vault-advisor-email"],
        });

        if (!result.success) {
            // Record the attempt anyway — "we tried to email them and it
            // bounced" is exactly the kind of fact that otherwise disappears.
            await writeCommunication(
                params.clientId,
                {
                    channel: "email",
                    direction: "outbound",
                    status: "failed",
                    to_address: client.client_email,
                    subject,
                    body,
                    provider: "mailgun",
                    business_profile_id: params.businessProfileId ?? null,
                    error_message: result.error ?? "Send failed",
                },
                { userId: staff.userId, name: staff.name, role: staff.role },
            );
            throw new Error(result.error ?? "Mailgun refused the message");
        }

        return await writeCommunication(
            params.clientId,
            {
                channel: "email",
                direction: "outbound",
                status: "sent",
                to_address: client.client_email,
                subject,
                body,
                provider: "mailgun",
                provider_message_id: result.messageId ?? null,
                // A new conversation is keyed on its own Message-Id.
                thread_key: threadKey ?? result.messageId ?? null,
                in_reply_to: inReplyTo,
                business_profile_id: params.businessProfileId ?? null,
                is_automated: false,
            },
            { userId: staff.userId, name: staff.name, role: staff.role },
        );
    } catch (error: any) {
        console.error("sendClientEmail error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Deletes a mis-logged manual entry. Restricted to manual rows: provider-sourced
 * rows are the system's record of what actually happened on the wire and must
 * not be editable from the UI.
 */
export async function deleteManualCommunication(
    clientId: string,
    communicationId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const staff = await requireStaffForClient(clientId);

        const supabaseAdmin = createAdminClient();
        const { data: existing, error: readError } = await supabaseAdmin
            .from("communications")
            .select("id, client_id, provider, staff_user_id")
            .eq("id", communicationId)
            .maybeSingle();

        if (readError) throw readError;
        if (!existing) throw new Error("Entry not found");
        // Guards against passing another client's id alongside a client this
        // caller happens to have access to.
        if (existing.client_id !== clientId) throw new Error("Entry not found");
        if (existing.provider !== "manual") {
            throw new Error("Only manually logged entries can be removed");
        }
        // Authors clean up their own mistakes; admins can clean up anyone's.
        if (staff.role !== "admin" && existing.staff_user_id !== staff.userId) {
            throw new Error("Only the author or an admin can remove this entry");
        }

        const { error } = await supabaseAdmin
            .from("communications")
            .delete()
            .eq("id", communicationId);

        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        console.error("deleteManualCommunication error:", error);
        return { success: false, error: error.message };
    }
}
