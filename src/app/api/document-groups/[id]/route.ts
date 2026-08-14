// src/app/api/document-groups/[id]/route.ts
/**
 * ============================================================================
 * PATCH  /api/document-groups/[id]   — rename / retype / reactivate a group
 * DELETE /api/document-groups/[id]   — remove it, or refuse if it holds files
 * ============================================================================
 *
 * STAFF ONLY, and that is enforced by RLS rather than here: dg_update and
 * dg_delete (migration 20260814) admit admin, UW and the assigned advisor, but
 * NOT the owning client — dg_insert is the only write a client gets. Renaming a
 * group re-labels files that may already sit in a lender's inbox, so it is not
 * a client-side action.
 *
 * Both handlers therefore look identical to the collection routes; the
 * difference in who may call them lives entirely in the policies.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateGroupInput, type DocumentGroup } from "@/lib/document-groups";
import { applyDocumentGroup, loadDocLabels } from "@/lib/group-assignment";

export const dynamic = "force-dynamic";

const GROUP_COLUMNS =
  "id, client_vault_id, business_profile_id, doc_code, name, identifier, subtype, nickname, is_active, created_at, created_by_role";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // The existing row is needed before validating: what counts as a valid
    // identifier or subtype depends on the FIELD this group belongs to, and
    // doc_code is not something the caller may change.
    const { data: current, error: current_error } = await supabase
      .from("document_groups")
      .select(GROUP_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (current_error) {
      console.error("PATCH /api/document-groups/[id] lookup error:", current_error);
      return NextResponse.json({ error: "Failed to load group" }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json(
        { error: "Group not found, or you do not have permission to edit it" },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => null);
    const updates: Record<string, unknown> = {};

    if (typeof body?.name === "string") updates.name = body.name.trim();
    // Explicit null clears; undefined leaves alone.
    if (body?.identifier !== undefined) {
      updates.identifier =
        (typeof body.identifier === "string" ? body.identifier.trim() : "") || null;
    }
    if (body?.subtype !== undefined) {
      updates.subtype = (typeof body.subtype === "string" ? body.subtype.trim() : "") || null;
    }
    if (body?.nickname !== undefined) {
      updates.nickname = (typeof body.nickname === "string" ? body.nickname.trim() : "") || null;
    }
    if (typeof body?.is_active === "boolean") updates.is_active = body.is_active;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // Validate the row as it WILL be, not the patch in isolation — clearing the
    // identifier on a bank account has to fail even though the patch itself
    // mentions only that one field.
    const merged = {
      name: (updates.name as string) ?? current.name,
      identifier:
        updates.identifier !== undefined ? (updates.identifier as string | null) : current.identifier,
      subtype: updates.subtype !== undefined ? (updates.subtype as string | null) : current.subtype,
      nickname:
        updates.nickname !== undefined ? (updates.nickname as string | null) : current.nickname,
    };
    const invalid = validateGroupInput(current.doc_code, merged);
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("document_groups")
      .update(updates)
      .eq("id", id)
      .select(GROUP_COLUMNS)
      .maybeSingle();

    if (error) {
      if ((error as any).code === "23505") {
        return NextResponse.json(
          { error: "Another group on this field already uses that name" },
          { status: 409 }
        );
      }
      console.error("PATCH /api/document-groups/[id] error:", error);
      return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
    }

    // Silent RLS refusal — the SELECT above is permitted for the owning client,
    // the UPDATE is not.
    if (!data) {
      return NextResponse.json(
        { error: "Group not found, or you do not have permission to edit it" },
        { status: 403 }
      );
    }

    // ------------------------------------------------------------------
    // Re-label the group's files when its NAME changed.
    //
    // custom_label embeds the group as `Chase ••4821` (formatGroupShort), so
    // correcting a typo in the name or the identifier would otherwise leave
    // every file in that group still carrying the wrong one — visible the
    // moment anyone downloads, and on the lender share page.
    //
    // Only name / identifier feed the label; nickname and subtype are
    // display-only on the section header, so editing those skips this entirely.
    // ------------------------------------------------------------------
    const label_fields_changed =
      updates.name !== undefined || updates.identifier !== undefined;
    let relabelled = 0;

    if (label_fields_changed) {
      const { data: attached } = await supabase
        .from("user_documents")
        .select("id, user_id, doc_code, category, metadata")
        .eq("document_group_id", id);

      if (attached && attached.length > 0) {
        const label_by_code = await loadDocLabels(
          supabase,
          Array.from(new Set(attached.map((d: any) => (d.doc_code ?? d.category) as string)))
        );
        const { data: vault } = await supabase
          .from("client_data_vault")
          .select("client_name")
          .eq("user_id", attached[0].user_id as string)
          .maybeSingle();

        // Re-apply the SAME group — the row already carries the new name, so
        // this rebuilds each label against it.
        const result = await applyDocumentGroup(supabase, {
          documents: attached as any[],
          group: data as DocumentGroup,
          label_by_code,
          client_name: vault?.client_name ?? null,
        });
        relabelled = result.updated;

        // Non-fatal: the rename itself succeeded and is the thing the user asked
        // for. Report the shortfall rather than pretending.
        if (result.skipped.length > 0) {
          console.error("PATCH /api/document-groups/[id]: relabel incomplete", result.skipped);
        }
      }
    }

    return NextResponse.json({ group: data, relabelled });
  } catch (err: any) {
    console.error("PATCH /api/document-groups/[id] threw:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Delete a group. THE CLIENT'S FILES ARE NEVER TOUCHED.
 *
 * The FK is ON DELETE SET NULL, so nothing cascades — files detach and reappear
 * under "Ungrouped", where they can be filed elsewhere. Deleting a group is a
 * filing-cabinet operation, not a document operation.
 *
 * Two modes, because dumping a sorted group's contents back into the pile is
 * only correct when someone meant it:
 *
 *   * DEFAULT (no ?force) — if the group still holds files, the request is
 *     REFUSED with a 409 carrying `document_count`. The caller shows that
 *     number and asks. Nothing changes.
 *   * ?force=true — detach and delete. The files are relabelled on the way out
 *     (via the same helper the assign endpoint uses) so they don't sit in
 *     "Ungrouped" still named after a group that no longer exists.
 *
 * An empty group is a typo or a test row, and is removed outright either way.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const force = new URL(req.url).searchParams.get("force") === "true";

    // Everything currently filed under this group. Selected in full (not just
    // counted) because the force path has to relabel each row.
    const { data: attached, error: attached_error } = await supabase
      .from("user_documents")
      .select("id, user_id, doc_code, category, metadata")
      .eq("document_group_id", id);

    if (attached_error) {
      console.error("DELETE /api/document-groups/[id] attached lookup error:", attached_error);
      return NextResponse.json({ error: "Failed to check attached documents" }, { status: 500 });
    }

    const document_count = (attached ?? []).length;

    if (document_count > 0 && !force) {
      return NextResponse.json(
        {
          error: "group_has_documents",
          document_count,
          message:
            `This group still holds ${document_count} file(s). Deleting it moves them back ` +
            `to Ungrouped — the files themselves are not deleted.`,
        },
        { status: 409 }
      );
    }

    // Detach + relabel BEFORE the delete. Doing it after would mean the FK has
    // already nulled document_group_id and we'd have lost the row set.
    if (document_count > 0) {
      const label_by_code = await loadDocLabels(
        supabase,
        Array.from(
          new Set((attached ?? []).map((d: any) => (d.doc_code ?? d.category) as string))
        )
      );

      const owner_user_id = (attached ?? [])[0].user_id as string;
      const { data: vault } = await supabase
        .from("client_data_vault")
        .select("client_name")
        .eq("user_id", owner_user_id)
        .maybeSingle();

      const result = await applyDocumentGroup(supabase, {
        documents: (attached ?? []) as any[],
        group: null,
        label_by_code,
        client_name: vault?.client_name ?? null,
      });

      // Refuse to delete the group while any of its files still point at it —
      // otherwise the FK nulls them out and they keep the old group's name
      // forever, with nothing left to trace it back to.
      if (result.skipped.length > 0) {
        console.error("DELETE /api/document-groups/[id]: detach incomplete", result.skipped);
        return NextResponse.json(
          {
            error:
              "Could not detach every file from this group, so it was left in place. " +
              "No files were lost.",
            detached: result.updated,
            failed: result.skipped.length,
          },
          { status: 500 }
        );
      }
    }

    const { data, error } = await supabase
      .from("document_groups")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("DELETE /api/document-groups/[id] error:", error);
      return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Group not found, or you do not have permission to remove it" },
        { status: 403 }
      );
    }

    return NextResponse.json({ deleted: true, detached: document_count });
  } catch (err: any) {
    console.error("DELETE /api/document-groups/[id] threw:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
