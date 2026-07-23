"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ClientActivity {
    vault_id: string;
    last_activity_at: string;
}

/**
 * Fetches the most recent activity timestamp for a list of client vault IDs.
 * Activity sources:
 * 1. loan_status_history (status updates)
 * 2. user_documents (document uploads)
 * 3. client_internal_notes (internal communication)
 * 4. communications (calls, texts and emails with the client)
 * 5. client_data_vault (creation date)
 *
 * Source 4 is what makes reaching a client count as working the file: it feeds
 * the activity-age badge and, through it, the stale-file auto-reassignment cron.
 * Automated sends (doc reminders, magic links) are excluded on purpose — a bot
 * emailing the client is not a rep touching the file, and counting it would keep
 * abandoned files looking fresh forever.
 */
export async function getBulkClientActivity(vaultIds: string[]): Promise<Map<string, string>> {
    if (vaultIds.length === 0) return new Map();

    const supabase = await createClient();
    const activityMap = new Map<string, Date>();

    // 1. Get baseline and user_ids from client_data_vault
    const { data: vaultData } = await supabase
        .from("client_data_vault")
        .select("id, user_id, created_at")
        .in("id", vaultIds);

    const userToVault = new Map<string, string>();
    vaultData?.forEach(v => {
        userToVault.set(v.user_id, v.id);
        const createdAt = new Date(v.created_at);
        activityMap.set(v.id, createdAt);
    });

    const userIds = Array.from(userToVault.keys());

    // Queries 2-5 only depend on vaultIds/userIds (known here), so run them in
    // parallel instead of four sequential round-trips.
    //
    // The communications read goes through the service role because that table
    // has RLS enabled with zero policies by design — an RLS-gated client sees
    // nothing there. It is scoped safely: the merge below only touches vault ids
    // already present in activityMap, i.e. rows this caller could read under RLS
    // in query 1. Passing in someone else's vault id still yields nothing.
    const supabaseAdmin = createAdminClient();
    const [{ data: statusHistory }, { data: userDocs }, { data: internalNotes }, { data: comms }] = await Promise.all([
        supabase
            .from("loan_status_history")
            .select("client_vault_id, created_at")
            .in("client_vault_id", vaultIds),
        supabase
            .from("user_documents")
            .select("user_id, upload_date")
            .in("user_id", userIds),
        supabase
            .from("client_internal_notes")
            .select("client_id, created_at")
            .in("client_id", vaultIds),
        supabaseAdmin
            .from("communications")
            .select("client_id, occurred_at")
            .in("client_id", vaultIds)
            .eq("is_automated", false),
    ]);

    // 2. loan_status_history
    statusHistory?.forEach(s => {
        const current = activityMap.get(s.client_vault_id);
        const latest = new Date(s.created_at);
        if (!current || latest > current) {
            activityMap.set(s.client_vault_id, latest);
        }
    });

    // 3. user_documents
    userDocs?.forEach(d => {
        const vaultId = userToVault.get(d.user_id);
        if (vaultId) {
            const current = activityMap.get(vaultId);
            const latest = new Date(d.upload_date);
            if (!current || latest > current) {
                activityMap.set(vaultId, latest);
            }
        }
    });

    // 4. client_internal_notes
    internalNotes?.forEach(n => {
        const current = activityMap.get(n.client_id);
        const latest = new Date(n.created_at);
        if (!current || latest > current) {
            activityMap.set(n.client_id, latest);
        }
    });

    // 5. communications. `comms` is null when the 20260722 migration has not
    // been applied yet, which simply means this source contributes nothing.
    comms?.forEach(c => {
        const current = activityMap.get(c.client_id);
        // Only vaults the caller could already read (see the scoping note above).
        if (!current) return;
        const latest = new Date(c.occurred_at);
        if (latest > current) {
            activityMap.set(c.client_id, latest);
        }
    });

    // Convert back to string ISO
    const result = new Map<string, string>();
    activityMap.forEach((date, id) => {
        result.set(id, date.toISOString());
    });

    return result;
}
