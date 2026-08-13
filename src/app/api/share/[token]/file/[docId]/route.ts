// src/app/api/share/[token]/file/[docId]/route.ts
/**
 * ============================================================================
 * GET /api/share/[token]/file/[docId] — serve one shared document, stamped
 * ============================================================================
 *
 * The only way a lender reaches a file. The share page no longer hands out
 * signed URLs to stored originals at all, which is the point: the recipient is
 * the party we are watermarking against, so they must never hold a URL to an
 * unstamped copy.
 *
 * WHY THIS REDIRECTS INSTEAD OF STREAMING. Piping bytes through this function
 * would put a few hundred MB of packet through a serverless lambda on every
 * view and every ZIP — slow, capped, and paid for twice. Instead the route does
 * the small work (authorise, ensure a stamped copy exists) and answers 302 to a
 * short-lived signed URL. The bytes travel Supabase → browser directly, so the
 * client-side ZIP on the share page keeps working unchanged: fetch() follows
 * the redirect transparently.
 *
 * The first request for a given document pays for the stamping; every request
 * after that is a cache hit and just signs.
 *
 * SIDE BENEFIT: revocation is now immediate. Previously a signed URL copied out
 * of the page stayed live for its full 2h TTL even after staff revoked the link.
 * Every fetch now re-validates the token.
 */

import { NextResponse } from "next/server";
import { resolveShareFile, SIGNED_URL_TTL_SECONDS } from "@/lib/share-links";
import { getWatermarkedPath, DOCUMENTS_BUCKET } from "@/lib/watermark";

export const dynamic = "force-dynamic";
// Stamping a large multi-page statement is the slow path, and it only happens
// once per document.
export const maxDuration = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; docId: string }> }
) {
  try {
    const { token, docId } = await params;

    const resolved = await resolveShareFile(token, docId);
    // One response for "bad token", "revoked", "expired" and "not on this
    // link" alike — distinguishing them would let someone probe which
    // documents exist behind a dead token.
    if (!resolved) {
      return NextResponse.json({ error: "Not available" }, { status: 404 });
    }

    const { supabase, doc, watermark_enabled } = resolved;

    const serve = watermark_enabled
      ? await getWatermarkedPath(supabase, doc)
      : { path: doc.storage_path, stamped: false, generated: false };

    // Stamped copies are always PDFs (images are converted), so the download
    // name has to follow or the file opens in the wrong app.
    const base_name = doc.custom_label || doc.name || "document";
    const download_name = serve.stamped
      ? `${base_name.replace(/\.[A-Za-z0-9]+$/, "")}.pdf`
      : base_name;

    const wants_download = new URL(req.url).searchParams.get("download") === "1";

    const { data: signed, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(
        serve.path,
        SIGNED_URL_TTL_SECONDS,
        wants_download ? { download: download_name } : undefined
      );

    if (error || !signed?.signedUrl) {
      // Usually means the row outlived its storage object — see
      // filterToExistingObjects, which keeps these off the listing in the first
      // place. Reachable directly by an old URL, so it stays a clean 404.
      console.error(`share file: could not sign ${serve.path} — ${error?.message ?? "no url"}`);
      return NextResponse.json({ error: "Not available" }, { status: 404 });
    }

    // 302, not 307/permanent: the target is a short-lived signed URL and must
    // never be cached by a proxy or a browser as this route's stable answer.
    return NextResponse.redirect(signed.signedUrl, {
      status: 302,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: any) {
    console.error("GET /api/share/[token]/file/[docId] threw:", err);
    return NextResponse.json({ error: "Not available" }, { status: 500 });
  }
}
