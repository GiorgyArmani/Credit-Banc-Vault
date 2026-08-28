// src/app/api/lender-assignments/[id]/attachments/slack/route.ts
//
// POST — send this assignment's not-yet-posted lender response screenshots into
//        the deal's Slack channel as one post.
//
// The automatic paths (the verdict post, and the first time a response note is
// recorded) already carry whatever screenshots exist at that moment. This route
// is for the ones that arrive afterwards — the approval the lender emailed an
// hour later — which would otherwise never reach the channel.
//
// Idempotent by construction: the sender claims rows atomically, so pressing the
// button twice sends nothing the second time.
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { assignmentExists, listLenderAttachments } from "@/lib/lender-attachments";
import { sendLenderAttachmentsToSlack } from "@/lib/notifications/lender-pipeline";

export async function POST(
  _request: Request,
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

    const { sent, reason } = await sendLenderAttachmentsToSlack(id);
    if (sent === 0) {
      return NextResponse.json({ error: reason || "Nothing was sent." }, { status: 409 });
    }

    // Hand back the refreshed list so the panel can grey out what is now sent.
    const attachments = await listLenderAttachments(id);
    return NextResponse.json({ success: true, sent, attachments });
  } catch (err: any) {
    console.error("attachments slack POST error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
