// src/app/api/cron/lender-follow-up/route.ts
//
// Chases lenders that haven't answered. Nothing did before: submitted_at was
// stored and never read, and in Nov 2026 34 submissions sat unanswered, 31 of
// them for 7+ days.
//
// Each run:
//   1. Polls every unanswered submission whose lender has a status API, exactly
//      like pressing Refresh (some lenders have no webhook, or have callbacks
//      off in prod, so their answer otherwise waits for someone to click).
//   2. Posts a nudge in the deal's Slack channel when a lender reaches 3 days
//      without an answer, then weekly up to 28 days, @-mentioning UW. Older
//      than that it only appears in the digest — a month of silence is
//      effectively a decline, and weekly pings forever would be noise.
//      Stateless: the job runs once a day, so each day count is hit on exactly
//      one run.
//   3. If SLACK_UW_CHANNEL_ID is set, posts one digest of every lender waiting
//      3+ days. Unset = no digest (the per-deal nudges still go out).
//
// ?dry=1 → no polling, no posts; report what would be nudged.
// Auth / dry-run conventions mirror the other crons.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { providerForLender } from "@/lib/lender-api/registry";
import { listSubmissions, refreshSubmissionStatus } from "@/lib/lender-api/submissions";
import { slackPostMessage, getUwUserIds, formatMentions } from "@/lib/slack-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One lender status call per unanswered API submission.
export const maxDuration = 300;

/** Day 3, then 7 / 14 / 21 / 28. */
const isNudgeDay = (days: number) => days === 3 || (days >= 7 && days <= 28 && days % 7 === 0);
const DIGEST_MIN_DAYS = 3;
const DAY = 86_400_000;

function isAuthorized(req: Request): boolean {
    if (process.env.NODE_ENV === "development") return true;
    const expected = process.env.CRON_SECRET;
    if (!expected) {
        console.error("[cron/lender-follow-up] CRON_SECRET is not set in env");
        return false;
    }
    return (req.headers.get("authorization") || "") === `Bearer ${expected}`;
}

interface Waiting {
    id: string;
    client_id: string;
    lender_name: string;
    specialty: string | null;
    submitted_at: string | null;
    assigned_at: string | null;
    created_at: string;
}

async function loadWaiting(db: ReturnType<typeof createAdminClient>) {
    return fetchAllRows<Waiting>(() =>
        db.from("client_lender_assignments")
            .select("id, client_id, lender_name, specialty, submitted_at, assigned_at, created_at")
            .eq("status", "submitted")
            .order("id")
    );
}

export async function GET(req: Request) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const dryRun = new URL(req.url).searchParams.get("dry") === "1";
    const now = Date.now();
    const db = createAdminClient();

    const first = await loadWaiting(db);
    if (first.error) return NextResponse.json({ error: first.error.message }, { status: 500 });

    // 1. Poll lenders that have a status API.
    let polled = 0, pollFailed = 0;
    if (!dryRun) {
        for (const a of first.data) {
            const provider = providerForLender(a.lender_name);
            if (!provider?.fetchStatus) continue;
            try {
                const latest = (await listSubmissions(db, a.id)).find((s) => s.external_id);
                if (!latest) continue;
                const res = await refreshSubmissionStatus(db, provider, latest, "refresh");
                if (res.httpStatus >= 400) pollFailed++;
                else polled++;
            } catch (err) {
                pollFailed++;
                console.error(`[cron/lender-follow-up] poll ${a.lender_name} (${a.id}) failed:`, err instanceof Error ? err.message : "unknown");
            }
        }
    }

    // A poll may have recorded an answer — only chase what is still waiting.
    const still = dryRun ? first : await loadWaiting(db);
    if (still.error) return NextResponse.json({ error: still.error.message }, { status: 500 });

    const waiting = still.data.map((a) => ({
        ...a,
        days: Math.floor((now - new Date(a.submitted_at ?? a.assigned_at ?? a.created_at).getTime()) / DAY),
    }));

    const clientIds = Array.from(new Set(waiting.map((w) => w.client_id)));
    const vaults = clientIds.length
        ? (await db.from("client_data_vault").select("id, company_name, client_name, slack_channel_id").in("id", clientIds)).data ?? []
        : [];
    const vaultById = new Map(vaults.map((v: any) => [v.id, v]));
    const nameOf = (id: string) => {
        const v: any = vaultById.get(id);
        return (v?.company_name || v?.client_name || "a client").trim();
    };
    const label = (w: { lender_name: string; specialty: string | null }) =>
        `${w.lender_name}${w.specialty ? ` (${w.specialty})` : ""}`;
    const uwMentions = formatMentions(getUwUserIds());

    // 2. Per-deal nudges (see isNudgeDay).
    const dueByClient = new Map<string, typeof waiting>();
    for (const w of waiting) {
        if (!isNudgeDay(w.days)) continue;
        const list = dueByClient.get(w.client_id) ?? [];
        list.push(w);
        dueByClient.set(w.client_id, list);
    }
    const nudges: { client: string; lenders: string[]; posted: boolean; reason?: string }[] = [];
    for (const [clientId, list] of dueByClient) {
        const channel = (vaultById.get(clientId) as any)?.slack_channel_id as string | null;
        const lenders = list.map((w) => `${label(w)}: sent ${w.days} days ago`);
        if (!channel) {
            nudges.push({ client: nameOf(clientId), lenders, posted: false, reason: "no deal channel" });
            continue;
        }
        if (dryRun) {
            nudges.push({ client: nameOf(clientId), lenders, posted: false, reason: "dry run" });
            continue;
        }
        const text =
            `⏰ ${uwMentions ? uwMentions + " " : ""}No answer yet from ${list.length === 1 ? "a lender" : `${list.length} lenders`} on *${nameOf(clientId)}*:\n` +
            lenders.map((l) => `• ${l}`).join("\n") +
            `\nChase them, or record their answer on the file.`;
        nudges.push({ client: nameOf(clientId), lenders, posted: await slackPostMessage(channel, text) });
    }

    // 3. Optional team digest.
    const digestChannel = process.env.SLACK_UW_CHANNEL_ID || null;
    const overdue = waiting.filter((w) => w.days >= DIGEST_MIN_DAYS).sort((a, b) => b.days - a.days);
    let digestPosted = false;
    if (digestChannel && overdue.length && !dryRun) {
        const byClient = new Map<string, typeof overdue>();
        for (const w of overdue) byClient.set(w.client_id, [...(byClient.get(w.client_id) ?? []), w]);
        const lines = Array.from(byClient, ([cid, list]) =>
            `*${nameOf(cid)}*: ` + list.map((w) => `${label(w)} ${w.days}d`).join(", ")
        );
        digestPosted = await slackPostMessage(
            digestChannel,
            `📋 ${overdue.length} lender submission${overdue.length === 1 ? "" : "s"} waiting ${DIGEST_MIN_DAYS}+ days for an answer:\n` + lines.join("\n")
        );
    }

    return NextResponse.json({
        ok: true,
        dryRun,
        waiting: waiting.length,
        polled,
        pollFailed,
        overdue: overdue.length,
        nudges,
        digest: digestChannel ? (dryRun ? "skipped (dry run)" : digestPosted) : "SLACK_UW_CHANNEL_ID not set",
    });
}
