"use server";

import { createClient } from "@supabase/supabase-js";

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
 * Returns { notified } so the caller can surface a count in the toast.
 * Best-effort: failures are logged, never throw — UW's save succeeded
 * regardless of whether notifications fan out.
 */
export async function notifyAdminsOfLenderMatchSaved(
    clientId: string,
    recommended: RecommendedLender[]
) {
    if (!clientId) return { notified: 0 };
    try {
        // Pull all admin users + the client name for the message body.
        const [{ data: admin_users }, { data: client_row }] = await Promise.all([
            supabase_admin.from("users").select("id, email").eq("role", "admin"),
            supabase_admin.from("client_data_vault").select("client_name, company_name").eq("id", clientId).maybeSingle(),
        ]);

        if (!admin_users || admin_users.length === 0) {
            console.warn("notifyAdminsOfLenderMatchSaved: no admin users found");
            return { notified: 0 };
        }

        const client_name = client_row?.client_name || client_row?.company_name || "a client";
        const lender_summary = recommended.length === 0
            ? "no lenders recommended"
            : recommended.length === 1
                ? `${recommended[0].lender_name}${recommended[0].specialty ? ` (${recommended[0].specialty})` : ""}`
                : `${recommended.length} lenders`;

        const title = `Lender match ready for review — ${client_name}`;
        const message = `Underwriting recommended ${lender_summary} for ${client_name}. Review and approve which lenders to contact.`;

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
            console.error("notifyAdminsOfLenderMatchSaved insert error:", insert_err);
            return { notified: 0 };
        }

        return { notified: admin_users.length };
    } catch (err: any) {
        console.error("notifyAdminsOfLenderMatchSaved exception:", err);
        return { notified: 0 };
    }
}
