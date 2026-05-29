// src/app/api/cron/resend-magic-link/route.ts
//
// Re-engagement: a client was created and sent a passwordless magic link, but
// they never signed the service agreement (contract_completed = false). Once a
// client has been sitting unsigned for >24h, this cron sends ONE fresh magic
// link — both to the GHL custom field (re-firing the `send-magic-link` SMS
// workflow) and by email — then stamps magic_link_resent_at so we never nag the
// same client twice.
//
// Mirrors the auth/dry-run conventions of /api/cron/send-document-reminders.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateOnboardingMagicLink, pushMagicLinkToGhl } from "@/lib/magic-link";
import { ghlSearchContacts } from "@/lib/ghl-api";
import { send_client_welcome_email } from "@/lib/email";
import { getFollowerEmailsForClient } from "@/lib/followers";
import { normalizeSupabaseJoin } from "@/lib/document-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How long a client may sit with an unsigned contract before we re-send.
const RESEND_AFTER_HOURS = 24;

interface ResendResult {
    clientVaultId: string;
    email: string;
    sent: boolean;
    wouldSend?: boolean;
    skipReason?: string;
    error?: string;
}

function isAuthorized(req: Request): boolean {
    // Local dev: skip auth so the route is browser-testable. Vercel always sets
    // NODE_ENV=production for deployed builds, so this only relaxes `npm run dev`.
    if (process.env.NODE_ENV === "development") return true;

    const expected = process.env.CRON_SECRET;
    if (!expected) {
        console.error("[cron/resend-magic-link] CRON_SECRET is not set in env");
        return false;
    }
    const header = req.headers.get("authorization") || "";
    return header === `Bearer ${expected}`;
}

export async function GET(req: Request) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ?dry=1 → select + report but DO NOT send or stamp anything.
    // ?clientId=<uuid> → restrict to one client (targeted tests).
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry") === "1";
    const onlyClientId = url.searchParams.get("clientId");

    const startedAt = new Date();
    const cutoff = new Date(startedAt.getTime() - RESEND_AFTER_HOURS * 36e5).toISOString();
    const supabase = createAdminClient();

    // Candidates: unsigned contract, created before the cutoff, not yet re-sent.
    let query = supabase
        .from("client_data_vault")
        .select("id, user_id, client_email, client_name, company_name, advisor_id, ghl_contact_id, created_at")
        .eq("contract_completed", false)
        .is("magic_link_resent_at", null)
        .lt("created_at", cutoff)
        .not("client_email", "is", null);

    if (onlyClientId) query = query.eq("id", onlyClientId);

    const { data: clients, error } = await query;

    if (error) {
        console.error("[cron/resend-magic-link] failed to load clients:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!clients?.length) {
        return NextResponse.json({ ok: true, scanned: 0, sent: 0, skipped: 0 });
    }

    // Advisor info for the email's "Your Advisor" block + CC.
    const advisorIds = Array.from(new Set(clients.map(c => c.advisor_id).filter(Boolean) as string[]));
    const { data: advisorRows } = advisorIds.length
        ? await supabase.from("advisors").select("id, first_name, last_name, email, phone").in("id", advisorIds)
        : { data: [] as any[] };
    const advisorMap = new Map<string, any>((advisorRows || []).map(a => [a.id, a]));

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
    const results: ResendResult[] = [];

    for (const client of clients) {
        const result: ResendResult = { clientVaultId: client.id, email: client.client_email, sent: false };

        try {
            if (dryRun) {
                result.wouldSend = true;
                results.push(result);
                continue;
            }

            // 1. Fresh magic link.
            const link = await generateOnboardingMagicLink(client.client_email);
            if (!link) {
                result.skipReason = "link_generation_failed";
                results.push(result);
                continue;
            }

            // 2. Push to GHL (custom field + send-magic-link tag → SMS). Prefer the
            //    stored contact id; fall back to a search by email.
            let contactId = client.ghl_contact_id as string | null;
            if (!contactId && process.env.GHL_LOCATION_ID) {
                const found = await ghlSearchContacts({
                    email: client.client_email.toLowerCase(),
                    locationId: process.env.GHL_LOCATION_ID,
                });
                contactId = found[0]?.id ?? null;
            }
            if (contactId) {
                await pushMagicLinkToGhl(contactId, link);
            } else {
                console.warn(`[cron/resend-magic-link] no GHL contact for ${client.client_email}`);
            }

            // 3. Requested documents (for the email body), mirroring resend-credentials.
            const { data: dynamic_requirements } = await supabase
                .from("client_dynamic_documents")
                .select("required_documents!inner(label)")
                .eq("user_id", client.user_id)
                .eq("is_active", true);
            const requested_documents = (dynamic_requirements || [])
                .map((item: any) => normalizeSupabaseJoin<{ label?: string }>(item.required_documents)?.label)
                .filter((l: string | undefined): l is string => !!l);

            // 4. Email the fresh link (advisor + followers CC, matching the welcome email).
            const advisor = client.advisor_id ? advisorMap.get(client.advisor_id) : null;
            const advisor_full_name = advisor ? `${advisor.first_name ?? ""} ${advisor.last_name ?? ""}`.trim() : "";
            const follower_emails = await getFollowerEmailsForClient(supabase, client.id);

            await send_client_welcome_email({
                client_name: client.client_name || "there",
                client_email: client.client_email,
                magic_link: link,
                advisor_name: advisor_full_name || "Your Advisor",
                advisor_email: advisor?.email || "support@creditbanc.io",
                advisor_phone: advisor?.phone || undefined,
                advisor_cc_email: advisor?.email || undefined,
                advisor_cc_emails: follower_emails,
                requested_documents,
                login_url: `${appUrl}/auth/login`,
            });

            // 5. Stamp so this client is nudged exactly once.
            await supabase
                .from("client_data_vault")
                .update({ magic_link_resent_at: startedAt.toISOString() })
                .eq("id", client.id);

            result.sent = true;
            results.push(result);
        } catch (err: any) {
            console.error(`[cron/resend-magic-link] client ${client.id} failed:`, err);
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
