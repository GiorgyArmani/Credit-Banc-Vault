// src/app/api/lender-assignments/[id]/attachments/route.ts
//
// POST   — register a lender response screenshot already uploaded to storage
//          (via ../attachments/sign), returning the refreshed attachment list.
// DELETE — remove one attachment (?attachment_id=) and its stored file.
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import {
  registerLenderAttachment,
  listLenderAttachments,
  deleteLenderAttachment,
  assignmentExists,
} from "@/lib/lender-attachments";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing assignment id." }, { status: 400 });

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      /* handled below */
    }
    const storage_path = typeof body?.storage_path === "string" ? body.storage_path : "";
    if (!storage_path) {
      return NextResponse.json({ error: "storage_path is required." }, { status: 400 });
    }
    // Guard against writing a path outside this assignment's prefix.
    if (!storage_path.startsWith(`lender-responses/${id}/`)) {
      return NextResponse.json({ error: "Invalid storage_path." }, { status: 400 });
    }

    if (!(await assignmentExists(id))) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    const row = await registerLenderAttachment({
      assignment_id: id,
      storage_path,
      file_name: typeof body?.file_name === "string" ? body.file_name.slice(0, 255) : null,
      file_type: typeof body?.file_type === "string" ? body.file_type.slice(0, 100) : null,
      file_size: typeof body?.file_size === "number" ? body.file_size : null,
      uploaded_by: gate.user.id,
    });
    if (!row) return NextResponse.json({ error: "Failed to register attachment." }, { status: 500 });

    const attachments = await listLenderAttachments(id);
    return NextResponse.json({ success: true, attachments });
  } catch (err: any) {
    console.error("attachments POST error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing assignment id." }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const attachment_id = searchParams.get("attachment_id");
    if (!attachment_id) {
      return NextResponse.json({ error: "attachment_id is required." }, { status: 400 });
    }

    const ok = await deleteLenderAttachment(id, attachment_id);
    if (!ok) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });

    const attachments = await listLenderAttachments(id);
    return NextResponse.json({ success: true, attachments });
  } catch (err: any) {
    console.error("attachments DELETE error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
