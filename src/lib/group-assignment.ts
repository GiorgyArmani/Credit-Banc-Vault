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
 * The label rewrite tracks the group — `custom_label` is what the browser
 * writes to disk and what the lender share page displays, so a system-generated
 * label has to follow document_group_id or the two disagree the moment anyone
 * downloads.
 *
 * BUT IT ONLY REWRITES LABELS THE SYSTEM WROTE. `custom_label` does double duty:
 * it is also the field the Rename action writes, so a name someone typed by
 * hand lives in the same column as the generated one. Rewriting unconditionally
 * meant that filing documents into a group silently discarded every name the
 * team had given them. See isSystemGeneratedLabel below for how the two are
 * told apart.
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
  /** Documents that moved group but kept a hand-typed name. */
  preserved_labels: number;
}

/** The fields this module reads off a document row. */
export interface AssignableDocument {
  id: string;
  doc_code?: string | null;
  category?: string | null;
  metadata?: any;
  /** Needed to tell a generated label from a typed one. */
  custom_label?: string | null;
  /** Needed to reconstruct the label this document currently ought to have. */
  document_group_id?: string | null;
}

/**
 * Was this document's current label written by us, or typed by a person?
 *
 * There is no flag on the old rows to answer that, so we answer it by
 * reconstruction: build every label the system could have produced for this
 * document as it stands — under its current group and ungrouped, with and
 * without the period parsed from its original filename — and see whether the
 * stored one is among them. A match means nobody has touched it and the rewrite
 * is safe. Anything else is a name someone chose, and choosing it is the whole
 * point of the Rename action.
 *
 * Documents renamed AFTER this change carry `metadata.label_source = 'manual'`
 * and short-circuit the reconstruction. The reconstruction is what covers every
 * document renamed before it — which is all of them today.
 *
 * Errs toward KEEPING the label: a false "manual" costs a download name that
 * doesn't carry the account, a false "generated" destroys information the team
 * entered by hand and cannot get back.
 */
export function isSystemGeneratedLabel(params: {
  doc: AssignableDocument;
  doc_label: string;
  client_name: string | null;
  /** The group the document is filed under right now, if we could resolve it. */
  current_group: DocumentGroup | null;
}): boolean {
  const { doc, doc_label, client_name, current_group } = params;

  if (doc.metadata?.label_source === "manual") return false;

  const current = (doc.custom_label ?? "").trim();
  // Never renamed / never labelled — nothing to protect.
  if (!current) return true;

  const period = getDocumentPeriod(doc);
  const candidates = new Set<string>();
  for (const group of [current_group, null]) {
    for (const p of [period, null]) {
      candidates.add(buildGroupedDisplayLabel({ doc_label, client_name, group, period: p }));
    }
  }
  // Two more shapes this codebase has written: the label with no client name at
  // all, and the client-upload path's literal "Client" fallback for a vault
  // whose name hadn't loaded yet (see the insert in components/vault.tsx).
  for (const fallback of [null, "Client"]) {
    for (const group of [current_group, null]) {
      for (const p of [period, null]) {
        candidates.add(
          buildGroupedDisplayLabel({ doc_label, client_name: fallback, group, period: p })
        );
      }
    }
  }

  return candidates.has(current);
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
    documents: AssignableDocument[];
    group: DocumentGroup | null;
    label_by_code: Map<string, string>;
    client_name: string | null;
    /**
     * Groups the documents are filed under RIGHT NOW, so their current label can
     * be reconstructed and recognised as ours. Omitting it doesn't break
     * anything — it only makes the check stricter, so an already-grouped
     * document's generated label reads as hand-typed and is left alone.
     *
     * On the group-rename path this must hold the group as it was BEFORE the
     * rename; the documents still carry the old name in their labels.
     */
    current_groups?: DocumentGroup[];
  }
): Promise<GroupAssignmentResult> {
  const { documents, group, label_by_code, client_name } = params;
  const skipped: { id: string; reason: string }[] = [];

  if (documents.length === 0) return { updated: 0, skipped, preserved_labels: 0 };

  const groups_by_id = new Map(
    (params.current_groups ?? []).map((g) => [g.id, g])
  );

  // Bucket by the label each document will end up with. One UPDATE per document
  // would be 133 sequential round trips on a real file; documents only differ in
  // label when a period was parsed out of the original filename, which is the
  // minority, so this usually collapses to one or two queries.
  const ids_by_label = new Map<string, string[]>();
  // Documents whose name a person chose. They still MOVE — the group is what
  // was asked for — they just keep what they are called.
  const keep_label_ids: string[] = [];

  for (const doc of documents) {
    const code = (doc.doc_code ?? doc.category ?? "") as string;
    const doc_label = label_by_code.get(code) || code;

    const generated = isSystemGeneratedLabel({
      doc,
      doc_label,
      client_name,
      current_group: doc.document_group_id
        ? groups_by_id.get(doc.document_group_id) ?? null
        : null,
    });

    if (!generated) {
      keep_label_ids.push(doc.id);
      continue;
    }

    const custom_label = buildGroupedDisplayLabel({
      doc_label,
      client_name,
      group,
      period: getDocumentPeriod(doc),
    });
    const bucket = ids_by_label.get(custom_label);
    if (bucket) bucket.push(doc.id);
    else ids_by_label.set(custom_label, [doc.id]);
  }

  let updated = 0;
  let preserved_labels = 0;

  const run = async (ids: string[], patch: Record<string, unknown>, is_preserved: boolean) => {
    for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + CHUNK_SIZE);

      const { data, error } = await supabase
        .from("user_documents")
        .update(patch)
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
      if (is_preserved) preserved_labels += written.size;
      for (const id of chunk) {
        if (!written.has(id)) skipped.push({ id, reason: "not_permitted" });
      }
    }
  };

  for (const [custom_label, ids] of ids_by_label) {
    await run(ids, { document_group_id: group?.id ?? null, custom_label }, false);
  }
  // custom_label deliberately absent from this patch.
  await run(keep_label_ids, { document_group_id: group?.id ?? null }, true);

  return { updated, skipped, preserved_labels };
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

/**
 * Record a hand-typed document name.
 *
 * `custom_label` is shared by the Rename action and the generated group label,
 * so the only way to know which wrote it is to say so. Stamping
 * `metadata.label_source = 'manual'` makes every future rename unambiguous to
 * isSystemGeneratedLabel, which otherwise has to infer it by reconstruction.
 *
 * Read-modify-write because PostgREST replaces a jsonb column wholesale — a
 * bare `{ metadata: { label_source } }` would drop original_file_name and with
 * it the document's only period hint.
 *
 * Best-effort by design: the rename itself is the thing the user asked for, and
 * a failure here degrades to the reconstruction path, not to a failed rename.
 */
export async function markLabelAsManual(
  supabase: SupabaseClient,
  document_id: string
): Promise<void> {
  try {
    const { data } = await supabase
      .from("user_documents")
      .select("metadata")
      .eq("id", document_id)
      .maybeSingle();

    const metadata = { ...((data?.metadata as Record<string, unknown>) ?? {}), label_source: "manual" };
    await supabase.from("user_documents").update({ metadata }).eq("id", document_id);
  } catch (err) {
    console.error("markLabelAsManual failed (non-fatal):", err);
  }
}
