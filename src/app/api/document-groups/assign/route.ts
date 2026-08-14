// src/app/api/document-groups/assign/route.ts
/**
 * ============================================================================
 * POST /api/document-groups/assign — file existing documents into a group
 * ============================================================================
 *
 * The retrofit half of the feature, and the reason underwriting can use it on
 * day one. Everything already uploaded carries document_group_id = NULL and
 * renders under "Ungrouped" — the O'Rourke file alone is 124 such statements,
 * and the same file holds several years of tax returns in one undifferentiated
 * stack. Without a bulk assign, organising any of it would mean re-uploading.
 *
 * INPUT:
 *   { document_ids: string[], document_group_id: string | null }
 *
 * document_group_id = null un-files, which is how a mis-sorted batch is undone.
 *
 * SIDE EFFECT ON PURPOSE — custom_label is rebuilt for every affected file.
 * Filing documents into a group without renaming them would leave 124 rows
 * still called `Business Bank Statements - O'Rourke LLC`: grouped on screen,
 * still indistinguishable the moment anyone downloads them. The label is what
 * the browser writes to disk and what the lender share page shows, so the two
 * have to move together. Un-filing reverses it symmetrically.
 *
 * AUTHORIZATION IS RLS. Reads and writes both run through the RLS-gated server
 * client: ud_update admits admin, UW, the assigned advisor and the owning
 * client, so any of them may organise their own file and none may touch
 * another's. Rows the caller cannot see simply do not come back from the
 * SELECT, and are reported as skipped rather than silently succeeding.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { DocumentGroup } from "@/lib/document-groups";
import { applyDocumentGroup, loadDocLabels } from "@/lib/group-assignment";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One request cannot exceed this. The largest real file we've seen is 124. */
const MAX_DOCUMENTS_PER_REQUEST = 500;

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const document_ids: string[] = Array.isArray(body?.document_ids) ? body.document_ids : [];
    // Explicitly distinguish "ungroup" (null) from "missing field".
    const document_group_id: string | null = body?.document_group_id ?? null;

    if (document_ids.length === 0) {
      return NextResponse.json({ error: "document_ids is required" }, { status: 400 });
    }
    if (document_ids.length > MAX_DOCUMENTS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Cannot file more than ${MAX_DOCUMENTS_PER_REQUEST} documents at once` },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------
    // 1. Resolve the target group (skipped when un-filing)
    // ------------------------------------------------------------------
    let group: DocumentGroup | null = null;
    if (document_group_id) {
      const { data, error } = await supabase
        .from("document_groups")
        .select(
          "id, client_vault_id, business_profile_id, doc_code, name, identifier, subtype, nickname, is_active"
        )
        .eq("id", document_group_id)
        .maybeSingle();

      if (error) {
        console.error("assign: group lookup error:", error);
        return NextResponse.json({ error: "Failed to load group" }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json(
          { error: "Group not found, or you do not have access to it" },
          { status: 404 }
        );
      }
      group = data as DocumentGroup;
    }

    // ------------------------------------------------------------------
    // 2. Load the documents. RLS decides which of the requested ids come back.
    // ------------------------------------------------------------------
    const { data: docs, error: docs_error } = await supabase
      .from("user_documents")
      .select("id, user_id, name, doc_code, category, business_profile_id, metadata")
      .in("id", document_ids);

    if (docs_error) {
      console.error("assign: document lookup error:", docs_error);
      return NextResponse.json({ error: "Failed to load documents" }, { status: 500 });
    }

    const skipped: { id: string; reason: string }[] = [];
    const visible_ids = new Set((docs ?? []).map((d: any) => d.id));
    for (const id of document_ids) {
      if (!visible_ids.has(id)) skipped.push({ id, reason: "not_found_or_no_access" });
    }

    const eligible = (docs ?? []).filter((d: any) => {
      const code = d.doc_code ?? d.category ?? null;

      // THE FIELD MUST MATCH. Groups are per-field, so a tax return cannot be
      // filed under a bank account — it would render in a section its own field
      // never draws and disappear from both. This replaces the old
      // "is it a bank statement?" check with the stronger general rule.
      if (group && code !== group.doc_code) {
        skipped.push({ id: d.id, reason: "wrong_field" });
        return false;
      }

      // Cross-business filing would produce a document whose own business tab
      // groups it under something belonging to a different business — it would
      // vanish from both views. Client-scoped groups (business_profile_id NULL)
      // are exempt: their documents legitimately carry NULL or any business.
      if (group?.business_profile_id && d.business_profile_id !== group.business_profile_id) {
        skipped.push({ id: d.id, reason: "different_business" });
        return false;
      }

      return true;
    });

    if (eligible.length === 0) {
      return NextResponse.json({ updated: 0, skipped }, { status: skipped.length ? 200 : 400 });
    }

    // ------------------------------------------------------------------
    // 3. Names for the rebuilt labels
    // ------------------------------------------------------------------
    const label_by_code = await loadDocLabels(
      supabase,
      Array.from(new Set(eligible.map((d: any) => (d.doc_code ?? d.category) as string)))
    );

    // Documents are keyed by auth user; the vault holds the display name. One
    // lookup covers the batch — every document in it belongs to one client.
    const owner_user_id = eligible[0].user_id as string;
    const { data: vault } = await supabase
      .from("client_data_vault")
      .select("client_name")
      .eq("user_id", owner_user_id)
      .maybeSingle();
    const client_name = vault?.client_name ?? null;

    // ------------------------------------------------------------------
    // 4. Apply. Shared with the force path of DELETE /api/document-groups/[id],
    //    which detaches a group's files the same way.
    // ------------------------------------------------------------------
    const result = await applyDocumentGroup(supabase, {
      documents: eligible as any[],
      group,
      label_by_code,
      client_name,
    });

    return NextResponse.json({
      updated: result.updated,
      skipped: [...skipped, ...result.skipped],
    });
  } catch (err: any) {
    console.error("POST /api/document-groups/assign threw:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
