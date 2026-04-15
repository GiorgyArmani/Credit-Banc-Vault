"use server";

import { createClient } from "@/lib/supabase/server";

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
 * 4. client_data_vault (creation date)
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

    // 2. Query loan_status_history
    const { data: statusHistory } = await supabase
        .from("loan_status_history")
        .select("client_vault_id, created_at")
        .in("client_vault_id", vaultIds);

    statusHistory?.forEach(s => {
        const current = activityMap.get(s.client_vault_id);
        const latest = new Date(s.created_at);
        if (!current || latest > current) {
            activityMap.set(s.client_vault_id, latest);
        }
    });

    // 3. Query user_documents
    const { data: userDocs } = await supabase
        .from("user_documents")
        .select("user_id, upload_date")
        .in("user_id", userIds);

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

    // 4. Query client_internal_notes
    const { data: internalNotes } = await supabase
        .from("client_internal_notes")
        .select("client_id, created_at")
        .in("client_id", vaultIds);

    internalNotes?.forEach(n => {
        const current = activityMap.get(n.client_id);
        const latest = new Date(n.created_at);
        if (!current || latest > current) {
            activityMap.set(n.client_id, latest);
        }
    });

    // Convert back to string ISO
    const result = new Map<string, string>();
    activityMap.forEach((date, id) => {
        result.set(id, date.toISOString());
    });

    return result;
}
