// src/lib/group-assignment.ts
/**
 * Server-side helper: move documents onto (or off) a group.
 *
 * Shared by POST /api/document-groups/assign and the force path of
 * DELETE /api/document-groups/[id], because both do the same job — deleting a
 * group has to detach its files AND strip the group back out of their labels,
 * or the files land in "Ungrouped" still named after a group that no longer
 * exists.
 *
 * The label rewrite is not optional. `custom_label` is what the browser writes
 * to disk and what the lender share page displays, so it has to track
 * document_group_id or the two disagree the moment anyone downloads.
 *
 * Caller supplies the Supabase client, and RLS on that client is the
 * authorization boundary — this function does not check permissions. It DOES
 * report per-document outcomes, because a denied write returns no row rather
 * than raising ([[rls_client_writes_need_service_role]]).
 *
 * Generalized from statement-assignment.ts, which did this for bank statements
 * only. Nothing in the logic was bank-specific; only the names were.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGroupedDisplayLabel,
  getDocumentPeriod,
  type DocumentGroup,
} from "@/lib/document-groups";

export interface GroupAssignmentResult {
  updated: number;
  skipped: { id: string; reason: string }[];
}

/** PostgREST puts `.in()` filters in the query string; a few hundred UUIDs
 *  overruns URL length limits. */
const CHUNK_SIZE = 100;

/**
 * Apply `group` (or null to detach) to every document in `documents`.
 *
 * `documents` must already be filtered to rows the caller verified belong to
 * the right field and the right business — this function trusts that and only
 * handles labelling + writing.
 */
export async function applyDocumentGroup(
  supabase: SupabaseClient,
  params: {
    documents: { id: string; doc_code?: string | null; category?: string | null; metadata?: any }[];
    group: DocumentGroup | null;
    label_by_code: Map<string, string>;
    client_name: string | null;
  }
): Promise<GroupAssignmentResult> {
  const { documents, group, label_by_code, client_name } = params;
  const skipped: { id: string; reason: string }[] = [];

  if (documents.length === 0) return { updated: 0, skipped };

  // Bucket by the label each document will end up with. One UPDATE per document
  // would be 133 sequential round trips on a real file; documents only differ in
  // label when a period was parsed out of the original filename, which is the
  // minority, so this usually collapses to one or two queries.
  const ids_by_label = new Map<string, string[]>();
  for (const doc of documents) {
    const code = (doc.doc_code ?? doc.category ?? "") as string;
    const custom_label = buildGroupedDisplayLabel({
      doc_label: label_by_code.get(code) || code,
      client_name,
      group,
      period: getDocumentPeriod(doc),
    });
    const bucket = ids_by_label.get(custom_label);
    if (bucket) bucket.push(doc.id);
    else ids_by_label.set(custom_label, [doc.id]);
  }

  let updated = 0;

  for (const [custom_label, ids] of ids_by_label) {
    for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + CHUNK_SIZE);

      const { data, error } = await supabase
        .from("user_documents")
        .update({ document_group_id: group?.id ?? null, custom_label })
        .in("id", chunk)
        .select("id");

      if (error) {
        console.error("applyDocumentGroup: chunk update failed:", error);
        for (const id of chunk) skipped.push({ id, reason: "update_failed" });
        continue;
      }

      // Diff what came back against what we asked for — a silent RLS refusal is
      // an absent row, and reporting it as success is how a packet goes out
      // half-organised.
      const written = new Set((data ?? []).map((r: any) => r.id as string));
      updated += written.size;
      for (const id of chunk) {
        if (!written.has(id)) skipped.push({ id, reason: "not_permitted" });
      }
    }
  }

  return { updated, skipped };
}

/** Human labels for a set of doc codes. Every caller needs the same lookup. */
export async function loadDocLabels(
  supabase: SupabaseClient,
  codes: string[]
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const { data } = await supabase
    .from("required_documents")
    .select("code, label")
    .in("code", codes);
  return new Map((data ?? []).map((r: any) => [r.code as string, r.label as string]));
}
