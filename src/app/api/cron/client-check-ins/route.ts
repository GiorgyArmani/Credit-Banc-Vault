// src/app/api/cron/client-check-ins/route.ts
//
// Phase 4 of docs/new-funding-round-plan.md — the sweep that finally uses the
// three renewal_* columns that have sat on funding_deals, unread, since the
// table was created.
//
// What it does: finds funded rounds that reached their check-in date and tells
// the file's current owner to make contact. Deliberately NOT framed as "this
// client is ready to borrow again" — nothing in the vault knows that. The
// interval is flat (see src/lib/renewals.ts); the point is that a client who
// funded doesn't go silent for a year. Some come back in months, some much
// later, and the only way to know is to call.
//
// On each due round: an in-app notification for the owner, a post in the deal's
// Slack channel so the team sees it too, and one summary email per advisor.
// Then renewal_alert_sent_at is stamped, which under the default one-shot
// cadence retires the round from the sweep forever.
//
// Idempotence comes from three independent guards, so a double-run or a retry
// can't re-nudge:
//   1. renewal_alert_sent_at (via alreadyAlerted)
//   2. the round must still be the NEWEST on its business — if a later round
//      exists the client already came back, so there is nothing to chase
//   3. the round must be funded at all
//
// Mirrors the auth / dry-run conventions of /api/cron/reassign-stale-files.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { send_client_check_in_notification } from "@/lib/email";
import { computeRenewalDates, resolveReminderAt, alreadyAlerted } from "@/lib/renewals";
import { slackPostMessage } from "@/lib/slack-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The funded-round shape this sweep needs. Declared explicitly because the
 * column list below is a concatenated string, which defeats PostgREST's type
 * inference — same reason FUNDING_DEAL_COLUMNS callers cast in funding-deals.ts.
 */
interface FundedDealRow {
    id: string;
    business_profile_id: string;
    display_order: number | null;
    funded_at: string | null;
    funded_amount: number | null;
    funded_term: string | null;
    lender_funded: string | null;
    renewal_eligibility_date: string | null;
    renewal_reminder_at: string | null;
    renewal_alert_sent_at: string | null;
}

interface CheckInResult {
    dealId: string;
    businessProfileId: string;
    clientVaultId?: string;
    clientName?: string;
    dueAt?: string;
    alerted: boolean;
    wouldAlert?: boolean;
    /** Dry run only — which channels would actually reach someone. */
    wouldEmail?: string | null;
    wouldNotifyInApp?: boolean;
    wouldPostSlack?: boolean;
    skipReason?: string;
    error?: string;
}

function isAuthorized(req: Request): boolean {
    // Local dev: skip auth so the route is browser-testable. Vercel always sets
    // NODE_ENV=production for deployed builds, so this only relaxes `npm run dev`.
    if (process.env.NODE_ENV === "development") return true;

    const expected = process.env.CRON_SECRET;
    if (!expected) {
        console.error("[cron/client-check-ins] CRON_SECRET is not set in env");
        return false;
    }
    const header = req.headers.get("authorization") || "";
    return header === `Bearer ${expected}`;
}

function money(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return "not recorded";
    return `$${Math.round(Number(n)).toLocaleString("en-US")}`;
}

function shortDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function monthsSince(iso: string, now: Date): number {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return 0;
    return Math.max(0, Math.round((now.getTime() - then.getTime()) / (30 * 86_400_000)));
}

