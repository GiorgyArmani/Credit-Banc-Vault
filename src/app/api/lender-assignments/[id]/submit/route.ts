// src/app/api/lender-assignments/[id]/submit/route.ts
//
// PATCH /api/lender-assignments/[id]/submit
//   Marks a lender assignment as submitted to the lender — UW has physically
//   pushed the deal out and we're now waiting on the lender.
//
// Transition: status='pending' → status='submitted'. Guards, ledger, admin
// notification and the "every lender out" Slack summary live in
// markAssignmentSubmitted (src/lib/lender-assignment-transitions.ts), shared
// with the lender-API engine.
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/auth/require-staff";
import { resolveRecorderName } from "@/lib/lender-response-history";
import { markAssignmentSubmitted } from "@/lib/lender-assignment-transitions";

const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing assignment id." }, { status: 400 });
    }

    const result = await markAssignmentSubmitted(supabase_admin, {
      assignmentId: id,
      actor: { id: gate.user.id, name: await resolveRecorderName(supabase_admin, gate.user.id) },
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    }
    return NextResponse.json({ success: true, assignment: result.assignment });
  } catch (err: any) {
    console.error("lender-assignment submit error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
