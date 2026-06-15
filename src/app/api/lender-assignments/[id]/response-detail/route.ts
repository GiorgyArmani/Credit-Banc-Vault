// src/app/api/lender-assignments/[id]/response-detail/route.ts
//
// GET   — the lender's recorded response for this assignment: the typed note
//         (offer / stips / requested docs, or decline reasons) + its screenshots
//         (with short-lived signed view URLs).
// PATCH — save the typed note. Decoupled from the status dropdown (/response) so
//         UW can edit the note without re-firing a pipeline event.
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import {
  listLenderAttachments,
  getLenderResponseNotes,
  saveLenderResponseNotes,
  assignmentExists,
} from "@/lib/lender-attachments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing assignment id." }, { status: 400 });

    const [notes, attachments] = await Promise.all([
      getLenderResponseNotes(id),
      listLenderAttachments(id),
    ]);
    return NextResponse.json({ success: true, response_notes: notes, attachments });
  } catch (err: any) {
    console.error("response-detail GET error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing assignment id." }, { status: 400 });

    if (!(await assignmentExists(id))) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      /* handled below */
    }
    const raw = body?.response_notes;
    const response_notes =
      typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 5000) : null;

    const ok = await saveLenderResponseNotes(id, response_notes);
    if (!ok) return NextResponse.json({ error: "Failed to save note." }, { status: 500 });
    return NextResponse.json({ success: true, response_notes });
  } catch (err: any) {
    console.error("response-detail PATCH error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
