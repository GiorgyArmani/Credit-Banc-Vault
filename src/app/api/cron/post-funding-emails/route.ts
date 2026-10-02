// src/app/api/cron/post-funding-emails/route.ts
//
// Daily sweep for the post-funding client email sequence (9 emails over ~7
// months, signed by the client's advisor). All the logic is in
// src/lib/post-funding/ — this route is auth + query params + a summary.
//
// Mirrors the auth / dry-run conventions of /api/cron/client-check-ins:
//   ?dry=1           → resolve everything, send and record nothing
//   ?clientId=<uuid> → restrict to one client file
//   ?asOf=<ISO date> → pretend it's that date. DRY RUN ONLY, deliberately: on a
//                      live run it would let a query string fire months of
//                      emails at once.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPostFundingSequence } from "@/lib/post-funding/sequence";
import { secretsMatch } from "@/lib/secret-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Each send is an SMTP round-trip; leave room for a busy day.
export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  // Local dev: skip auth so the route is browser-testable. Vercel always sets
  // NODE_ENV=production for deployed builds, so this only relaxes `npm run dev`.
  if (process.env.NODE_ENV === "development") return true;

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/post-funding-emails] CRON_SECRET is not set in env");
    return false;
  }
  return secretsMatch(req.headers.get("authorization"), `Bearer ${expected}`);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const asOfParam = url.searchParams.get("asOf");
  const asOf = asOfParam && dryRun ? new Date(asOfParam) : undefined;
  if (asOf && Number.isNaN(asOf.getTime())) {
    return NextResponse.json({ error: "Invalid asOf date" }, { status: 400 });
  }

  const ranAt = new Date();
  try {
    const results = await runPostFundingSequence(createAdminClient(), {
      dryRun,
      asOf,
      onlyClientId: url.searchParams.get("clientId"),
    });

    return NextResponse.json({
      ok: true,
      dryRun,
      ranAt: ranAt.toISOString(),
      evaluatedAt: (asOf ?? ranAt).toISOString(),
      scanned: results.length,
      sent: results.filter((r) => r.sent).length,
      wouldSend: results.filter((r) => r.wouldSend).length,
      errored: results.filter((r) => r.error).length,
      results,
    });
  } catch (err) {
    console.error("[cron/post-funding-emails] run failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
