// src/app/api/cron/refresh-partner-links/route.ts
//
// Keeps the two referral-partner link custom fields in GHL alive:
//   Referral Partner Link    (contact.referral_partner_link)   → their /referral-partner link
//   referral dashboard link  (contact.referral_dashboard_link) → a FRESH one-click login
//
// Why a cron instead of stamping once at invite: the dashboard link is a
// working credential on the standard 30-day MAGIC_LINK_TTL_DAYS. Stamped once
// and left, the field quietly becomes a link that dumps the partner on
// /auth/login with ?error=verification_failed about a month later — and GHL
// merges the field at SEND time, so a campaign firing next quarter picks up
// whatever is current. Weekly re-stamping keeps a link roughly four missed runs
// deep and lets copies that leaked out of old emails die on schedule.
//
// It doubles as the BACKFILL, and that is most of its job today: the invite
// action only fires for partners an admin actively invites, while the roster is
// 100+ partners the CRM wants to campaign at. Every active partner with an
// email on file gets a contact here, whether they were ever invited or not.
//
// Unlike /api/cron/refresh-affiliate-links, this one DOES write its tag —
// `referral partner` is a durable segment marker, not a joined-just-now
// trigger, so re-adding it weekly cannot re-fire an onboarding workflow.
//
// Auth/dry-run conventions mirror the affiliate cron.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ghlSearchContacts } from "@/lib/ghl-api";
import {
  syncReferralPartnerToGhl,
  refreshPartnerLinkFields,
} from "@/lib/referral-partner-ghl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RefreshResult {
  partnerId: string;
  name: string;
  email: string;
  refreshed: boolean;
  wouldRefresh?: boolean;
  /** Contact did not exist in the vault's location and was created here. */
  created?: boolean;
  /** Contact existed in GHL but the vault had no id for it until now. */
  linkedContact?: boolean;
  wroteFields?: string[];
  skipReason?: string;
  error?: string;
}

function isAuthorized(req: Request): boolean {
  // Local dev: skip auth so the route is browser-testable. Vercel always sets
  // NODE_ENV=production for deployed builds, so this only relaxes `npm run dev`.
  if (process.env.NODE_ENV === "development") return true;

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/refresh-partner-links] CRON_SECRET is not set in env");
    return false;
  }
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ?dry=1        → select + report, write nothing (to GHL or the database).
  // ?partnerId=…  → restrict to one partner (targeted tests).
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const onlyPartnerId = url.searchParams.get("partnerId");

  const startedAt = new Date();
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) {
    console.error("[cron/refresh-partner-links] GHL_LOCATION_ID is not set");
    return NextResponse.json({ error: "GHL_LOCATION_ID not configured" }, { status: 500 });
  }

  const supabase = createAdminClient();

  // Deactivated partners are skipped on purpose: a retired partner should not be
  // handed a fresh way in, and should not sit in a campaign segment.
  //
  // ghl_contact_id is selected defensively — migration 20260909 adds it, and the
  // cron has to survive running before it lands ([[refactor_alongside_production]]).
  let query = supabase
    .from("referral_partners")
    .select("id, name, email, phone, slug, company, ghl_contact_id")
    .eq("active", true)
    .not("email", "is", null);

  if (onlyPartnerId) query = query.eq("id", onlyPartnerId);

  let { data: partners, error } = await query;

  if (error && /ghl_contact_id/.test(error.message)) {
    console.warn(
      "[cron/refresh-partner-links] ghl_contact_id column missing — " +
        "running without stored ids (apply migration 20260909)."
    );
    let fallback = supabase
      .from("referral_partners")
      .select("id, name, email, phone, slug, company")
      .eq("active", true)
      .not("email", "is", null);
    if (onlyPartnerId) fallback = fallback.eq("id", onlyPartnerId);
    const retry = await fallback;
    partners = retry.data as any;
    error = retry.error;
  }

  if (error) {
    console.error("[cron/refresh-partner-links] failed to load partners:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!partners?.length) {
    return NextResponse.json({ ok: true, scanned: 0, refreshed: 0, skipped: 0, results: [] });
  }

  const results: RefreshResult[] = [];

  for (const partner of partners as any[]) {
    const result: RefreshResult = {
      partnerId: partner.id,
      name: partner.name,
      email: partner.email,
      refreshed: false,
    };

    try {
      if (dryRun) {
        result.wouldRefresh = true;
        if (!partner.slug) result.skipReason = "no slug — referral link would be blank";
        results.push(result);
        continue;
      }

      const input = {
        id: partner.id,
        name: partner.name,
        email: partner.email,
        phone: partner.phone ?? null,
        slug: partner.slug ?? null,
        company: partner.company ?? null,
        ghl_contact_id: partner.ghl_contact_id ?? null,
      };

      // 1. Locate the CRM contact. Partners synced before have a stored id;
      //    partners migrated in from the main GHL account are found by email and
      //    the id kept, so the next run goes straight to the cheap update.
      let contactId: string | null = partner.ghl_contact_id ?? null;
      if (!contactId) {
        const found = await ghlSearchContacts({
          email: String(partner.email).toLowerCase(),
          locationId,
        });
        contactId = found[0]?.id ?? null;
        if (contactId) result.linkedContact = true;
      }

      // 2. Known contact → one cheap field update. Unknown → full upsert, which
      //    creates the contact with its type and tag.
      const outcome = contactId
        ? await refreshPartnerLinkFields(contactId, input)
        : await syncReferralPartnerToGhl(input);
      if (!contactId && outcome.contactId) result.created = true;

      if (!outcome.synced) {
        result.skipReason = outcome.skipReason;
        result.error = outcome.error;
        results.push(result);
        continue;
      }

      // 3. Stamp the id. Best-effort and separate, so a missing column (pre
      //    migration 20260909) costs a wasted search next run and nothing more.
      const resolvedId = outcome.contactId ?? contactId;
      if (resolvedId && resolvedId !== partner.ghl_contact_id) {
        const { error: stampErr } = await supabase
          .from("referral_partners")
          .update({ ghl_contact_id: resolvedId })
          .eq("id", partner.id);
        if (stampErr) {
          console.warn(
            `[cron/refresh-partner-links] could not stamp ghl_contact_id for ${partner.id}:`,
            stampErr.message
          );
        }
      }

      result.refreshed = true;
      result.wroteFields = outcome.wroteFields;
      results.push(result);
    } catch (err: any) {
      console.error(`[cron/refresh-partner-links] partner ${partner.id} failed:`, err);
      result.error = err?.message ?? "unknown";
      results.push(result);
    }
  }

  const refreshed = results.filter((r) => r.refreshed).length;
  const wouldRefresh = results.filter((r) => r.wouldRefresh).length;
  const created = results.filter((r) => r.created).length;
  const linked = results.filter((r) => r.linkedContact).length;
  const skipped = results.filter((r) => !r.refreshed && !r.wouldRefresh && !r.error).length;
  const errored = results.filter((r) => !!r.error).length;

  console.log(
    `[cron/refresh-partner-links] scanned=${partners.length} refreshed=${refreshed} ` +
      `created=${created} linked=${linked} skipped=${skipped} errored=${errored} dry=${dryRun}`
  );

  return NextResponse.json({
    ok: true,
    dryRun,
    ranAt: startedAt.toISOString(),
    scanned: partners.length,
    refreshed,
    wouldRefresh,
    created,
    linked,
    skipped,
    errored,
    results,
  });
}
