// src/app/api/cron/reassign-stale-files/route.ts
//
// Catch-all reassignment: any active file that has gone untouched for 7+ days
// is automatically reassigned to a designated catch-all advisor (Grant) so
// stalled deals don't sit unworked. On reassignment we:
//   1. flip client_data_vault.advisor_id / advisor_name to the catch-all owner,
//   2. demote the previous advisor to a follower so they keep access alongside
//      the catch-all owner (both can see the file),
//   3. drop an in-app notification per file for the new owner, and
//   4. email the new owner a single summary of everything handed to them.
//
// "Inactivity" mirrors getBulkClientActivity / send-document-reminders:
//   max(created_at, latest loan_status_history, latest user_documents.upload_date,
//       latest client_internal_notes.created_at).
//
// Files already owned by the catch-all advisor, and files that are funded or
// declined (closed), are skipped — so the job is naturally idempotent: once a
// file is handed over it stays put and never re-triggers.
//
// Mirrors the auth/dry-run conventions of /api/cron/send-document-reminders.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { send_file_reassignment_notification } from "@/lib/email";
import { resolveCatchAllAdvisor } from "@/lib/catch-all-advisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How long a file may sit with no activity before it's reassigned.
const REASSIGN_AFTER_DAYS = 7;

// Pipeline statuses that never trigger reassignment: closed deals (funded,
// declined) plus deals with an offer on the table (lender_matched / "Offer
// Received") — those are actively progressing and shouldn't be pulled away.
const NO_REASSIGN_STATUSES = new Set(["funded", "declined", "lender_matched"]);

interface ReassignResult {
    clientVaultId: string;
    clientName: string;
    previousAdvisorId: string | null;
    inactivityDays: number;
    reassigned: boolean;
    wouldReassign?: boolean;
    skipReason?: string;
    error?: string;
}

function isAuthorized(req: Request): boolean {
    // Local dev: skip auth so the route is browser-testable. Vercel always sets
    // NODE_ENV=production for deployed builds, so this only relaxes `npm run dev`.
    if (process.env.NODE_ENV === "development") return true;

    const expected = process.env.CRON_SECRET;
    if (!expected) {
        console.error("[cron/reassign-stale-files] CRON_SECRET is not set in env");
        return false;
    }
    const header = req.headers.get("authorization") || "";
    return header === `Bearer ${expected}`;
}

function daysBetween(a: Date, b: Date): number {
    return Math.floor(Math.abs(a.getTime() - b.getTime()) / 86_400_000);
}

