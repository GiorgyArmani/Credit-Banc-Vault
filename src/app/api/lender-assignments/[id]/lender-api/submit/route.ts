// src/app/api/lender-assignments/[id]/lender-api/submit/route.ts
//
// POST — send this assignment's deal to its lender's API.
// Body: { vault_updates?: {...}, picks?: {...}, document_ids?: string[], confirm_resend?: true }
// confirm_resend is required after an attempt that may have reached the lender.
// The application is created synchronously (validation errors come straight
// back); documents are watermarked + uploaded in after(), hence maxDuration.

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitApplication } from "@/lib/lender-api/submissions";
import { notAvailable, resolveProviderForAssignment, staffActor } from "@/lib/lender-api/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const admin = createAdminClient();
    const provider = await resolveProviderForAssignment(admin, id);
    if (!provider) return notAvailable();

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
    }

    const result = await submitApplication({
      admin,
      provider,
      assignmentId: id,
      actor: await staffActor(admin, gate.user.id),
      vaultUpdates: body?.vault_updates,
      picks: body?.picks,
      documentIds: body?.document_ids,
      confirmResend: body?.confirm_resend,
    });
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (err) {
    console.error("lender-api submit error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
