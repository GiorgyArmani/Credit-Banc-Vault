// src/app/api/lender-api/connected/route.ts
//
// GET — every lender in lender_guidelines that we can submit to by API in THIS
// environment, keyed by lenderKey(lender_name). Lender Match and the lender
// database read it to badge and boost those lenders; they can't work it out
// themselves because provider config lives in server env.

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { providerForLender } from "@/lib/lender-api/registry";
import { buildConnectedLenders } from "@/lib/lender-api/connected";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { data, error } = await createAdminClient().from("lender_guidelines").select("lender_name");
    if (error) {
      console.error("lender-api connected: lender_guidelines read failed:", error.message);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    const lenders = buildConnectedLenders(
      (data ?? []).map((r: { lender_name: string | null }) => r.lender_name),
      providerForLender
    );
    return NextResponse.json({ lenders }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("lender-api connected error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
