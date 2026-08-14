"use server";

import { createClient } from "@supabase/supabase-js";
import { send_lender_match_ready_notification } from "@/lib/email";
import { slackPostMessage, getApproverUserIds, resolveAdvisorSlackId, formatMentions } from "@/lib/slack-api";

const supabase_admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

interface RecommendedLender {
    lender_name: string;
    specialty: string | null;
}

/**
 * Notifies all admins (in-app + email + Slack) when UW saves their lender
 * selection for a client.
 *
 * INFORMATIONAL, NOT A HANDOFF. The lenders are already cleared for submission
 * when this fires — UW is not waiting on anyone. Admins read the Slack post and
 * can veto a lender from the Lender Match card on the unified client view; the
 * wording below has to say that, because a message that reads like a request for
 * approval recreates the stall this change removed.
 *
 * Returns { notified, emailed, admins } so the caller can surface a count and
 * so a missed recipient is observable in logs (an earlier incident silently
 * notified only one of two admins). In-app and email are independent: one
 * failing never blocks the other, and neither throws — UW's save succeeded
 * regardless of whether notifications fan out.
 */
export async function notifyAdminsOfLenderMatchSaved(
    clientId: string,
    recommended: RecommendedLender[]
) {
    if (!clientId) return { notified: 0, emailed: 0, admins: 0 };

    let admin_users: { id: string; email: string }[] = [];
    let client_name = "a client";
    let company_name: string | undefined;
    let slack_channel_id: string | null = null;
    let advisor_email: string | null = null;

    try {
        // Pull all admin users + the client name for the message body.
        const [{ data: admins }, { data: client_row }] = await Promise.all([
            supabase_admin.from("users").select("id, email").eq("role", "admin"),
            supabase_admin.from("client_data_vault").select("client_name, company_name, slack_channel_id, advisors(email)").eq("id", clientId).maybeSingle(),
        ]);

        admin_users = (admins ?? []) as { id: string; email: string }[];
        client_name = client_row?.client_name || client_row?.company_name || "a client";
        company_name = client_row?.company_name ?? undefined;
        slack_channel_id = (client_row as any)?.slack_channel_id ?? null;
        const adv: any = Array.isArray((client_row as any)?.advisors) ? (client_row as any).advisors[0] : (client_row as any)?.advisors;
        advisor_email = adv?.email ?? null;

        // Log exactly who we found — this is how a missed admin becomes visible
        // instead of silently dropped.
        console.log(
            `notifyAdminsOfLenderMatchSaved: client=${clientId} found ${admin_users.length} admin(s):`,
            admin_users.map((u) => u.email)
        );

        if (admin_users.length === 0) {
            console.warn("notifyAdminsOfLenderMatchSaved: no admin users found (check users.role = 'admin')");
            return { notified: 0, emailed: 0, admins: 0 };
        }
    } catch (err: any) {
        console.error("notifyAdminsOfLenderMatchSaved: failed to load admins/client:", err);
        return { notified: 0, emailed: 0, admins: 0 };
    }

    const lender_names = recommended.map(
        (r) => `${r.lender_name}${r.specialty ? ` (${r.specialty})` : ""}`
    );
    const lender_summary = recommended.length === 0
        ? "no lenders recommended"
        : recommended.length === 1
            ? lender_names[0]
            : `${recommended.length} lenders`;

    const title = `Lenders selected — ${client_name}`;
    const message = `Underwriting selected ${lender_summary} for ${client_name} and they are cleared to submit. No action needed — open the file only if you want one pulled.`;

    // ── In-app: one row per admin (service role → bypasses RLS). ──────────────
    let notified = 0;
    try {
        const rows = admin_users.map((u) => ({
            user_id: u.id,
            client_id: clientId,
            title,
            message,
            is_read: false,
        }));

        const { error: insert_err } = await supabase_admin
            .from("in_app_notifications")
            .insert(rows);

        if (insert_err) {
            console.error("notifyAdminsOfLenderMatchSaved in-app insert error:", insert_err);
        } else {
            notified = admin_users.length;
        }
    } catch (err: any) {
        console.error("notifyAdminsOfLenderMatchSaved in-app exception:", err);
    }

    // ── Email: one message to all admins at once. ─────────────────────────────
    let emailed = 0;
    try {
        const admin_emails = admin_users
            .map((u) => u.email)
            .filter((e): e is string => !!e && e.includes("@"));

        if (admin_emails.length > 0) {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
            await send_lender_match_ready_notification({
                admin_emails,
                client_name,
                company_name,
                recommended_lenders: lender_names,
                client_profile_url: `${baseUrl}/admin/clients/${clientId}`,
            });
            emailed = admin_emails.length;
        } else {
            console.warn("notifyAdminsOfLenderMatchSaved: no valid admin emails to send to");
        }
    } catch (err: any) {
        console.error("notifyAdminsOfLenderMatchSaved email error (non-fatal):", err);
    }

    // ── Slack: post into the deal channel (if one exists) so Matt/Luigi + the
    //    advisor see the selection. This is the surface admins actually read,
    //    and it is now the whole review step — hence the lender names inline,
    //    rather than a link asking them to go and approve something. ───────────
    try {
        if (slack_channel_id) {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
            const mentions = formatMentions([...getApproverUserIds(), resolveAdvisorSlackId(advisor_email)]);
            // Spelled out here rather than summarised as a count: the point of
            // the post is that an objection can be raised from Slack without
            // opening the app, and that needs the actual names.
            const lender_lines = lender_names.length > 0
                ? lender_names.map((n) => `• ${n}`).join("\n")
                : "• (none — the selection was cleared)";
            const text =
                `${mentions ? mentions + " " : ""}Underwriting selected the lenders for this file. ` +
                `*These are cleared to submit — no approval needed.*\n` +
                `${lender_lines}\n` +
                `Reply here if you want one pulled, or open the file to skip it:\n` +
                `${baseUrl}/admin/clients/${clientId}`;
            await slackPostMessage(slack_channel_id, text);
        }
    } catch (err: any) {
        console.error("notifyAdminsOfLenderMatchSaved Slack error (non-fatal):", err);
    }

    return { notified, emailed, admins: admin_users.length };
}
