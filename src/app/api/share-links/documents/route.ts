// src/app/api/share-links/documents/route.ts
//
// GET — list the approved document categories a staff member can pick from when
// minting a lender share link, for the active business. One entry per approved
// code that has at least one uploaded file.
//
// AuthZ: admin OR underwriting (see require-staff) — same gate as the link mint.

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { listShareableFiles } from "@/lib/share-links";

export async function GET(request: Request) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(request.url);
    const client_id = searchParams.get("client_id");
    if (!client_id) {
      return NextResponse.json({ error: "client_id is required." }, { status: 400 });
    }
    const business_profile_id = searchParams.get("business_profile_id");

    const files = await listShareableFiles(client_id, business_profile_id);
    return NextResponse.json({ success: true, files });
  } catch (err: any) {
    console.error("share-links documents GET error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
