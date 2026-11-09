import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A `locked` submission means the file is with underwriting. It is what puts
 * the file on the UW "Ready" tab, and that tab is "everything the team is
 * working right now".
 *
 * Asking for more documents is a normal part of working a file, not a reason to
 * take it away from UW. So the document-request paths leave a locked file
 * locked and notify UW + admins instead. Only files that were never submitted
 * drop to `documents_requested`.
 */
export async function isSubmissionLocked(admin: SupabaseClient, userId: string): Promise<boolean> {
    const { data } = await admin
        .from("submissions")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();
    return data?.status === "locked";
}

/** In-app alert to every underwriter and admin (except whoever made the request). */
export async function notifyUwTeamOfDocRequest(
    admin: SupabaseClient,
    params: {
        clientId: string;
        clientName: string | null;
        companyName: string | null;
        docCount: number;
        requestedBy: string;
        actorUserId: string;
    }
): Promise<void> {
    const { data: staff, error } = await admin
        .from("users")
        .select("id")
        .in("role", ["underwriting", "admin"])
        .neq("id", params.actorUserId);
    if (error) {
        console.error("notifyUwTeamOfDocRequest: failed to load UW/admin users:", error);
        return;
    }
    if (!staff?.length) return;

    const who = [params.clientName, params.companyName && `(${params.companyName})`].filter(Boolean).join(" ") || "A file";
    const docs = `${params.docCount} ${params.docCount === 1 ? "document" : "documents"}`;

    const { error: insertError } = await admin.from("in_app_notifications").insert(
        staff.map(u => ({
            user_id: u.id,
            client_id: params.clientId,
            title: `Documents requested on a file in underwriting`,
            message: `${params.requestedBy} requested ${docs} for ${who}. The file stays in Ready.`,
        }))
    );
    if (insertError) {
        console.error("notifyUwTeamOfDocRequest: insert failed:", insertError);
    }
}
