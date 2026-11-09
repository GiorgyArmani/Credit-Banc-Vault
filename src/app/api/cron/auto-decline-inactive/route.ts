// src/app/api/cron/auto-decline-inactive/route.ts
//
// Declines PROSPECTS that have gone 30+ days with no activity.
//
// This used to run in the browser, as a side effect of an advisor opening the
// prospects page (workspace-prospects.tsx). Two things were wrong with that:
//   1. It only spared `funded` and `under_review`, so files UNDERWRITING was
//      working (lender_matched, documents_requested after submit, consulting)
//      were declined — 42 UW files by Nov 2026, live deals among them.
//   2. Its activity read was capped at 1000 rows, so recent uploads were
//      invisible and active files looked idle.
//
// Rule now: only files still in the pre-underwriting stages below, never a file
// submitted to UW (submissions.status = 'locked'), never one an advisor paused.
//
// ?dry=1 → report what would be declined, change nothing.
// ?clientId=<uuid> → one file only.
// Auth / dry-run conventions mirror the other crons.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { recordPipelineTransition } from "@/lib/pipeline-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECLINE_AFTER_DAYS = 30;

/** Only these stages can be auto-declined: the client is still gathering docs. */
const PROSPECT_STAGES = new Set(["created", "onboarding", "documents_requested", "documents_received"]);

function isAuthorized(req: Request): boolean {
    if (process.env.NODE_ENV === "development") return true;
    const expected = process.env.CRON_SECRET;
    if (!expected) {
        console.error("[cron/auto-decline-inactive] CRON_SECRET is not set in env");
        return false;
    }
    return (req.headers.get("authorization") || "") === `Bearer ${expected}`;
}

export async function GET(req: Request) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry") === "1";
    const onlyClientId = url.searchParams.get("clientId");
    const now = new Date();
    const db = createAdminClient();

    let vaultQuery = db
        .from("client_data_vault")
        .select("id, user_id, client_name, company_name, created_at, reassignment_paused_until");
    if (onlyClientId) vaultQuery = vaultQuery.eq("id", onlyClientId);
    const { data: vaults, error: vaultError } = await vaultQuery;
    if (vaultError) return NextResponse.json({ error: vaultError.message }, { status: 500 });
    if (!vaults?.length) return NextResponse.json({ ok: true, dryRun, scanned: 0, declined: 0 });

    const vaultIds = vaults.map(v => v.id);
    const userIds = vaults.map(v => v.user_id);

    const [history, subs, docs, notes, comms] = await Promise.all([
        fetchAllRows<{ client_vault_id: string; status: string; created_at: string }>(() =>
            db.from("loan_status_history").select("client_vault_id, status, created_at")
                .in("client_vault_id", vaultIds).order("created_at", { ascending: false }).order("id", { ascending: false })
        ),
        fetchAllRows<{ user_id: string; status: string }>(() =>
            db.from("submissions").select("user_id, status").in("user_id", userIds).order("user_id")
        ),
        fetchAllRows<{ user_id: string; upload_date: string }>(() =>
            db.from("user_documents").select("user_id, upload_date").in("user_id", userIds).order("id")
        ),
        fetchAllRows<{ client_id: string; created_at: string }>(() =>
            db.from("client_internal_notes").select("client_id, created_at").in("client_id", vaultIds).order("id")
        ),
        // Same activity sources as getBulkClientActivity: a rep reaching the
        // client counts, automated sends don't.
        fetchAllRows<{ client_id: string; occurred_at: string }>(() =>
            db.from("communications").select("client_id, occurred_at")
                .in("client_id", vaultIds).eq("is_automated", false).order("id")
        ),
    ]);
    // Fail closed: a decline is visible to the client's advisor and hard to
    // spot as wrong, so never act on a partial read.
    const readError = [history, subs, docs].find(r => r.error)?.error;
    if (readError) {
        console.error("[cron/auto-decline-inactive] read failed — aborting run:", readError);
        return NextResponse.json({ error: readError.message }, { status: 500 });
    }

    const latestStatus = new Map<string, string>();
    const activity = new Map<string, number>(vaults.map(v => [v.id, new Date(v.created_at).getTime()]));
    const bump = (vaultId: string | undefined, iso: string) => {
        if (!vaultId || !activity.has(vaultId)) return;
        const t = new Date(iso).getTime();
        if (t > activity.get(vaultId)!) activity.set(vaultId, t);
    };
    for (const h of history.data) {
        if (!latestStatus.has(h.client_vault_id)) latestStatus.set(h.client_vault_id, h.status);
        bump(h.client_vault_id, h.created_at);
    }
    const vaultByUser = new Map(vaults.map(v => [v.user_id, v.id]));
    for (const d of docs.data) bump(vaultByUser.get(d.user_id), d.upload_date);
    for (const n of notes.data) bump(n.client_id, n.created_at);
    for (const c of comms.data) bump(c.client_id, c.occurred_at);
    const subStatus = new Map(subs.data.map(s => [s.user_id, s.status]));

    const results: { clientVaultId: string; clientName: string; stage: string; inactivityDays: number; declined?: boolean; wouldDecline?: boolean; error?: string }[] = [];

    for (const v of vaults) {
        const stage = latestStatus.get(v.id) ?? "created";
        if (!PROSPECT_STAGES.has(stage)) continue;
        if (subStatus.get(v.user_id) === "locked") continue; // with underwriting
        if (v.reassignment_paused_until && new Date(v.reassignment_paused_until) > now) continue;

        const inactivityDays = Math.floor((now.getTime() - activity.get(v.id)!) / 86_400_000);
        if (inactivityDays < DECLINE_AFTER_DAYS) continue;

        const row = { clientVaultId: v.id, clientName: `${v.client_name ?? ""} (${v.company_name ?? ""})`, stage, inactivityDays };
        if (dryRun) {
            results.push({ ...row, wouldDecline: true });
            continue;
        }
        const res = await recordPipelineTransition({
            clientVaultId: v.id,
            newStatus: "declined",
            note: `System: Auto-declined due to ${inactivityDays} days of inactivity.`,
            actorUserId: null,
            actorRole: "system",
        });
        results.push(res.success ? { ...row, declined: true } : { ...row, error: res.error });
    }

    return NextResponse.json({
        ok: true,
        dryRun,
        ranAt: now.toISOString(),
        scanned: vaults.length,
        declined: results.filter(r => r.declined).length,
        wouldDecline: results.filter(r => r.wouldDecline).length,
        errored: results.filter(r => r.error).length,
        results,
    });
}
