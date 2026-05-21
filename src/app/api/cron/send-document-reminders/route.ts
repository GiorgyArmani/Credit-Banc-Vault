import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateOutstandingDocumentsByBusiness } from "@/lib/outstanding-documents";
import { send_outstanding_docs_reminder_email } from "@/lib/email";

// Cadence rules (per user spec):
//   inactivity_days  < 14  → daily              (>= 23h since last reminder)
//   inactivity_days 14-29  → every 3 days       (>= 71h since last reminder)
//   inactivity_days  >= 30 → stop (auto-decline already kicks in elsewhere)
//
// Pipeline statuses that stop reminders: funded, declined.
// Submission statuses that stop reminders: locked.
// Manual pause via client_data_vault.reminders_paused_until.
const FAST_CADENCE_HOURS = 23;
const SLOW_CADENCE_HOURS = 71;
const SLOW_CADENCE_DAYS = 14;
const STOP_DAYS = 30;

const STOP_PIPELINE_STATUSES = new Set(["funded", "declined"]);
const STOP_SUBMISSION_STATUSES = new Set(["locked"]);

interface ReminderResult {
    clientVaultId: string;
    email: string;
    sent: boolean;
    wouldSend?: boolean;
    skipReason?: string;
    error?: string;
    inactivityDays?: number;
    missingDocs?: string[];
}

function isAuthorized(req: Request): boolean {
    // Local dev: skip auth so the route is browser-testable. Vercel always sets
    // NODE_ENV=production for deployed builds, so this only relaxes `npm run dev`.
    if (process.env.NODE_ENV === "development") return true;

    const expected = process.env.CRON_SECRET;
    if (!expected) {
        console.error("[cron/send-document-reminders] CRON_SECRET is not set in env");
        return false;
    }
    const header = req.headers.get("authorization") || "";
    return header === `Bearer ${expected}`;
}

function hoursBetween(a: Date, b: Date): number {
    return Math.abs(a.getTime() - b.getTime()) / 36e5;
}

function daysBetween(a: Date, b: Date): number {
    return Math.floor(Math.abs(a.getTime() - b.getTime()) / 86_400_000);
}

