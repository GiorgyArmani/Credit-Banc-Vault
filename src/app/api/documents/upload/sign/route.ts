// src/app/api/documents/upload/sign/route.ts
/**
 * ============================================================================
 * POST /api/documents/upload/sign — a client uploading into their OWN vault
 * ============================================================================
 *
 * The client vault at /dashboard used to call
 * `supabase.storage.from("user-documents").upload(path, file)` straight from
 * the browser. That needed a storage INSERT policy for `authenticated`, and it
 * was the last browser-held write credential on the bucket. This route mints a
 * signed upload URL with the service role instead, so the bucket can go
 * private with no storage policies at all.
 *
 * WHY A SIGNED URL RATHER THAN POSTING THE FILE HERE: a serverless function
 * body is capped at 4.5 MB on Vercel and a year of bank statements is not. The
 * bytes must travel browser → Supabase directly. Same reason
 * /api/advisor/clients/upload/sign exists for the staff side.
 *
 * AUTHORISATION IS STRUCTURAL, not a check to remember: the storage path is
 * built from the CALLER'S OWN auth id. There is no client_id parameter, so
 * there is no way to aim this at another client's folder — the worst a caller
 * can do is add a file to their own vault, which is the feature.
 *
 * The `user_documents` row is still inserted by the browser afterwards under
 * table RLS, exactly as before; only the storage half moved.
 * ============================================================================
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENTS_BUCKET } from "@/lib/watermark";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: auth_error,
    } = await supabase.auth.getUser();

    if (auth_error || !user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const doc_code: string | undefined = body?.doc_code;
    const file_name: string | undefined = body?.file_name;

    if (!doc_code || !file_name) {
      return NextResponse.json(
        { success: false, error: "doc_code and file_name are required" },
        { status: 400 }
      );
    }

    // Same shape the vault has always written, so nothing downstream (the GHL
    // sync, the doc-code matchers, the share links) sees a new kind of path.
    // `doc_code` is sanitised because it lands in a storage key.
    const ext = (file_name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const safe_code = doc_code.replace(/[^A-Za-z0-9_-]/g, "");
    const normalized = `${safe_code}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}.${ext || "bin"}`;
    const file_path = `${user.id}/${normalized}`;

    const admin = createAdminClient();
    const { data: signed, error: sign_error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUploadUrl(file_path, { upsert: true });

    if (sign_error || !signed) {
      console.error("Failed to create client signed upload URL:", sign_error);
      return NextResponse.json(
        { success: false, error: sign_error?.message || "Failed to create upload URL" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      signed_url: signed.signedUrl,
      token: signed.token,
      file_path,
    });
  } catch (error: any) {
    console.error("POST /api/documents/upload/sign threw:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
