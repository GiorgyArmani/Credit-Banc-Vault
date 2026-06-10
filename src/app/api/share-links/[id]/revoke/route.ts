// src/app/api/share-links/[id]/revoke/route.ts
//
// POST — revoke a share link immediately (kill a leaked link). Idempotent:
// revoking an already-revoked link still returns success.
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import { revokeShareLink } from "@/lib/share-links";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing link id." }, { status: 400 });
    }

    const ok = await revokeShareLink(id);
    if (!ok) {
      return NextResponse.json({ error: "Failed to revoke link." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("share-links revoke error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
