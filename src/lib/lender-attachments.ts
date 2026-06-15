// src/lib/lender-attachments.ts
//
// Service-role helpers for lender response attachments — the screenshots UW
// pins to a client_lender_assignments row to evidence the lender's reply
// (decline notice, approval + requested docs, offer terms). Files live in the
// existing private user-documents bucket under a per-assignment prefix; the
// table is RLS-locked with no policies, so it is reached only here.

import { createAdminClient } from "@/lib/supabase/admin";

export const LENDER_ATTACH_BUCKET = "user-documents";
export const LENDER_ATTACH_PREFIX = "lender-responses";
// Short-lived view URLs, regenerated on every load.
export const LENDER_ATTACH_TTL_SECONDS = 60 * 60 * 2; // 2 hours

export interface LenderAttachmentRow {
  id: string;
  assignment_id: string;
  storage_path: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface LenderAttachmentView {
  id: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
  view_url: string;
}

/** Build the storage path for a new attachment on an assignment. */
export function buildLenderAttachmentPath(assignment_id: string, file_name: string): string {
  const ext = (file_name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 11);
  return `${LENDER_ATTACH_PREFIX}/${assignment_id}/${stamp}-${random}.${ext || "bin"}`;
}

/** Confirm the assignment exists (cheap guard before sign/register). */
export async function assignmentExists(assignment_id: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("client_lender_assignments")
    .select("id")
    .eq("id", assignment_id)
    .maybeSingle();
  return !!data;
}

export async function registerLenderAttachment(params: {
  assignment_id: string;
  storage_path: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
}): Promise<LenderAttachmentRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lender_assignment_attachments")
    .insert({
      assignment_id: params.assignment_id,
      storage_path: params.storage_path,
      file_name: params.file_name,
      file_type: params.file_type,
      file_size: params.file_size,
      uploaded_by: params.uploaded_by,
    })
    .select("*")
    .single();
  if (error) {
    console.error("registerLenderAttachment error:", error);
    return null;
  }
  return data as LenderAttachmentRow;
}

export async function listLenderAttachments(
  assignment_id: string
): Promise<LenderAttachmentView[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lender_assignment_attachments")
    .select("*")
    .eq("assignment_id", assignment_id)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("listLenderAttachments error:", error);
    return [];
  }

  const views: LenderAttachmentView[] = [];
  for (const a of (data ?? []) as LenderAttachmentRow[]) {
    const { data: signed } = await supabase.storage
      .from(LENDER_ATTACH_BUCKET)
      .createSignedUrl(a.storage_path, LENDER_ATTACH_TTL_SECONDS);
    if (!signed?.signedUrl) continue;
    views.push({
      id: a.id,
      file_name: a.file_name,
      file_type: a.file_type,
      file_size: a.file_size,
      created_at: a.created_at,
      view_url: signed.signedUrl,
    });
  }
  return views;
}

/** Delete an attachment row and its stored file. Returns false on lookup miss. */
export async function deleteLenderAttachment(
  assignment_id: string,
  attachment_id: string
): Promise<boolean> {
  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("lender_assignment_attachments")
    .select("id, storage_path, assignment_id")
    .eq("id", attachment_id)
    .eq("assignment_id", assignment_id)
    .maybeSingle();
  if (!row) return false;

  await supabase.storage.from(LENDER_ATTACH_BUCKET).remove([row.storage_path]);
  const { error } = await supabase
    .from("lender_assignment_attachments")
    .delete()
    .eq("id", attachment_id);
  if (error) {
    console.error("deleteLenderAttachment error:", error);
    return false;
  }
  return true;
}

/** Save the typed response note (offer/stips or decline reasons). */
export async function saveLenderResponseNotes(
  assignment_id: string,
  response_notes: string | null
): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("client_lender_assignments")
    .update({ response_notes, updated_at: new Date().toISOString() })
    .eq("id", assignment_id);
  if (error) {
    console.error("saveLenderResponseNotes error:", error);
    return false;
  }
  return true;
}

export async function getLenderResponseNotes(assignment_id: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("client_lender_assignments")
    .select("response_notes")
    .eq("id", assignment_id)
    .maybeSingle();
  return (data?.response_notes as string | null) ?? null;
}
