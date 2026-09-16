// src/app/api/lender-assignments/[id]/lender-api/refresh/route.ts
//
// POST — pull the lender's current status for the latest API submission and
// apply it exactly as the webhook would.

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { listSubmissions, refreshSubmissionStatus } from "@/lib/lender-api/submissions";
import { notAvailable, resolveProviderForAssignment } from "@/lib/lender-api/route-helpers";

export const dynamic = "force-dynamic";
// Status fetch + verdict write + needs-info notifications (Slack) in one request.
export const maxDuration = 150;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const admin = createAdminClient();
    const provider = await resolveProviderForAssignment(admin, id);
    if (!provider) return notAvailable();

    const latest = (await listSubmissions(admin, id)).find((s) => s.external_id);
    if (!latest) return NextResponse.json({ error: "No submission has reached the lender yet." }, { status: 409 });

    const result = await refreshSubmissionStatus(admin, provider, latest);
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (err) {
    console.error("lender-api refresh error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