export async function GET(req: Request) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ?dry=1 → run the full filter pipeline but DO NOT reassign, notify, or email.
    // ?clientId=<uuid> → restrict to one specific file (for targeted tests).
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry") === "1";
    const onlyClientId = url.searchParams.get("clientId");

    const startedAt = new Date();
    const supabase = createAdminClient();

    // 0. Resolve the catch-all advisor.
    const grant = await resolveCatchAllAdvisor(supabase);
    if (!grant) {
        console.error("[cron/reassign-stale-files] catch-all advisor not found");
        return NextResponse.json({ error: "catch_all_advisor_not_found" }, { status: 500 });
    }
    const grantName = grant.name;

    // 1. Pull active files (skip closed at the SQL level via status, but the
    //    authoritative pipeline state comes from loan_status_history below).
    // Exclude files already owned by the catch-all advisor. `.neq` alone would
    // also drop unassigned files (SQL `<>` is null-unsafe), but those SHOULD be
    // swept up — so explicitly OR in the null case.
    let clientsQuery = supabase
        .from("client_data_vault")
        .select("id, user_id, advisor_id, advisor_name, client_name, company_name, capital_requested, created_at, reassignment_paused_until")
        .or(`advisor_id.is.null,advisor_id.neq.${grant.id}`);

    if (onlyClientId) clientsQuery = clientsQuery.eq("id", onlyClientId);

    const { data: clients, error: clientsError } = await clientsQuery;

    if (clientsError) {
        console.error("[cron/reassign-stale-files] failed to load clients:", clientsError);
        return NextResponse.json({ error: clientsError.message }, { status: 500 });
    }

    if (!clients?.length) {
        return NextResponse.json({ ok: true, scanned: 0, reassigned: 0, skipped: 0 });
    }

    const vaultIds = clients.map(c => c.id);
    const userIds = clients.map(c => c.user_id);

    // 2. Latest pipeline status per file (mirrors getBulkLatestStatus).
    const { data: statusRows } = await supabase
        .from("loan_status_history")
        .select("client_vault_id, status, created_at")
        .in("client_vault_id", vaultIds)
        .order("created_at", { ascending: false });
    const pipelineMap = new Map<string, string>();
    (statusRows || []).forEach(r => {
        if (!pipelineMap.has(r.client_vault_id)) pipelineMap.set(r.client_vault_id, r.status);
    });

    // 3. Activity = max(created_at, latest loan_status_history, latest
    //    user_documents.upload_date, latest client_internal_notes.created_at).
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

    // 4. Advisor names for the email's "previously assigned to" column.
    const advisorIds = Array.from(new Set(clients.map(c => c.advisor_id).filter(Boolean) as string[]));
    const { data: advisorRows } = advisorIds.length
        ? await supabase.from("advisors").select("id, first_name, last_name").in("id", advisorIds)
        : { data: [] as any[] };
    const advisorNameMap = new Map<string, string>(
        (advisorRows || []).map(a => [a.id, `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim()])
    );

    // 5. Decision loop.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
    const results: ReassignResult[] = [];
    const emailFiles: Array<{
        client_name: string;
        company_name: string;
        capital_requested?: number | null;
        previous_advisor_name?: string | null;
        inactivity_days: number;
        detail_url: string;
    }> = [];

    for (const client of clients) {
        const result: ReassignResult = {
            clientVaultId: client.id,
            clientName: client.client_name,
            previousAdvisorId: client.advisor_id,
            inactivityDays: 0,
            reassigned: false,
        };

        try {
            // Advisor-set pause: a client asked for more time, etc. Skip until it expires.
            if (client.reassignment_paused_until && new Date(client.reassignment_paused_until) > startedAt) {
                result.skipReason = "paused";
                results.push(result);
                continue;
            }

            const pipeline = pipelineMap.get(client.id);
            if (pipeline && NO_REASSIGN_STATUSES.has(pipeline)) {
                result.skipReason = `pipeline_${pipeline}`;
                results.push(result);
                continue;
            }

            const lastActivity = activityMap.get(client.id) || new Date(client.created_at);
            const inactivityDays = daysBetween(startedAt, lastActivity);
            result.inactivityDays = inactivityDays;

            if (inactivityDays < REASSIGN_AFTER_DAYS) {
                result.skipReason = `active_${inactivityDays}d`;
                results.push(result);
                continue;
            }

            if (dryRun) {
                result.wouldReassign = true;
                results.push(result);
                continue;
            }

            // a. Reassign ownership.
            const { error: updateError } = await supabase
                .from("client_data_vault")
                .update({
                    advisor_id: grant.id,
                    advisor_name: grantName,
                    reassigned_to_catch_all_at: startedAt.toISOString(),
                    updated_at: startedAt.toISOString(),
                })
                .eq("id", client.id);

            if (updateError) {
                result.error = updateError.message;
                results.push(result);
                continue;
            }

            // a2. Demote the previous advisor to a follower so they keep access
            //     alongside the catch-all owner (Grant). Unassigned files have no
            //     previous advisor to preserve, and we never add Grant to himself.
            //     A dup (already a follower, 23505) is fine — just ignore it.
            if (client.advisor_id && client.advisor_id !== grant.id) {
                const { error: followerError } = await supabase
                    .from("client_followers")
                    .insert({
                        client_vault_id: client.id,
                        advisor_id: client.advisor_id,
                        assigned_by: grant.id,
                    });
                if (followerError && (followerError as any).code !== "23505") {
                    console.error(
                        `[cron/reassign-stale-files] follower insert for client ${client.id} failed:`,
                        followerError,
                    );
                }
            }

            // b. In-app notification for the new owner.
            if (grant.user_id) {
                await supabase.from("in_app_notifications").insert({
                    user_id: grant.user_id,
                    client_id: client.id,
                    title: "File reassigned to you",
                    message: `${client.client_name || "A client"}${client.company_name ? ` (${client.company_name})` : ""} was inactive for ${inactivityDays} days and has been reassigned to you.`,
                });
            }

            // c. Stage for the summary email.
            emailFiles.push({
                client_name: client.client_name,
                company_name: client.company_name,
                capital_requested: client.capital_requested,
                previous_advisor_name: client.advisor_id ? advisorNameMap.get(client.advisor_id) || null : null,
                inactivity_days: inactivityDays,
                detail_url: `${appUrl}/admin/clients/${client.id}`,
            });

            result.reassigned = true;
            results.push(result);
        } catch (err: any) {
            console.error(`[cron/reassign-stale-files] client ${client.id} failed:`, err);
            result.error = err?.message ?? "unknown";
            results.push(result);
        }
    }

    // 6. Single summary email to the new owner.
    let emailSent = false;
    if (!dryRun && emailFiles.length > 0 && grant.email) {
        try {
            await send_file_reassignment_notification({
                advisor_name: grantName,
                advisor_email: grant.email,
                files: emailFiles,
                login_url: `${appUrl}/admin/pipeline`,
            });
            emailSent = true;
        } catch (err: any) {
            console.error("[cron/reassign-stale-files] summary email failed:", err);
        }
    }

    const reassigned = results.filter(r => r.reassigned).length;
    const wouldReassign = results.filter(r => r.wouldReassign).length;
    const skipped = results.filter(r => !r.reassigned && !r.wouldReassign && !r.error).length;
    const errored = results.filter(r => !!r.error).length;

    return NextResponse.json({
        ok: true,
        dryRun,
        ranAt: startedAt.toISOString(),
        catchAllAdvisor: { id: grant.id, email: grant.email, name: grantName },
        scanned: clients.length,
        reassigned,
        wouldReassign,
        skipped,
        errored,
        emailSent,
        results,
    });
}
