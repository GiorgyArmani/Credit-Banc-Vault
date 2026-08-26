// src/app/api/documents/[id]/file/route.ts
/**
 * ============================================================================
 * GET /api/documents/[id]/file — the only way a browser reaches a client file
 * ============================================================================
 *
 * Every staff and client surface that used to call
 * `supabase.storage.from("user-documents").download(path)` or
 * `.createSignedUrl(path)` from the browser now points here instead. The
 * browser never holds a storage credential and never learns a signed URL it
 * could keep; it holds a document id, which is worthless without a session
 * that clears `resolveDocumentForCaller`.
 *
 * WHY THIS REDIRECTS INSTEAD OF STREAMING — same reasoning as
 * /api/share/[token]/file/[docId]: piping a few hundred MB of bank statements
 * through a serverless function on every preview and every ZIP is slow, capped
 * and paid for twice. This route does the small work (authorise, sign) and
 * answers 302. The bytes travel Supabase → browser directly, so `fetch()`,
 * `<iframe src>`, `<img src>` and `<a href>` all keep working unchanged —
 * they follow the redirect transparently.
 *
 * `?download=1` asks Supabase to set Content-Disposition: attachment with the
 * document's human label, so a saved file is named the way staff expect
 * rather than `drivers_license-1779802582860-x4l5yez3d.pdf`.
 *
 * TTL is deliberately short. The URL exists to serve the request that asked
 * for it; it is not a shareable handle. Lenders get a genuinely shareable one
 * from the separate, revocable /share/[token] mechanism, watermarked.
 * ============================================================================
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDocumentForCaller, resolveServedFileName } from "@/lib/document-access";
import { DOCUMENTS_BUCKET } from "@/lib/watermark";

export const dynamic = "force-dynamic";

/**
 * Long enough to cover a slow preview of a large statement and the retry a
 * flaky connection makes, short enough that a URL scraped out of devtools is
 * dead before it can be passed on.
 */
const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const resolved = await resolveDocumentForCaller(id);
    if (!resolved.ok) {
      // 401 tells the browser to re-authenticate; 403/404 are both reported as
      // "Not available" so a caller cannot distinguish a document that exists
      // from one that does not.
      const message = resolved.status === 401 ? "Unauthorized" : "Not available";
      return NextResponse.json({ error: message }, { status: resolved.status });
    }

    const { doc } = resolved;
    const wants_download = new URL(req.url).searchParams.get("download") === "1";

    const admin = createAdminClient();
    const { data: signed, error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(
        doc.storage_path,
        SIGNED_URL_TTL_SECONDS,
        wants_download ? { download: resolveServedFileName(doc) } : undefined
      );

    if (error || !signed?.signedUrl) {
      // Usually a row that outlived its storage object.
      console.error(
        `document file: could not sign ${doc.storage_path} — ${error?.message ?? "no url"}`
      );
      return NextResponse.json({ error: "Not available" }, { status: 404 });
    }

    // 302, not a permanent redirect: the target is short-lived and must never
    // be cached by a proxy or the browser as this route's stable answer.
    return NextResponse.redirect(signed.signedUrl, {
      status: 302,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err: any) {
    console.error("GET /api/documents/[id]/file threw:", err);
    return NextResponse.json({ error: "Not available" }, { status: 500 });
  }
}