export async function GET(req: Request) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ?dry=1 → resolve everything but send nothing and stamp nothing.
    // ?clientId=<uuid> → restrict to one file (for targeted tests).
    // ?asOf=<ISO date> → pretend it is that date when deciding what's due.
    //   DRY RUN ONLY, and deliberately so: check-ins fall months out, so
    //   without it the selection logic can't be exercised without editing
    //   funded_at on real rows. Honouring it on a live run would let a bad
    //   query string nudge every client at once.
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry") === "1";
    const onlyClientId = url.searchParams.get("clientId");

    const startedAt = new Date();
    let evaluatedAt = startedAt;
    const asOfParam = url.searchParams.get("asOf");
    if (asOfParam && dryRun) {
        const asOf = new Date(asOfParam);
        if (!Number.isNaN(asOf.getTime())) evaluatedAt = asOf;
    }
    const supabase = createAdminClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";

    // 1. Every funded round. The due test can't run in SQL because rounds that
    //    funded before this shipped have NULL renewal_reminder_at and derive
    //    their date from funded_at — so filter in JS and keep one rule.
    const { data: rawDeals, error: dealsError } = await supabase
        .from("funding_deals")
        .select(
            "id, business_profile_id, display_order, funded_at, funded_amount, funded_term, " +
            "lender_funded, renewal_eligibility_date, renewal_reminder_at, renewal_alert_sent_at"
        )
        .not("funded_at", "is", null);

    if (dealsError) {
        console.error("[cron/client-check-ins] failed to load funded deals:", dealsError);
        return NextResponse.json({ error: dealsError.message }, { status: 500 });
    }

    const fundedDeals = (rawDeals ?? []) as unknown as FundedDealRow[];

    if (!fundedDeals.length) {
        return NextResponse.json({ ok: true, scanned: 0, alerted: 0, skipped: 0 });
    }

    // 2. Narrow to rounds that are actually due before doing any joins.
    const results: CheckInResult[] = [];
    const due: FundedDealRow[] = [];

    for (const deal of fundedDeals) {
        const result: CheckInResult = {
            dealId: deal.id,
            businessProfileId: deal.business_profile_id,
            alerted: false,
        };

        if (alreadyAlerted(deal.renewal_alert_sent_at, evaluatedAt)) {
            result.skipReason = "already_alerted";
            results.push(result);
            continue;
        }

        const reminderAt = resolveReminderAt(deal);
        if (!reminderAt) {
            result.skipReason = "no_schedule";
            results.push(result);
            continue;
        }
        result.dueAt = reminderAt;

        if (new Date(reminderAt) > evaluatedAt) {
            result.skipReason = "not_due";
            results.push(result);
            continue;
        }

        due.push(deal);
    }

    if (!due.length) {
        return NextResponse.json({
            ok: true,
            dryRun,
            ranAt: startedAt.toISOString(),
            evaluatedAt: evaluatedAt.toISOString(),
            scanned: fundedDeals.length,
            alerted: 0,
            skipped: results.length,
            results,
        });
    }

    // 3. A round only needs chasing if it's still the newest on its business —
    //    a later round means the client already came back on their own.
    const businessIds = Array.from(new Set(due.map(d => d.business_profile_id)));
    const { data: siblingDeals } = await supabase
        .from("funding_deals")
        .select("id, business_profile_id, display_order")
        .in("business_profile_id", businessIds);

    const newestByBusiness = new Map<string, { id: string; order: number }>();
    (siblingDeals || []).forEach(d => {
        const order = d.display_order ?? 0;
        const cur = newestByBusiness.get(d.business_profile_id);
        if (!cur || order > cur.order) {
            newestByBusiness.set(d.business_profile_id, { id: d.id, order });
        }
    });

    // 4. Business → client vault → owning advisor.
    const { data: businesses } = await supabase
        .from("business_profiles")
        .select("id, client_vault_id, company_name")
        .in("id", businessIds);
    const businessMap = new Map((businesses || []).map(b => [b.id, b]));

    const vaultIds = Array.from(
        new Set((businesses || []).map(b => b.client_vault_id).filter(Boolean) as string[])
    );
    const { data: vaults } = vaultIds.length
        ? await supabase
              .from("client_data_vault")
              .select("id, client_name, company_name, advisor_id, slack_channel_id")
              .in("id", vaultIds)
        : { data: [] as any[] };
    const vaultMap = new Map((vaults || []).map((v: any) => [v.id, v]));

    const advisorIds = Array.from(
        new Set((vaults || []).map((v: any) => v.advisor_id).filter(Boolean) as string[])
    );
    const { data: advisors } = advisorIds.length
        ? await supabase
              .from("advisors")
              .select("id, first_name, last_name, email, user_id")
              .in("id", advisorIds)
        : { data: [] as any[] };
    const advisorMap = new Map((advisors || []).map((a: any) => [a.id, a]));

    // 5. Decision loop.
    type EmailRow = {
        client_name: string;
        company_name: string;
        funded_amount?: number | null;
        lender_funded?: string | null;
        funded_term?: string | null;
        funded_at: string;
        round_number: number;
        detail_url: string;
    };
    const emailsByAdvisor = new Map<string, EmailRow[]>();
    const alertedDealIds: string[] = [];

    for (const deal of due) {
        const result: CheckInResult = {
            dealId: deal.id,
            businessProfileId: deal.business_profile_id,
            dueAt: resolveReminderAt(deal) ?? undefined,
            alerted: false,
        };

        try {
            const newest = newestByBusiness.get(deal.business_profile_id);
            if (newest && newest.id !== deal.id) {
                result.skipReason = "superseded_by_newer_round";
                results.push(result);
                continue;
            }

            const business = businessMap.get(deal.business_profile_id);
            if (!business?.client_vault_id) {
                result.skipReason = "business_or_vault_missing";
                results.push(result);
                continue;
            }
            result.clientVaultId = business.client_vault_id;

            if (onlyClientId && business.client_vault_id !== onlyClientId) {
                result.skipReason = "filtered_out";
                results.push(result);
                continue;
            }

            const vault: any = vaultMap.get(business.client_vault_id);
            if (!vault) {
                result.skipReason = "vault_missing";
                results.push(result);
                continue;
            }
            result.clientName = vault.client_name ?? undefined;

            // display_order starts at 0 and increments per round, so +1 IS the
            // round number — same derivation the new-round announcement uses.
            const roundNo = (deal.display_order ?? 0) + 1;
            const label = business.company_name || vault.company_name || vault.client_name || "this client";
            const detailUrl = `${appUrl}/admin/clients/${business.client_vault_id}`;
            const advisor: any = vault.advisor_id ? advisorMap.get(vault.advisor_id) : null;

            if (dryRun) {
                // Report which channels would actually land. A file with no
                // advisor, or an advisor with no user_id, alerts nobody — and
                // that is exactly what a dry run should surface rather than
                // counting it as a win.
                result.wouldAlert = true;
                result.wouldEmail = advisor?.email ?? null;
                result.wouldNotifyInApp = !!advisor?.user_id;
                result.wouldPostSlack = !!vault.slack_channel_id;
                results.push(result);
                continue;
            }

            // a. In-app notification for the current owner.
            if (advisor?.user_id) {
                const months = monthsSince(deal.funded_at!, startedAt);
                await supabase.from("in_app_notifications").insert({
                    user_id: advisor.user_id,
                    client_id: business.client_vault_id,
                    title: "Time to check in",
                    message:
                        `${vault.client_name || "A client"}${label ? ` (${label})` : ""} funded ` +
                        `${money(deal.funded_amount)} about ${months} month${months === 1 ? "" : "s"} ago. ` +
                        `Give them a call and see how the business is doing.`,
                });
            }

            // b. Post in the deal channel so the team sees it, not just the owner.
            //    Best-effort: Slack being down must not stop the stamp, or the
            //    round would be re-alerted on every subsequent run.
            if (vault.slack_channel_id) {
                try {
                    const lines = [
                        `👋 *Check-in due* for *${label}* — funded ${money(deal.funded_amount)}` +
                            `${deal.lender_funded ? ` by ${deal.lender_funded}` : ""}` +
                            `${deal.funded_term ? ` · ${deal.funded_term}` : ""} on ${shortDate(deal.funded_at)} (Round ${roundNo}).`,
                        `• Worth a call to see how the business is doing and whether they need anything.`,
                        `• Not a signal that they're looking for money — just time we heard from them.`,
                        detailUrl,
                    ];
                    await slackPostMessage(vault.slack_channel_id, lines.join("\n"));
                } catch (slackErr) {
                    console.error(`[cron/client-check-ins] Slack post for deal ${deal.id} failed:`, slackErr);
                }
            }

            // c. Stage the advisor's summary email.
            if (advisor?.email) {
                const rows = emailsByAdvisor.get(advisor.id) ?? [];
                rows.push({
                    client_name: vault.client_name || "Unnamed client",
                    company_name: business.company_name || vault.company_name || "",
                    funded_amount: deal.funded_amount,
                    lender_funded: deal.lender_funded,
                    funded_term: deal.funded_term,
                    funded_at: deal.funded_at!,
                    round_number: roundNo,
                    detail_url: detailUrl,
                });
                emailsByAdvisor.set(advisor.id, rows);
            }

            alertedDealIds.push(deal.id);
            result.alerted = true;
            results.push(result);
        } catch (err: any) {
            console.error(`[cron/client-check-ins] deal ${deal.id} failed:`, err);
            result.error = err?.message ?? "unknown";
            results.push(result);
        }
    }

    // 6. One summary email per advisor.
    let emailsSent = 0;
    if (!dryRun) {
        for (const [advisorId, clients] of emailsByAdvisor.entries()) {
            const advisor: any = advisorMap.get(advisorId);
            if (!advisor?.email || !clients.length) continue;
            try {
                await send_client_check_in_notification({
                    advisor_name: `${advisor.first_name ?? ""} ${advisor.last_name ?? ""}`.trim(),
                    advisor_email: advisor.email,
                    clients,
                    login_url: `${appUrl}/admin/pipeline`,
                });
                emailsSent++;
            } catch (err: any) {
                console.error(`[cron/client-check-ins] email to advisor ${advisorId} failed:`, err);
            }
        }
    }

    // 7. Stamp last, in one write. Doing it after the notifications means a
    //    crash mid-run re-nudges rather than silently dropping a client — the
    //    safer direction for a relationship prompt.
    if (!dryRun && alertedDealIds.length > 0) {
        const stamped = startedAt.toISOString();
        for (const dealId of alertedDealIds) {
            const deal = due.find(d => d.id === dealId)!;
            // Backfill the schedule for rounds that funded before these columns
            // were ever written, so the row explains its own timing afterwards.
            const derived = computeRenewalDates(deal.funded_at);
            const { error: stampErr } = await supabase
                .from("funding_deals")
                .update({
                    renewal_alert_sent_at: stamped,
                    renewal_eligibility_date: deal.renewal_eligibility_date ?? derived?.eligibilityDate ?? null,
                    renewal_reminder_at: deal.renewal_reminder_at ?? derived?.reminderAt ?? null,
                })
                .eq("id", dealId);
            if (stampErr) {
                console.error(`[cron/client-check-ins] failed to stamp deal ${dealId}:`, stampErr);
            }
        }
    }

    const alerted = results.filter(r => r.alerted).length;
    const wouldAlert = results.filter(r => r.wouldAlert).length;
    const skipped = results.filter(r => !r.alerted && !r.wouldAlert && !r.error).length;
    const errored = results.filter(r => !!r.error).length;

    return NextResponse.json({
        ok: true,
        dryRun,
        ranAt: startedAt.toISOString(),
        evaluatedAt: evaluatedAt.toISOString(),
        scanned: fundedDeals.length,
        alerted,
        wouldAlert,
        skipped,
        errored,
        emailsSent,
        results,
    });
}
