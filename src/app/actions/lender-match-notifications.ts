"use server";

import { createClient } from "@supabase/supabase-js";
import { send_lender_match_ready_notification } from "@/lib/email";

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
 * Notifies all admins (in-app + email) when UW saves their lender-match
 * recommendations for a client. Admins then review/curate which lenders
 * UW should actually contact via the Lender Match — Admin Review card on
 * the unified client view.
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

    try {
        // Pull all admin users + the client name for the message body.
        const [{ data: admins }, { data: client_row }] = await Promise.all([
            supabase_admin.from("users").select("id, email").eq("role", "admin"),
            supabase_admin.from("client_data_vault").select("client_name, company_name").eq("id", clientId).maybeSingle(),
        ]);

        admin_users = (admins ?? []) as { id: string; email: string }[];
        client_name = client_row?.client_name || client_row?.company_name || "a client";
        company_name = client_row?.company_name ?? undefined;

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

    const title = `Lender match ready for review — ${client_name}`;
    const message = `Underwriting recommended ${lender_summary} for ${client_name}. Review and approve which lenders to contact.`;

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

    return { notified, emailed, admins: admin_users.length };
}
