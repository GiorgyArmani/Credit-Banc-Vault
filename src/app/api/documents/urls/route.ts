// src/app/api/documents/urls/route.ts
/**
 * ============================================================================
 * POST /api/documents/urls — sign a whole packet at once
 * ============================================================================
 *
 * The single-file route (GET /api/documents/[id]/file) is right for a preview
 * or one download: one authorisation, one redirect. It is the wrong shape for
 * the staff ZIP, which walks a review packet ONE FILE AT A TIME by design (see
 * zip-download.ts — parallel fetches trip Supabase rate limiting and give the
 * reader no honest progress bar). A 155-file packet through the single route is
 * 155 sequential authorisations before the last byte moves, and the ZIP button
 * is exactly where staff already have the least patience.
 *
 * So: authorise once per DISTINCT CLIENT in the batch, then sign every path in
 * one Supabase call. A review packet is one client, so that is a single
 * authorisation regardless of file count, and the browser then pulls the bytes
 * straight from storage the way it did when the bucket was public — same speed,
 * minus the world-readable part.
 *
 * These URLs do reach JavaScript, unlike the redirect route's. That is the
 * whole point of the trade and it is a small one: they last five minutes, and
 * they only ever cover files this caller was already cleared to read.
 * ============================================================================
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callerMayReadClientFiles } from "@/lib/document-access";
import { DOCUMENTS_BUCKET } from "@/lib/watermark";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes, same as the single-file route

/**
 * A ceiling, not a paging mechanism. The largest real packet seen is ~155
 * files; anything past this is a caller doing something other than downloading
 * a client's documents.
 */
const MAX_BATCH = 500;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: auth_error,
    } = await supabase.auth.getUser();

    if (auth_error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const ids: unknown = body?.document_ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "document_ids is required" }, { status: 400 });
    }
    if (ids.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Too many documents in one request (max ${MAX_BATCH})` },
        { status: 400 }
      );
    }

    const document_ids = [...new Set(ids.filter((v): v is string => typeof v === "string"))];
    if (document_ids.length === 0) {
      return NextResponse.json({ error: "document_ids is required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: docs } = await admin
      .from("user_documents")
      .select("id, user_id, storage_path")
      .in("id", document_ids);

    // Authorise once per distinct owning client rather than once per file.
    const owners = [...new Set((docs ?? []).map((d) => d.user_id as string))];
    const permitted = new Set<string>();
    for (const owner of owners) {
      if (await callerMayReadClientFiles(admin, user.id, owner)) permitted.add(owner);
    }

    const allowed = (docs ?? []).filter(
      (d) => d.storage_path && permitted.has(d.user_id as string)
    );

    const urls: Record<string, string> = {};
    if (allowed.length > 0) {
      const { data: signed, error } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrls(
          allowed.map((d) => d.storage_path as string),
          SIGNED_URL_TTL_SECONDS
        );

      if (error) {
        console.error("createSignedUrls failed:", error);
        return NextResponse.json({ error: "Could not sign documents" }, { status: 500 });
      }

      // createSignedUrls answers in request order and reports per-path errors
      // inline, so a single missing object degrades that one entry instead of
      // failing the packet.
      (signed ?? []).forEach((row, index) => {
        const doc = allowed[index];
        if (row?.signedUrl && doc) urls[doc.id as string] = row.signedUrl;
      });
    }

    // The caller is told which ids it did NOT get rather than left to infer it
    // from a short map — a ZIP needs to fail loudly on a missing file.
    const denied = document_ids.filter((id) => !urls[id]);

    return NextResponse.json({ urls, denied }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("POST /api/documents/urls threw:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
