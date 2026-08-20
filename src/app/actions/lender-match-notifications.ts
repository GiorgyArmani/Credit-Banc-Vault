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
 * What the match was actually run on, plus the numbers it was run with.
 *
 * A match no longer implies statements were read — lender matching works off
 * the profile captured at vault creation when no bank analysis exists. "Matched
 * on the client profile" and "matched on a bank analysis" are different claims,
 * and a reader who can't tell them apart will assume the stronger one. So the
 * basis and the criteria travel with the post.
 */
interface MatchBasis {
    basis: "analysis" | "profile" | "manual";
    analysis_date?: string | null;
    fico?: number;
    tib_months?: number;
    avg_revenue?: number;
    num_open_positions?: number;
    capital_requested?: number;
}

const BASIS_LABEL: Record<MatchBasis["basis"], string> = {
    analysis: "bank analysis",
    profile: "client profile (no bank analysis)",
    manual: "manually adjusted criteria",
};

const fmt_money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** One-line criteria digest for the Slack post. Only fields we actually have a
 *  value for are printed — a padded line of zeros reads as real data. */
function format_basis_line(ctx: MatchBasis | undefined): string {
    if (!ctx) return "";
    const parts: string[] = [];
    if (ctx.fico) parts.push(`FICO ${ctx.fico}`);
    if (ctx.tib_months) parts.push(`TIB ${ctx.tib_months}mo`);
    if (ctx.avg_revenue) parts.push(`Rev ${fmt_money(ctx.avg_revenue)}/mo`);
    if (ctx.num_open_positions) parts.push(`${ctx.num_open_positions} position${ctx.num_open_positions === 1 ? "" : "s"}`);
    if (ctx.capital_requested) parts.push(`Ask ${fmt_money(ctx.capital_requested)}`);

    const dated =
        ctx.basis === "analysis" && ctx.analysis_date
            ? `bank analysis (${new Date(ctx.analysis_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})`
            : BASIS_LABEL[ctx.basis];

    return `_Matched on ${dated}${parts.length ? ` — ${parts.join(" · ")}` : ""}_`;
}

/**
 * Notifies all admins (in-app + email + Slack) when UW saves their lender
 * selection for a client.
 *
 * A RECORD OF THE RESULT. Nobody is being asked for anything — commonly the
 * admin named the lender in the first place and UW is selecting and contacting
 * it. So every message here states what the match came out as and stops. Copy
 * that reassures the reader no approval is needed is still copy about approval,
 * and it kept an approval step alive in people's heads long after the code
 * dropped it.
 *
 * Returns { notified, emailed, admins } so the caller can surface a count and
 * so a missed recipient is observable in logs (an earlier incident silently
 * notified only one of two admins). In-app and email are independent: one
 * failing never blocks the other, and neither throws — UW's save succeeded
 * regardless of whether notifications fan out.
 */
export async function notifyAdminsOfLenderMatchSaved(
    clientId: string,
    recommended: RecommendedLender[],
    match_basis?: MatchBasis
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

    // How the client is named everywhere below. The business is what a reader
    // recognises on a lender file; the person is the disambiguator when two
    // companies read alike, so both go in when we have both.
    const client_label =
        company_name && company_name !== client_name
            ? `${company_name} (${client_name})`
            : client_name;

    // Same register as the Slack post: state the result. Copy that insists no
    // approval is needed keeps the idea of an approval in the reader's head.
    const title = `Lender match result — ${client_label}`;
    const message = `Lender match for ${client_label}: ${lender_summary}.`;

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
    //    advisor see the result. This is the surface the team actually reads,
    //    which is why the lender names are inline rather than behind a link. ──
    try {
        if (slack_channel_id) {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
            const mentions = formatMentions([...getApproverUserIds(), resolveAdvisorSlackId(advisor_email)]);
            // Spelled out rather than summarised as a count: the whole value of
            // the post is knowing WHICH lenders without opening the app.
            const lender_lines = lender_names.length > 0
                ? lender_names.map((n) => `• ${n}`).join("\n")
                : "• (none — the selection was cleared)";
            const basis_line = format_basis_line(match_basis);
            // Three things and no more: what this is, who it is for, and what
            // came out. The client is named even though the post lands in that
            // client's own channel — people read these in the sidebar, out of
            // context, and a list of lenders with no name attached is a puzzle.
            //
            // The closing line asks for the one thing that IS wanted back:
            // other lenders to try. It used to say "reply if you want one
            // pulled, or open the file to skip it", which invited a veto
            // nobody is being asked for.
            const text =
                `${mentions ? mentions + " " : ""}*This is the lender match result for ${client_label}.*\n` +
                `${basis_line ? basis_line + "\n" : ""}` +
                `${lender_lines}\n` +
                `Reply here if you want us to contact other lenders.\n` +
                `${baseUrl}/admin/clients/${clientId}`;
            await slackPostMessage(slack_channel_id, text);
        }
    } catch (err: any) {
        console.error("notifyAdminsOfLenderMatchSaved Slack error (non-fatal):", err);
    }

    return { notified, emailed, admins: admin_users.length };
}