export async function GET(req: Request) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ?dry=1 → run the full filter pipeline but DO NOT send emails or update rows.
    // ?clientId=<uuid> → restrict to one specific client (for targeted tests).
    // ?email=<address> → override the recipient (useful with clientId for dev tests).
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry") === "1";
    const onlyClientId = url.searchParams.get("clientId");
    const overrideEmail = url.searchParams.get("email");

    const startedAt = new Date();
    const supabase = createAdminClient();

    // 1. Pull every active client. Filter in memory rather than via SQL because we
    //    need pipeline status (loan_status_history) + activity timestamps + outstanding
    //    docs, all of which require helper logic.
    let clientsQuery = supabase
        .from("client_data_vault")
        .select(
            "id, user_id, client_email, client_name, company_name, advisor_id, last_reminder_sent_at, reminder_count, reminders_paused_until, created_at"
        )
        .not("client_email", "is", null);

    if (onlyClientId) clientsQuery = clientsQuery.eq("id", onlyClientId);

    const { data: clients, error: clientsError } = await clientsQuery;

    if (clientsError) {
        console.error("[cron/send-document-reminders] failed to load clients:", clientsError);
        return NextResponse.json({ error: clientsError.message }, { status: 500 });
    }

    if (!clients?.length) {
        return NextResponse.json({ ok: true, scanned: 0, sent: 0, skipped: 0 });
    }

    const vaultIds = clients.map(c => c.id);
    const userIds = clients.map(c => c.user_id);

    // 2. Latest pipeline status per client (mirrors getBulkLatestStatus).
    const { data: statusRows } = await supabase
        .from("loan_status_history")
        .select("client_vault_id, status, created_at")
        .in("client_vault_id", vaultIds)
        .order("created_at", { ascending: false });
    const pipelineMap = new Map<string, string>();
    (statusRows || []).forEach(r => {
        if (!pipelineMap.has(r.client_vault_id)) pipelineMap.set(r.client_vault_id, r.status);
    });

    // 3. Submission status per user.
    const { data: subRows } = await supabase
        .from("submissions")
        .select("user_id, status")
        .in("user_id", userIds);
    const submissionMap = new Map<string, string>((subRows || []).map(s => [s.user_id, s.status]));

    // 4. Activity = max(created_at, latest loan_status_history row, latest user_documents.upload_date,
    //    latest client_internal_notes.created_at). Mirrors getBulkClientActivity from advisor.ts.
    const activityMap = new Map<string, Date>();
    clients.forEach(c => activityMap.set(c.id, new Date(c.created_at)));
    (statusRows || []).forEach(r => {
        const d = new Date(r.created_at);
        const cur = activityMap.get(r.client_vault_id);
        if (!cur || d > cur) activityMap.set(r.client_vault_id, d);
    });

    const userToVault = new Map<string, string>(clients.map(c => [c.user_id, c.id]));
    const { data: docRows } = await supabase
        .from("user_documents")
        .select("user_id, upload_date")
        .in("user_id", userIds);
    (docRows || []).forEach(d => {
        const vaultId = userToVault.get(d.user_id);
        if (!vaultId) return;
        const ts = new Date(d.upload_date);
        const cur = activityMap.get(vaultId);
        if (!cur || ts > cur) activityMap.set(vaultId, ts);
    });

    const { data: noteRows } = await supabase
        .from("client_internal_notes")
        .select("client_id, created_at")
        .in("client_id", vaultIds);
    (noteRows || []).forEach(n => {
        const ts = new Date(n.created_at);
        const cur = activityMap.get(n.client_id);
        if (!cur || ts > cur) activityMap.set(n.client_id, ts);
    });

    // 5. Advisors (for the email's "Your Advisor" block).
    const advisorIds = Array.from(new Set(clients.map(c => c.advisor_id).filter(Boolean) as string[]));
    const { data: advisorRows } = advisorIds.length
        ? await supabase
            .from("advisors")
            .select("id, first_name, last_name, email, phone")
            .in("id", advisorIds)
        : { data: [] as any[] };
    const advisorMap = new Map<string, any>((advisorRows || []).map(a => [a.id, a]));

    // 6. Per-client decision loop.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
    const loginUrl = `${appUrl}/auth/login`;
    const results: ReminderResult[] = [];

    for (const client of clients) {
        const result: ReminderResult = {
            clientVaultId: client.id,
            email: client.client_email,
            sent: false,
        };

        try {
            if (!client.client_email) {
                result.skipReason = "no_email";
                results.push(result);
                continue;
            }

            if (client.reminders_paused_until && new Date(client.reminders_paused_until) > startedAt) {
                result.skipReason = "manually_paused";
                results.push(result);
                continue;
            }

            const pipeline = pipelineMap.get(client.id);
            if (pipeline && STOP_PIPELINE_STATUSES.has(pipeline)) {
                result.skipReason = `pipeline_${pipeline}`;
                results.push(result);
                continue;
            }

            const submission = submissionMap.get(client.user_id);
            if (submission && STOP_SUBMISSION_STATUSES.has(submission)) {
                result.skipReason = `submission_${submission}`;
                results.push(result);
                continue;
            }

            const lastActivity = activityMap.get(client.id) || new Date(client.created_at);
            const inactivityDays = daysBetween(startedAt, lastActivity);
            result.inactivityDays = inactivityDays;

            if (inactivityDays >= STOP_DAYS) {
                result.skipReason = `inactive_${inactivityDays}d`;
                results.push(result);
                continue;
            }

            // Cadence enforcement.
            if (client.last_reminder_sent_at) {
                const hoursSince = hoursBetween(startedAt, new Date(client.last_reminder_sent_at));
                const minHours = inactivityDays >= SLOW_CADENCE_DAYS ? SLOW_CADENCE_HOURS : FAST_CADENCE_HOURS;
                if (hoursSince < minHours) {
                    result.skipReason = `too_soon_${Math.round(hoursSince)}h`;
                    results.push(result);
                    continue;
                }
            }

            // Per-business breakdown. The grouped structure drives the
            // per-business sections in the email; the flat list still drives
            // the subject line + "any outstanding docs at all?" gate so the
            // cadence rules stay identical to the pre-multi-business behavior.
            const breakdown = await calculateOutstandingDocumentsByBusiness(client.user_id);
            const missingDocs = breakdown.flat;
            result.missingDocs = missingDocs;
            if (missingDocs.length === 0) {
                result.skipReason = "no_outstanding_docs";
                results.push(result);
                continue;
            }

            // Past every filter — this client would receive an email today.
            if (dryRun) {
                result.wouldSend = true;
                results.push(result);
                continue;
            }

            const advisor = client.advisor_id ? advisorMap.get(client.advisor_id) : null;
            const ownerName = client.client_name?.trim() || "there";

            await send_outstanding_docs_reminder_email({
                client_email: overrideEmail || client.client_email,
                client_name: ownerName,
                business_name: client.company_name,
                missing_docs: missingDocs,
                groups: breakdown.groups.map(g => ({
                    business_name: g.business_name,
                    is_primary: g.is_primary,
                    missing_docs: g.missing_docs,
                })),
                advisor_name: advisor ? `${advisor.first_name ?? ""} ${advisor.last_name ?? ""}`.trim() || null : null,
                advisor_email: advisor?.email ?? null,
                advisor_phone: advisor?.phone ?? null,
                login_url: loginUrl,
                reminder_count: (client.reminder_count ?? 0) + 1,
            });

            // Don't bump cadence counters when we redirected the email elsewhere
            // for testing — otherwise the real client would skip the next real run.
            if (!overrideEmail) {
                await supabase
                    .from("client_data_vault")
                    .update({
                        last_reminder_sent_at: startedAt.toISOString(),
                        reminder_count: (client.reminder_count ?? 0) + 1,
                    })
                    .eq("id", client.id);
            }

            result.sent = true;
            results.push(result);
        } catch (err: any) {
            console.error(`[cron/send-document-reminders] client ${client.id} failed:`, err);
            result.error = err?.message ?? "unknown";
            results.push(result);
        }
    }

    const sent = results.filter(r => r.sent).length;
    const wouldSend = results.filter(r => r.wouldSend).length;
    const skipped = results.filter(r => !r.sent && !r.wouldSend && !r.error).length;
    const errored = results.filter(r => !!r.error).length;

    return NextResponse.json({
        ok: true,
        dryRun,
        ranAt: startedAt.toISOString(),
        scanned: clients.length,
        sent,
        wouldSend,
        skipped,
        errored,
        results,
    });
}
