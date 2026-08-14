// src/app/api/cron/refresh-affiliate-links/route.ts
//
// Keeps the two affiliate link custom fields in GHL alive:
//   [Data Vault] Affiliate Dashboard Link → a FRESH magic link (one-click login)
//   [Data Vault] Personal Affiliate Link  → /r/<referral_code>
//
// Why a cron instead of a long-lived token: the dashboard link is a working
// credential. Stamping it once at signup with a year-long TTL would put a
// year-long one-click login into a CRM field and an inbox. Instead every link
// keeps the standard 30-day MAGIC_LINK_TTL_DAYS and this job re-stamps weekly —
// so a link stays valid roughly 4 missed runs deep, and any copy that leaked out
// of an old email dies on schedule. GHL merges the field at SEND time, so a
// re-activation campaign firing months from now picks up whatever is current.
//
// It doubles as the backfill for affiliates who signed up before the fields
// existed, including finding and storing a missing ghl_contact_id.
//
// Deliberately does NOT touch tags — `new affiliate` is a signup-only signal and
// re-adding it here would re-trigger the onboarding workflow every week.
//
// Mirrors the auth/dry-run conventions of /api/cron/resend-magic-link.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateAffiliateDashboardMagicLink } from "@/lib/magic-link";
import { ghlUpdateContact, ghlSearchContacts, ghlResolveFieldId } from "@/lib/ghl-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RefreshResult {
    affiliateId: string;
    email: string;
    refreshed: boolean;
    wouldRefresh?: boolean;
    linkedContact?: boolean;
    skipReason?: string;
    error?: string;
}

function isAuthorized(req: Request): boolean {
    // Local dev: skip auth so the route is browser-testable. Vercel always sets
    // NODE_ENV=production for deployed builds, so this only relaxes `npm run dev`.
    if (process.env.NODE_ENV === "development") return true;

    const expected = process.env.CRON_SECRET;
    if (!expected) {
        console.error("[cron/refresh-affiliate-links] CRON_SECRET is not set in env");
        return false;
    }
    const header = req.headers.get("authorization") || "";
    return header === `Bearer ${expected}`;
}

export async function GET(req: Request) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ?dry=1 → select + report but write nothing.
    // ?affiliateId=<uuid> → restrict to one affiliate (targeted tests).
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry") === "1";
    const onlyAffiliateId = url.searchParams.get("affiliateId");

    const startedAt = new Date();
    const locationId = process.env.GHL_LOCATION_ID;
    if (!locationId) {
        console.error("[cron/refresh-affiliate-links] GHL_LOCATION_ID is not set");
        return NextResponse.json({ error: "GHL_LOCATION_ID not configured" }, { status: 500 });
    }

    const supabase = createAdminClient();

    // Suspended affiliates are skipped on purpose — a suspended account should
    // not be handed a fresh way in.
    let query = supabase
        .from("affiliates")
        .select("id, email, referral_code, ghl_contact_id, status")
        .eq("status", "active")
        .not("email", "is", null);

    if (onlyAffiliateId) query = query.eq("id", onlyAffiliateId);

    const { data: affiliates, error } = await query;

    if (error) {
        console.error("[cron/refresh-affiliate-links] failed to load affiliates:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!affiliates?.length) {
        return NextResponse.json({ ok: true, scanned: 0, refreshed: 0, skipped: 0 });
    }

    // Resolve both field ids ONCE for the whole run (ghlResolveFieldId caches
    // in-process, but env-first keeps a cold start from hitting the API at all).
    const [dashboardFieldId, personalLinkFieldId] = await Promise.all([
        process.env.GHL_CF_AFFILIATE_DASHBOARD_LINK ||
            ghlResolveFieldId(locationId, "contact.data_vault_affiliate_dashboard_link"),
        process.env.GHL_CF_PERSONAL_AFFILIATE_LINK ||
            ghlResolveFieldId(locationId, "contact.data_vault_personal_affiliate_link"),
    ]);

    if (!dashboardFieldId && !personalLinkFieldId) {
        console.error("[cron/refresh-affiliate-links] neither link custom field could be resolved");
        return NextResponse.json({ error: "Affiliate link custom fields not found in GHL" }, { status: 500 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
    const results: RefreshResult[] = [];

    for (const affiliate of affiliates) {
        const result: RefreshResult = { affiliateId: affiliate.id, email: affiliate.email!, refreshed: false };

        try {
            if (dryRun) {
                result.wouldRefresh = true;
                results.push(result);
                continue;
            }

            // 1. Locate the CRM contact. Affiliates from before the GHL mirror
            //    existed have no stored id, so fall back to a search by email and
            //    keep what we find — next run goes straight through.
            let contactId = affiliate.ghl_contact_id as string | null;
            if (!contactId) {
                const found = await ghlSearchContacts({
                    email: affiliate.email!.toLowerCase(),
                    locationId,
                });
                contactId = found[0]?.id ?? null;
                if (contactId) {
                    await supabase
                        .from("affiliates")
                        .update({ ghl_contact_id: contactId })
                        .eq("id", affiliate.id);
                    result.linkedContact = true;
                }
            }
            if (!contactId) {
                result.skipReason = "no_ghl_contact";
                results.push(result);
                continue;
            }

            // 2. Fresh magic link. No fallback to the plain /affiliate/dashboard
            //    URL here (unlike signup): overwriting a currently-valid one-click
            //    link with a login form would be a downgrade the affiliate feels.
            const dashboardLink = await generateAffiliateDashboardMagicLink(affiliate.email!);
            if (!dashboardLink) {
                result.skipReason = "link_generation_failed";
                results.push(result);
                continue;
            }

            const customFields = [
                dashboardFieldId ? { id: dashboardFieldId, value: dashboardLink } : null,
                personalLinkFieldId
                    ? { id: personalLinkFieldId, value: `${appUrl}/r/${affiliate.referral_code}` }
                    : null,
            ].filter(Boolean) as Array<{ id: string; value: string }>;

            await ghlUpdateContact(contactId, { customFields });

            result.refreshed = true;
            results.push(result);
        } catch (err: any) {
            console.error(`[cron/refresh-affiliate-links] affiliate ${affiliate.id} failed:`, err);
            result.error = err?.message ?? "unknown";
            results.push(result);
        }
    }

    const refreshed = results.filter(r => r.refreshed).length;
    const wouldRefresh = results.filter(r => r.wouldRefresh).length;
    const linked = results.filter(r => r.linkedContact).length;
    const skipped = results.filter(r => !r.refreshed && !r.wouldRefresh && !r.error).length;
    const errored = results.filter(r => !!r.error).length;

    return NextResponse.json({
        ok: true,
        dryRun,
        ranAt: startedAt.toISOString(),
        scanned: affiliates.length,
        refreshed,
        wouldRefresh,
        linked,
        skipped,
        errored,
        results,
    });
}
