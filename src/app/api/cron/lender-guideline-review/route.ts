// src/app/api/cron/lender-guideline-review/route.ts
//
// Weekly nudge: when any lender's guidelines haven't been reviewed in over six
// months, remind the underwriting team (in-app + email) to re-check them. The
// cron runs weekly (see vercel.json), so a stale lender produces at most one
// nudge a week until UW reviews it — no per-run state table needed.
//
// Auth: CRON_SECRET bearer (relaxed in dev), mirroring the other cron routes.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { send_lender_review_reminder_email } from "@/lib/email";

// A lender is "due" once its newest guideline row is older than this.
const REVIEW_INTERVAL_MS = 1000 * 60 * 60 * 24 * 183; // ~6 months

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/lender-guideline-review] CRON_SECRET is not set");
    return false;
  }
  return (req.headers.get("authorization") || "") === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const supabase = createAdminClient();

  // Pull every guideline row; collapse to one freshness per lender (a lender is
  // only as fresh as its most-recently-reviewed program — if ANY program is
  // current the lender was looked at recently).
  const { data: rows, error } = await supabase
    .from("lender_guidelines")
    .select("lender_name, last_reviewed_at");
  if (error) {
    console.error("[cron/lender-guideline-review] query error:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const newest = new Map<string, number | null>();
  for (const r of rows ?? []) {
    const name = (r as any).lender_name as string;
    const ts = (r as any).last_reviewed_at ? new Date((r as any).last_reviewed_at).getTime() : null;
    const cur = newest.get(name);
    if (cur === undefined) {
      newest.set(name, ts);
    } else if (ts !== null && (cur === null || ts > cur)) {
      newest.set(name, ts);
    }
  }

  const now = Date.now();
  const stale_lenders = Array.from(newest.entries())
    .filter(([, ts]) => ts === null || now - ts > REVIEW_INTERVAL_MS)
    .map(([name, ts]) => ({
      name,
      last_reviewed: ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (stale_lenders.length === 0) {
    return NextResponse.json({ success: true, stale: 0, notified: 0, emailed: 0 });
  }

  // Recipients: the underwriting team (+ admins, who oversee the database).
  const { data: staff } = await supabase
    .from("users")
    .select("id, email")
    .in("role", ["underwriting", "admin"]);
  const recipients = (staff ?? []) as { id: string; email: string }[];

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
  const guidelines_url = `${baseUrl}/underwriting/lender-guidelines`;
  const title = `${stale_lenders.length} lender${stale_lenders.length === 1 ? "" : "s"} due for guideline review`;
  const message = `These lenders haven't been reviewed in 6+ months: ${stale_lenders
    .map((l) => l.name)
    .slice(0, 10)
    .join(", ")}${stale_lenders.length > 10 ? "…" : ""}. Re-check and mark them reviewed.`;

  if (dry) {
    return NextResponse.json({
      success: true,
      dry: true,
      stale: stale_lenders.length,
      stale_lenders,
      recipients: recipients.map((r) => r.email),
    });
  }

  // In-app: one row per staff member (no client context → client_id null).
  let notified = 0;
  try {
    const rows_to_insert = recipients.map((u) => ({
      user_id: u.id,
      title,
      message,
      is_read: false,
    }));
    if (rows_to_insert.length > 0) {
      const { error: insert_err } = await supabase.from("in_app_notifications").insert(rows_to_insert);
      if (insert_err) console.error("[cron/lender-guideline-review] in-app insert error:", insert_err);
      else notified = rows_to_insert.length;
    }
  } catch (e) {
    console.error("[cron/lender-guideline-review] in-app exception:", e);
  }

  // Email: one digest to the whole team.
  let emailed = 0;
  try {
    const emails = recipients.map((r) => r.email).filter((e): e is string => !!e && e.includes("@"));
    if (emails.length > 0) {
      await send_lender_review_reminder_email({ to_emails: emails, stale_lenders, guidelines_url });
      emailed = emails.length;
    }
  } catch (e) {
    console.error("[cron/lender-guideline-review] email error (non-fatal):", e);
  }

  return NextResponse.json({ success: true, stale: stale_lenders.length, notified, emailed });
}
