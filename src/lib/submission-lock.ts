import type { SupabaseClient } from "@supabase/supabase-js";
import { slackPostMessage, getUwUserIds, formatMentions } from "@/lib/slack-api";

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

/**
 * Tell underwriting and admins (except whoever made the request) that more
 * documents were requested on a file they're working.
 *
 * In-app alone goes unread (573 of 577 UW/admin notifications were in Nov
 * 2026), so with `slack` it also posts in the deal's Slack channel, where UW
 * already works the file. UW's own request path posts there itself, so it
 * passes `slack: false`.
 */
export async function notifyUwTeamOfDocRequest(
    admin: SupabaseClient,
    params: {
        clientId: string;
        clientName: string | null;
        companyName: string | null;
        docCount: number;
        requestedBy: string;
        actorUserId: string;
        slack?: boolean;
    }
): Promise<void> {
    if (params.slack) {
        try {
            const { data: vault } = await admin
                .from("client_data_vault")
                .select("slack_channel_id, company_name")
                .eq("id", params.clientId)
                .maybeSingle();
            const channel = (vault as any)?.slack_channel_id as string | null;
            if (channel) {
                const docs = `${params.docCount} ${params.docCount === 1 ? "document" : "documents"}`;
                const mentions = formatMentions(getUwUserIds());
                await slackPostMessage(
                    channel,
                    `📄 ${mentions ? mentions + " " : ""}${params.requestedBy} requested ${docs} from the client on ` +
                        `*${(vault as any)?.company_name ?? params.companyName ?? "this file"}*. The file stays in UW Ready.`
                );
            }
        } catch (err) {
            console.error("notifyUwTeamOfDocRequest: Slack post failed (non-fatal):", err);
        }
    }

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
