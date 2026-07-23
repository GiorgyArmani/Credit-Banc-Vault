// src/lib/communications-log.ts
//
// The raw writer for public.communications. Server-side only.
//
// THIS MODULE IS NOT A SERVER ACTION AND MUST NOT BECOME ONE. It performs no
// auth check — it exists for callers that have already established trust some
// other way:
//   * provider webhook routes (Telzio, Mailgun) that verified a signature
//   * cron jobs and lib/email.ts logging a transactional send they just made
//
// Interactive, user-initiated writes go through src/app/actions/communications.ts
// instead, which gates on the caller's role and client access first. Keeping the
// un-gated insert out of a "use server" module matters: every export of a
// "use server" file is reachable from the browser as an RPC endpoint, so an
// un-gated writer living there would be a public write endpoint into every
// client's activity history.
//
// The table has RLS enabled with zero policies, so this necessarily runs on the
// service role. See supabase/migrations/20260722_communications_log.sql.

import { createAdminClient } from "@/lib/supabase/admin";
import type { CommunicationInput, CommunicationRow } from "@/lib/communications";

/** Postgres "relation does not exist" — the migration hasn't been applied yet. */
const UNDEFINED_TABLE = "42P01";
/** Postgres unique violation — a provider redelivered a webhook we already have. */
const UNIQUE_VIOLATION = "23505";

export const COMMUNICATION_COLUMNS = `
    id, client_id, business_profile_id,
    staff_user_id, staff_name, staff_role,
    channel, direction, status,
    from_address, to_address,
    subject, body, body_html,
    duration_seconds, recording_url,
    provider, provider_status, provider_message_id,
    thread_key, in_reply_to,
    is_automated, error_message,
    occurred_at, created_at
`;

/** Who, on our side, the row is attributed to. All fields optional for inbound. */
export interface CommunicationAuthor {
    userId?: string | null;
    name?: string | null;
    role?: string | null;
}

export interface WriteResult {
    success: boolean;
    communication?: CommunicationRow;
    error?: string;
}

/**
 * Inserts one communication and returns the stored row.
 *
 * Idempotent for provider-sourced rows: a collision on the partial unique index
 * over (provider, provider_message_id) means the provider redelivered a webhook
 * we already logged, so we return the existing row as a success instead of
 * double-entering the conversation into the client's timeline.
 *
 * Throws only on genuinely unexpected failures; callers in webhook routes should
 * catch and still return 200 so the provider stops retrying a poison payload.
 */
export async function writeCommunication(
    clientId: string,
    input: CommunicationInput,
    author: CommunicationAuthor = {},
): Promise<WriteResult> {
    const supabaseAdmin = createAdminClient();

    const row = {
        client_id: clientId,
        business_profile_id: input.business_profile_id ?? null,
        // Rows we cannot attribute stay unattributed rather than being credited
        // to whoever happened to trigger the write.
        staff_user_id: author.userId || null,
        staff_name: author.name || null,
        staff_role: author.role || null,
        channel: input.channel,
        direction: input.direction,
        status: input.status ?? "logged",
        from_address: input.from_address ?? null,
        to_address: input.to_address ?? null,
        subject: input.subject ?? null,
        body: input.body ?? null,
        body_html: input.body_html ?? null,
        duration_seconds: input.duration_seconds ?? null,
        recording_url: input.recording_url ?? null,
        provider: input.provider ?? "manual",
        provider_status: input.provider_status ?? null,
        provider_message_id: input.provider_message_id ?? null,
        provider_payload: input.provider_payload ?? null,
        thread_key: input.thread_key ?? null,
        in_reply_to: input.in_reply_to ?? null,
        is_automated: input.is_automated ?? false,
        error_message: input.error_message ?? null,
        occurred_at: input.occurred_at ?? new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
        .from("communications")
        .insert(row)
        .select(COMMUNICATION_COLUMNS)
        .single();

    if (error) {
        if (error.code === UNDEFINED_TABLE) {
            throw new Error(
                "Communications log unavailable — migration 20260722_communications_log.sql has not been applied."
            );
        }

        if (error.code === UNIQUE_VIOLATION && input.provider_message_id) {
            const { data: existing } = await supabaseAdmin
                .from("communications")
                .select(COMMUNICATION_COLUMNS)
                .eq("provider", row.provider)
                .eq("provider_message_id", input.provider_message_id)
                .maybeSingle();
            return {
                success: true,
                communication: (existing ?? undefined) as CommunicationRow | undefined,
            };
        }

        throw error;
    }

    return { success: true, communication: data as unknown as CommunicationRow };
}

/**
 * Best-effort variant for fire-and-forget call sites — a transactional email
 * that was already sent, a webhook that has already done its real work. Logging
 * must never be the reason one of those fails, so this swallows and reports.
 */
export async function tryWriteCommunication(
    clientId: string,
    input: CommunicationInput,
    author: CommunicationAuthor = {},
): Promise<WriteResult> {
    try {
        return await writeCommunication(clientId, input, author);
    } catch (error: any) {
        console.error("tryWriteCommunication error:", error?.message ?? error);
        return { success: false, error: error?.message ?? String(error) };
    }
}
