// src/app/api/lender-assignments/[id]/lender-api/preview/route.ts
//
// GET — everything the lender-API review panel shows for one assignment:
// provider picks, resolved vault fields (SSN reduced to last 4), gaps,
// submittable documents and prior submissions. Staff only.

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadLenderApiSource } from "@/lib/lender-api/source";
import { buildPreview } from "@/lib/lender-api/submissions";
import { notAvailable, resolveProviderForAssignment } from "@/lib/lender-api/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const admin = createAdminClient();
    // Provider first: an assignment with no configured lender API 404s before
    // the full vault (SSN included) is ever loaded.
    const provider = await resolveProviderForAssignment(admin, id);
    if (!provider) return notAvailable();
    const source = await loadLenderApiSource(admin, id);
    if (!source) return notAvailable();

    const body = await buildPreview(admin, provider, source);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("lender-api preview error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
