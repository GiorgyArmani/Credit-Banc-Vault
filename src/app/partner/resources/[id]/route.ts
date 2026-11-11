// src/app/partner/resources/[id]/route.ts
//
// Opens one resource-library file: checks the viewer, then redirects to a
// short-lived signed URL. Links are minted per click so nothing on the page
// can go stale, and a copied link stops working within minutes.
//
// A route handler does NOT pass through src/app/partner/layout.tsx, so the
// role check lives here (src/proxy.ts gates /partner too — this is the
// defense-in-depth re-check, same reasoning as the layout).

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWebinarId as isUuid } from "@/lib/webinars-shared";
import { PARTNER_RESOURCES_BUCKET } from "@/lib/partner-resources-shared";

// Long enough for a browser PDF viewer to finish its range requests.
const LINK_TTL_SECONDS = 5 * 60;

function message(text: string, status: number) {
  return new NextResponse(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return message("This file doesn't exist.", 404);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/auth/login", req.url));

  const { data: userRow } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  const role = userRow?.role;
  if (role !== "referral_partner" && role !== "partner_advisor" && role !== "admin") {
    return message("You don't have access to this file.", 403);
  }

  const db = createAdminClient();
  const { data: row, error } = await db
    .from("partner_resources")
    .select("file_path, file_name, is_published")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("partner-resources: read failed:", error);
    return message("Couldn't open this file right now — go back and try again.", 500);
  }
  // Hidden files stay reachable for admins (the admin list links here).
  if (!row || (!row.is_published && role !== "admin")) {
    return message("This file is no longer available.", 404);
  }

  // ?download=1 saves it under its original name; otherwise the browser shows
  // what it can (PDFs, images) and downloads the rest.
  const download = req.nextUrl.searchParams.get("download") === "1";
  const { data: signed, error: signError } = await db.storage
    .from(PARTNER_RESOURCES_BUCKET)
    .createSignedUrl(row.file_path, LINK_TTL_SECONDS, download ? { download: row.file_name } : undefined);
  if (signError || !signed?.signedUrl) {
    console.error(`partner-resources: no signed url for ${row.file_path}:`, signError);
    return message("Couldn't open this file right now — go back and try again.", 500);
  }

  return NextResponse.redirect(signed.signedUrl);
}
