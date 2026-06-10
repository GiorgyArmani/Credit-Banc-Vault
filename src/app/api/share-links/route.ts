// src/app/api/share-links/route.ts
//
// POST  — create a lender document share link for a client/business.
// GET   — list this client's share links (for the manager UI).
//
// AuthZ: admin OR underwriting (see require-staff). Advisors don't run
// submission, so they don't mint lender links.

import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/require-staff";
import {
  createShareLink,
  listShareLinks,
  ALLOWED_EXPIRY_DAYS,
} from "@/lib/share-links";

export async function POST(request: Request) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      /* handled below */
    }

    const client_id = body?.client_id;
    if (!client_id || typeof client_id !== "string") {
      return NextResponse.json({ error: "client_id is required." }, { status: 400 });
    }
    const business_profile_id =
      typeof body?.business_profile_id === "string" ? body.business_profile_id : null;
    const expires_in_days = Number(body?.expires_in_days);
    if (!ALLOWED_EXPIRY_DAYS.includes(expires_in_days as any)) {
      return NextResponse.json(
        { error: `expires_in_days must be one of ${ALLOWED_EXPIRY_DAYS.join(", ")}.` },
        { status: 400 }
      );
    }
    const label =
      typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 120) : null;

    const link = await createShareLink({
      client_id,
      business_profile_id,
      created_by: gate.user.id,
      created_by_email: gate.user.email ?? null,
      label,
      expires_in_days,
    });

    if (!link) {
      return NextResponse.json({ error: "Failed to create share link." }, { status: 500 });
    }

    // Return the path; the client builds the absolute URL from its own origin so
    // the link uses whatever public host the proxy serves.
    return NextResponse.json({ success: true, link, path: `/share/${link.token}` });
  } catch (err: any) {
    console.error("share-links POST error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}

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

    const links = await listShareLinks(client_id, business_profile_id);
    return NextResponse.json({ success: true, links });
  } catch (err: any) {
    console.error("share-links GET error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
