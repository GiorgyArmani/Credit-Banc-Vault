// src/app/api/documents/[id]/route.ts
/**
 * ============================================================================
 * DELETE /api/documents/[id] — remove one document a caller is allowed to hold
 * ============================================================================
 *
 * The client vault's "remove" button used to call
 * `supabase.storage.from("user-documents").remove([path])` from the browser,
 * which needed a storage DELETE policy for `authenticated`. That was the last
 * browser-held delete credential on the bucket; it moves here so the bucket can
 * carry no storage policies at all.
 *
 * Authorisation is the same rule as reading (resolveDocumentForCaller): the
 * client who owns the file, an internal desk, or the advisor assigned to /
 * following the vault. That is deliberately the same set that can already
 * delete through the advisor and underwriting server actions, so this route
 * grants nothing new — it only replaces the storage credential.
 *
 * Order matters: storage first, then the row. A failed storage delete is
 * logged, not fatal — an orphaned object is better than a row the UI still
 * shows and cannot remove. Same trade-off the underwriting action makes.
 * ============================================================================
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDocumentForCaller } from "@/lib/document-access";
import { DOCUMENTS_BUCKET } from "@/lib/watermark";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const resolved = await resolveDocumentForCaller(id);
    if (!resolved.ok) {
      const message = resolved.status === 401 ? "Unauthorized" : "Not available";
      return NextResponse.json({ success: false, error: message }, { status: resolved.status });
    }

    const admin = createAdminClient();

    const { error: storage_error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .remove([resolved.doc.storage_path]);
    if (storage_error) {
      console.error("Storage deletion error (client vault):", storage_error);
    }

    const { error: db_error } = await admin
      .from("user_documents")
      .delete()
      .eq("id", resolved.doc.id);

    if (db_error) {
      console.error("Row deletion error (client vault):", db_error);
      return NextResponse.json(
        { success: false, error: "Could not remove the document" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/documents/[id] threw:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
