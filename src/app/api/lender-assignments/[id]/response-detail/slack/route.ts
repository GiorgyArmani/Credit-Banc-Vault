// src/app/api/lender-assignments/[id]/response-detail/slack/route.ts
//
// POST — save the lender response note AND post it into the deal's Slack channel
//        as a revision ("Revised offer from …").
//
// Why this exists: the automatic note post only fires the FIRST time a note is
// recorded (see ../route.ts), so a lender's revised offer typed over the old one
// never reached the channel — the team had to paste it into Slack by hand. This
// is the explicit button for that case.
//
// Body: { response_notes: string } — the note as currently typed. Saved first so
//       the channel and the vault can never disagree about what the offer is.
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import {
  assignmentExists,
  listLenderAttachments,
  saveLenderResponseNotes,
} from "@/lib/lender-attachments";
import { sendRevisedLenderResponseToSlack } from "@/lib/notifications/lender-pipeline";

export async function POST(
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
    if (!response_notes) {
      return NextResponse.json(
        { error: "Type the revised offer in the note before sending it." },
        { status: 400 }
      );
    }

    const saved = await saveLenderResponseNotes(id, response_notes);
    if (!saved) return NextResponse.json({ error: "Failed to save note." }, { status: 500 });

    const result = await sendRevisedLenderResponseToSlack(id);
    if (!result.ok) {
      // The note IS saved — say so, so nobody retypes it.
      return NextResponse.json(
        { error: `Note saved, but not sent to Slack: ${result.reason ?? "unknown error"}`, saved: true },
        { status: 409 }
      );
    }

    const attachments = await listLenderAttachments(id);
    return NextResponse.json({
      success: true,
      response_notes,
      attachments,
      attachments_sent: result.attachments_sent ?? 0,
    });
  } catch (err: any) {
    console.error("response-detail slack POST error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
