// src/lib/lender-attachments.ts
//
// Service-role helpers for lender response attachments — the screenshots UW
// pins to a client_lender_assignments row to evidence the lender's reply
// (decline notice, approval + requested docs, offer terms). Files live in the
// existing private user-documents bucket under a per-assignment prefix; the
// table is RLS-locked with no policies, so it is reached only here.

import { createAdminClient } from "@/lib/supabase/admin";
import { latestAttempt, recordAttemptNotes } from "@/lib/lender-response-history";

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
  /** Stamped once the file has been posted into the deal's Slack channel. */
  slack_posted_at?: string | null;
}

export interface LenderAttachmentView {
  id: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
  view_url: string;
  /** NULL until the file has been posted into the deal's Slack channel. */
  slack_posted_at: string | null;
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
  // Stamp the trip this evidence belongs to. A decline screenshot documents the
  // decline it arrived with; without this, re-submitting leaves the previous
  // attempt's screenshots sitting under the new response as though the new
  // answer produced them. NULL means "uploaded before attempts were tracked".
  const attempt = await latestAttempt(supabase, params.assignment_id);
  const { data, error } = await supabase
    .from("lender_assignment_attachments")
    .insert({
      assignment_id: params.assignment_id,
      attempt_no: attempt?.attempt_no ?? null,
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
      slack_posted_at: a.slack_posted_at ?? null,
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

/**
 * Save the typed response note (offer/stips or decline reasons).
 *
 * Written twice on purpose: onto the assignment, which is the current state
 * every existing surface reads, and onto the attempt in play, which is what
 * survives the next re-submission blanking the column.
 */
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
  // Best-effort: the note is already safely on the assignment row.
  await recordAttemptNotes(supabase, assignment_id, response_notes);
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

// ---------------------------------------------------------------------------
// Slack hand-off
// ---------------------------------------------------------------------------

/** Skip anything absurd for a screenshot — Slack takes it, the channel doesn't. */
const SLACK_MAX_BYTES = 25 * 1024 * 1024;
/** Never let one assignment dump more than this into a single Slack post. */
const SLACK_MAX_FILES = 10;

export interface ClaimedAttachment {
  id: string;
  file_name: string;
  file_type: string | null;
  bytes: Buffer;
}

/**
 * Atomically claims this assignment's not-yet-posted attachments and downloads
 * their bytes, ready to hand to Slack.
 *
 * The claim is the UPDATE itself: stamping `slack_posted_at` in the same
 * statement that selects the rows means two concurrent callers can never pick
 * up the same file, so a screenshot is posted exactly once even if a verdict
 * flip and a note save race each other. Callers that then FAIL to post must
 * call {@link releaseLenderAttachments} to hand the rows back.
 *
 * Returns [] on any error — including the column not existing yet, i.e. before
 * migration 20260828 is applied. Degrading to "post no images" is correct:
 * without the guard we cannot promise a file is posted only once.
 */
export async function claimUnpostedLenderAttachments(
  assignment_id: string
): Promise<ClaimedAttachment[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("lender_assignment_attachments")
    .update({ slack_posted_at: new Date().toISOString() })
    .eq("assignment_id", assignment_id)
    .is("slack_posted_at", null)
    .select("id, storage_path, file_name, file_type, file_size, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("claimUnpostedLenderAttachments error (skipping Slack images):", error);
    return [];
  }

  const rows = ((data ?? []) as LenderAttachmentRow[]).slice(0, SLACK_MAX_FILES);
  const claimed: ClaimedAttachment[] = [];
  const undeliverable: string[] = [];

  for (const row of rows) {
    if ((row.file_size ?? 0) > SLACK_MAX_BYTES) {
      undeliverable.push(row.id);
      continue;
    }
    const { data: blob, error: dl_error } = await supabase.storage
      .from(LENDER_ATTACH_BUCKET)
      .download(row.storage_path);
    if (dl_error || !blob) {
      console.error("claimUnpostedLenderAttachments download failed:", row.storage_path, dl_error);
      undeliverable.push(row.id);
      continue;
    }
    claimed.push({
      id: row.id,
      file_name: row.file_name || row.storage_path.split("/").pop() || "screenshot",
      file_type: row.file_type,
      bytes: Buffer.from(await blob.arrayBuffer()),
    });
  }

  // A file we could not read is not coming back on a retry either — leave it
  // claimed so it does not block every future post, but hand back anything we
  // skipped purely for the per-post cap.
  const over_cap = ((data ?? []) as LenderAttachmentRow[]).slice(SLACK_MAX_FILES).map(r => r.id);
  if (over_cap.length > 0) await releaseLenderAttachments(over_cap);
  if (undeliverable.length > 0) {
    console.warn(`Skipping ${undeliverable.length} lender attachment(s) Slack could not be given.`);
  }

  return claimed;
}

/** Hands claimed rows back to the unposted pool so a later post can retry them. */
export async function releaseLenderAttachments(attachment_ids: string[]): Promise<void> {
  if (attachment_ids.length === 0) return;
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("lender_assignment_attachments")
    .update({ slack_posted_at: null })
    .in("id", attachment_ids);
  if (error) console.error("releaseLenderAttachments error:", error);
}

/** How many screenshots are waiting to be sent to Slack. Best-effort → 0. */
export async function countUnpostedLenderAttachments(assignment_id: string): Promise<number> {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("lender_assignment_attachments")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignment_id)
    .is("slack_posted_at", null);
  if (error) return 0;
  return count ?? 0;
}
