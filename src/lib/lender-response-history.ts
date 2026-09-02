// src/lib/lender-response-history.ts
//
// The append-only ledger of trips out to a lender.
//
// `client_lender_assignments` answers "where does this lender stand right now".
// It cannot answer "we went back to them — what did they say last time, and what
// changed?", because a re-submission nulls `response_notes` and the outgoing
// text was only ever archived as a free-text internal note. This module owns the
// other half.
//
// ONE ROW PER ATTEMPT. An attempt opens when the file goes out (submit, or
// re-submit) and closes when the lender answers. `status`/`responded_at` NULL
// means it is still out — a real state, not a missing value.
//
// EVERY WRITE IS BEST-EFFORT AND NON-THROWING. The ledger is a record of what
// underwriting did; failing to append to it must never block them from
// recording that a lender answered. A dropped ledger row is a gap in the story,
// which is recoverable. A 500 on the verdict write is a lender response that
// never gets recorded at all, which is not.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Verdicts an attempt can close at. Mirrors the table's CHECK. */
export type AttemptStatus = "approved_by_lender" | "declined_by_lender" | "funded";

export interface LenderResponseAttempt {
  id: string;
  assignment_id: string;
  attempt_no: number;
  status: AttemptStatus | null;
  response_notes: string | null;
  resubmit_reason: string | null;
  submitted_at: string | null;
  responded_at: string | null;
  recorded_by_name: string | null;
  created_at: string;
}

const COLUMNS =
  "id, assignment_id, attempt_no, status, response_notes, resubmit_reason, submitted_at, responded_at, recorded_by_name, created_at";

/** Display name for the ledger, snapshotted so it survives the user being removed. */
export async function resolveRecorderName(
  db: SupabaseClient,
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null;
  const { data } = await db
    .from("users")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  return `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() || null;
}

/** The attempt currently in play — highest attempt_no. Null before the first send. */
export async function latestAttempt(
  db: SupabaseClient,
  assignmentId: string
): Promise<LenderResponseAttempt | null> {
  const { data, error } = await db
    .from("lender_assignment_responses")
    .select(COLUMNS)
    .eq("assignment_id", assignmentId)
    .order("attempt_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("latestAttempt error:", error);
    return null;
  }
  return (data ?? null) as LenderResponseAttempt | null;
}

/** Whole ledger for one assignment, newest attempt first. */
export async function listAttempts(
  db: SupabaseClient,
  assignmentId: string
): Promise<LenderResponseAttempt[]> {
  const { data, error } = await db
    .from("lender_assignment_responses")
    .select(COLUMNS)
    .eq("assignment_id", assignmentId)
    .order("attempt_no", { ascending: false });
  if (error) {
    console.error("listAttempts error:", error);
    return [];
  }
  return (data ?? []) as LenderResponseAttempt[];
}

/**
 * Open a new attempt: the file just went out to this lender.
 *
 * Idempotent per attempt number via the unique index — a double-clicked
 * "Mark as Submitted" resolves to one attempt, not two. `ignoreDuplicates`
 * makes the second write a silent no-op rather than a 23505 the caller has to
 * interpret.
 *
 * Returns the attempt number opened, or null if nothing was written.
 */
export async function openAttempt(
  db: SupabaseClient,
  args: {
    assignmentId: string;
    submittedAt: string;
    resubmitReason?: string | null;
    recordedBy?: string | null;
    recordedByName?: string | null;
  }
): Promise<number | null> {
  try {
    const current = await latestAttempt(db, args.assignmentId);
    const attempt_no = (current?.attempt_no ?? 0) + 1;

    const { error } = await db
      .from("lender_assignment_responses")
      .upsert(
        {
          assignment_id: args.assignmentId,
          attempt_no,
          submitted_at: args.submittedAt,
          resubmit_reason: args.resubmitReason?.trim() || null,
          recorded_by: args.recordedBy ?? null,
          recorded_by_name: args.recordedByName ?? null,
        },
        { onConflict: "assignment_id,attempt_no", ignoreDuplicates: true }
      );

    if (error) {
      console.error("openAttempt error:", error);
      return null;
    }
    return attempt_no;
  } catch (err) {
    console.error("openAttempt threw (non-fatal):", err);
    return null;
  }
}

/**
 * Close the attempt in play: the lender answered.
 *
 * Writes onto the newest attempt rather than inserting, so recording a verdict
 * and then correcting it (declined → approved, a misclick fix) revises one
 * attempt instead of inventing a second trip that never happened. If no attempt
 * is open — an assignment worked before this ledger existed, or a submit whose
 * ledger write dropped — one is opened first so the answer is never lost.
 */
export async function closeAttempt(
  db: SupabaseClient,
  args: {
    assignmentId: string;
    status: AttemptStatus;
    responseNotes?: string | null;
    respondedAt: string;
    recordedBy?: string | null;
    recordedByName?: string | null;
  }
): Promise<boolean> {
  try {
    let current = await latestAttempt(db, args.assignmentId);

    if (!current) {
      await openAttempt(db, {
        assignmentId: args.assignmentId,
        submittedAt: args.respondedAt,
        recordedBy: args.recordedBy,
        recordedByName: args.recordedByName,
      });
      current = await latestAttempt(db, args.assignmentId);
      if (!current) return false;
    }

    const { error } = await db
      .from("lender_assignment_responses")
      .update({
        status: args.status,
        // Only overwrite the note when one was supplied: the verdict and the
        // typed reason arrive from two different routes, and the verdict write
        // must not blank a note that was recorded first.
        ...(args.responseNotes === undefined ? {} : { response_notes: args.responseNotes }),
        responded_at: args.respondedAt,
        recorded_by: args.recordedBy ?? null,
        recorded_by_name: args.recordedByName ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id);

    if (error) {
      console.error("closeAttempt error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("closeAttempt threw (non-fatal):", err);
    return false;
  }
}

/**
 * Record the typed response note against the attempt in play.
 *
 * The note is typed AFTER the verdict, in a separate request, so it lands here
 * rather than in closeAttempt. No-ops when there is no attempt: a note with no
 * trip to attach it to is a pre-ledger row, and the assignment column still
 * holds it.
 */
export async function recordAttemptNotes(
  db: SupabaseClient,
  assignmentId: string,
  responseNotes: string | null
): Promise<boolean> {
  try {
    const current = await latestAttempt(db, assignmentId);
    if (!current) return false;

    const { error } = await db
      .from("lender_assignment_responses")
      .update({ response_notes: responseNotes, updated_at: new Date().toISOString() })
      .eq("id", current.id);

    if (error) {
      console.error("recordAttemptNotes error:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("recordAttemptNotes threw (non-fatal):", err);
    return false;
  }
}
