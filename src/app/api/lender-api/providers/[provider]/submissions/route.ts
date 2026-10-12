// src/app/api/lender-api/providers/[provider]/submissions/route.ts
//
// GET  — every deal we sent to this lender by API, with the lender's status as
//        last read. Feeds the "API deals" view in the lender database.
// POST — re-read those statuses from the lender now and apply them (the same
//        path as "Refresh status" on a file), then return the fresh list.

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProvider } from "@/lib/lender-api/registry";
import { listProviderActivity, refreshProviderActivity } from "@/lib/lender-api/activity";
import { notAvailable } from "@/lib/lender-api/route-helpers";

export const dynamic = "force-dynamic";
// POST makes one lender round trip per current submission.
export const maxDuration = 150;

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export async function GET(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const provider = getProvider((await params).provider);
    if (!provider) return notAvailable();

    const submissions = await listProviderActivity(createAdminClient(), provider);
    if (!submissions) return NextResponse.json({ error: "Server error" }, { status: 500 });
    return NextResponse.json({ display_name: provider.displayName, live: !!provider.fetchStatus, submissions }, NO_STORE);
  } catch (err) {
    console.error("lender-api provider submissions error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const provider = getProvider((await params).provider);
    if (!provider) return notAvailable();

    const admin = createAdminClient();
    const refresh = await refreshProviderActivity(admin, provider);
    if (!refresh) return NextResponse.json({ error: "Server error" }, { status: 500 });
    if (refresh.unsupported) {
      return NextResponse.json(
        { error: `${provider.displayName} has no status API — their answers arrive on their own.` },
        { status: 409 }
      );
    }

    const submissions = await listProviderActivity(admin, provider);
    if (!submissions) return NextResponse.json({ error: "Server error" }, { status: 500 });
    return NextResponse.json({ display_name: provider.displayName, live: true, submissions, refresh }, NO_STORE);
  } catch (err) {
    console.error("lender-api provider refresh error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
