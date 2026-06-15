// src/app/api/lender-assignments/[id]/attachments/sign/route.ts
//
// POST — mint a Supabase signed upload URL so a staff browser can push a lender
// response screenshot straight to storage (bypassing the serverless body cap).
// The browser then POSTs the returned storage_path to ../attachments to record
// the row.
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LENDER_ATTACH_BUCKET,
  buildLenderAttachmentPath,
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
    const file_name = typeof body?.file_name === "string" ? body.file_name : "";
    if (!file_name) {
      return NextResponse.json({ error: "file_name is required." }, { status: 400 });
    }

    if (!(await assignmentExists(id))) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    const file_path = buildLenderAttachmentPath(id, file_name);
    const supabase = createAdminClient();
    const { data: signed, error } = await supabase.storage
      .from(LENDER_ATTACH_BUCKET)
      .createSignedUploadUrl(file_path, { upsert: true });

    if (error || !signed) {
      console.error("attachment sign error:", error);
      return NextResponse.json(
        { error: error?.message || "Failed to create signed upload URL." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      signed_url: signed.signedUrl,
      token: signed.token,
      file_path,
    });
  } catch (err: any) {
    console.error("attachment sign route error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
