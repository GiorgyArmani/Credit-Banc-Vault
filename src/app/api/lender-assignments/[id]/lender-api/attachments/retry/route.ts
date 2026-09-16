// src/app/api/lender-assignments/[id]/lender-api/attachments/retry/route.ts
//
// POST — finish a partial send: flips the assignment to submitted if that step
// failed, and re-sends every selected document the lender has not accepted.

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { retrySubmission } from "@/lib/lender-api/submissions";
import { notAvailable, resolveProviderForAssignment, staffActor } from "@/lib/lender-api/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const admin = createAdminClient();
    const provider = await resolveProviderForAssignment(admin, id);
    if (!provider) return notAvailable();

    const result = await retrySubmission({
      admin,
      provider,
      assignmentId: id,
      actor: await staffActor(admin, gate.user.id),
    });
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (err) {
    console.error("lender-api retry error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
