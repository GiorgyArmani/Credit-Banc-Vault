// src/lib/lender-api/rules.ts
//
// Pure decisions of the lender-API engine, separated from the I/O in
// submissions.ts so each rule is unit tested: when a send may start, what a
// lender status does to the assignment, how per-file upload results roll up.

import type { Gap, NormalizedStatus, OutboundDocumentResult, Picks } from "./types";

export type SubmissionStatus = "sending" | "lead_created" | "sent" | "partial" | "failed";

/** How long a submission may sit in an in-flight status before it's treated as abandoned. */
export const STALE_IN_FLIGHT_MS = 10 * 60 * 1000;

/**
 * markAssignmentSubmitted stamps submitted_at moments after the submission row
 * is inserted; anything later than this means the file was re-submitted by hand.
 */
export const RESUBMIT_ALLOWANCE_MS = 60_000;

export type SubmissionErrorKind = "uncertain" | "flip_failed" | "other";

/** An in-flight submission past the stale window: its worker most likely died. */
export function isStaleInFlight(
  latest: { status: string; updated_at: string } | null,
  now: number = Date.now()
): boolean {
  return (
    !!latest &&
    (latest.status === "sending" || latest.status === "lead_created") &&
    now - Date.parse(latest.updated_at) > STALE_IN_FLIGHT_MS
  );
}

/** Removed by an admin, or never approved by the matching engine: nothing may go to this lender. */
export function isAssignmentRemoved(assignment: { decision: string; admin_review: string }): boolean {
  return assignment.admin_review === "rejected" || assignment.decision !== "approved";
}

/**
 * Only a 4xx is a clean rejection. No status or 0 (network, timeout), a 5xx,
 * or a 2xx without a lead id all leave us unable to tell whether the lender
 * created the application.
 */
export function isUncertainCreateFailure(status: number | undefined): boolean {
  if (status === undefined) return true;
  return !(status >= 400 && status < 500);
}

/** Reads the kind of a stored submission error from the prefixes submissions.ts writes. */
export function submissionErrorKind(error: string | null | undefined): SubmissionErrorKind | null {
  if (error === null || error === undefined) return null;
  if (error.startsWith("Uncertain:") || error.startsWith("Timed out")) return "uncertain";
  if (error.startsWith("Sent to ")) return "flip_failed";
  return "other";
}

/** A new send after an attempt that may have reached the lender needs UW's explicit confirmation. */
export function needsResendConfirmation(
  latest: { status: string; error: string | null; updated_at?: string } | null,
  now: number = Date.now()
): boolean {
  if (!latest) return false;
  if (latest.status === "failed" && submissionErrorKind(latest.error) === "uncertain") return true;
  // A "sending" row stuck past the stale window: createApplication's write-back
  // never completed (crash, timeout) — the lender may already hold this deal,
  // same as canStartSubmission's supersede case, so a resend needs confirmation too.
  if (latest.status === "sending" && latest.updated_at && now - Date.parse(latest.updated_at) > STALE_IN_FLIGHT_MS) {
    return true;
  }
  return false;
}

/** The assignment was submitted again (by hand) after this API submission was created. */
export function isResubmittedSinceSend(submittedAt: string | null | undefined, submissionCreatedAt: string): boolean {
  if (!submittedAt) return false;
  return Date.parse(submittedAt) > Date.parse(submissionCreatedAt) + RESUBMIT_ALLOWANCE_MS;
}

/**
 * The lead exists but the assignment was never flipped, and the original
 * document upload may still be running: Retry must only finish the flip.
 */
export function shouldOnlyFlip(
  assignmentStatus: string,
  latest: { status: string; external_id: string | null; updated_at: string } | null,
  now: number = Date.now()
): boolean {
  return (
    assignmentStatus === "pending" &&
    !!latest?.external_id &&
    latest.status === "lead_created" &&
    !isStaleInFlight(latest, now)
  );
}

export function nextAttemptNo(existing: Array<{ attempt_no: number }>): number {
  return existing.reduce((max, s) => Math.max(max, s.attempt_no), 0) + 1;
}

export function referenceIdFor(assignmentId: string, attemptNo: number): string {
  return `cb-${assignmentId}-${attemptNo}`;
}

export function canStartSubmission(
  assignmentStatus: string,
  latest: { status: SubmissionStatus; updated_at: string } | null,
  now: number = Date.now()
): { ok: true; supersede: boolean } | { ok: false; httpStatus: number; error: string } {
  if (assignmentStatus !== "pending") {
    return { ok: false, httpStatus: 409, error: `Assignment status is already "${assignmentStatus}".` };
  }
  if (!latest) return { ok: true, supersede: false };
  // A failed attempt never reached (or was rejected by) the lender: safe to retry.
  if (latest.status === "failed") return { ok: true, supersede: false };
  // A "sending" row stuck past the stale window means createApplication's write-back
  // never completed (crash, timeout) — treat it as abandoned and supersede it.
  if (latest.status === "sending" && now - Date.parse(latest.updated_at) > STALE_IN_FLIGHT_MS) {
    return { ok: true, supersede: true };
  }
  // Anything else means the lender has — or is receiving — this deal. A second
  // application would duplicate it on their side.
  return { ok: false, httpStatus: 409, error: "This deal was already sent to the lender by API." };
}

/**
 * Guards the "retry failed files" action: only when there's something stuck
 * that legitimately needs a nudge, never while an upload may still be running.
 */
export function canRetrySubmission(
  assignmentStatus: string,
  latest: { status: SubmissionStatus; external_id: string | null; updated_at: string } | null,
  now: number = Date.now()
): { ok: true } | { ok: false; httpStatus: number; error: string } {
  if (!latest || !latest.external_id) {
    return { ok: false, httpStatus: 409, error: "Nothing to retry for this assignment." };
  }

  const staleInFlight = isStaleInFlight(latest, now);

  if (latest.status === "partial" || assignmentStatus === "pending" || staleInFlight) {
    return { ok: true };
  }

  if (latest.status === "sent") {
    return { ok: false, httpStatus: 409, error: "Nothing to retry for this assignment." };
  }

  return { ok: false, httpStatus: 409, error: "Documents are still uploading — try again in a few minutes." };
}

export type StatusAction =
  | { type: "verdict"; status: "approved_by_lender" | "declined_by_lender"; note: string }
  | { type: "needs_info"; note: string }
  | { type: "none" };

export function decideStatusAction(
  assignmentStatus: string,
  status: NormalizedStatus,
  opts: { statusChanged: boolean; resubmittedSinceSend: boolean }
): StatusAction {
  // Only a file still waiting on the lender is touched: never overwrite a
  // verdict UW recorded by hand, never reopen a funded deal.
  if (assignmentStatus !== "submitted") return { type: "none" };
  // Re-submitted by hand after this send: this lead's status (often the old
  // verdict) says nothing about the new submission.
  if (opts.resubmittedSinceSend) return { type: "none" };

  switch (status.kind) {
    case "approved":
      return { type: "verdict", status: "approved_by_lender", note: status.note };
    case "declined":
      return { type: "verdict", status: "declined_by_lender", note: status.note };
    case "needs_info":
      // Webhooks repeat; only notify on a real change.
      return opts.statusChanged ? { type: "needs_info", note: status.note } : { type: "none" };
    default:
      return { type: "none" };
  }
}

export function mergeAttachmentResults(
  prev: OutboundDocumentResult[],
  next: OutboundDocumentResult[]
): OutboundDocumentResult[] {
  const byId = new Map(prev.map((r) => [r.documentId, r]));
  const order = prev.map((r) => r.documentId);
  for (const r of next) {
    if (!byId.has(r.documentId)) order.push(r.documentId);
    byId.set(r.documentId, r);
  }
  return order.map((id) => byId.get(id)!);
}

export function pendingDocumentIds(documentIds: string[], results: OutboundDocumentResult[]): string[] {
  // A file that can no longer be sent (deleted, no longer allowed) is settled:
  // retrying it can never succeed.
  const settled = new Set(results.filter((r) => r.accepted || r.unavailable).map((r) => r.documentId));
  return documentIds.filter((id) => !settled.has(id));
}

export function submissionStatusFromResults(
  documentIds: string[],
  results: OutboundDocumentResult[]
): "sent" | "partial" {
  return pendingDocumentIds(documentIds, results).length === 0 ? "sent" : "partial";
}

export function normalizePicks(input: unknown): Picks | null {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const out: Picks = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    // Reject reserved keys that could pollute prototypes
    if (key === "__proto__" || key === "constructor" || key === "prototype") return null;
    if (key.length > 64) return null;
    if (value === null) {
      out[key] = null;
    } else if (typeof value === "string" && value.length <= 200) {
      out[key] = value;
    } else {
      return null;
    }
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeDocumentIds(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > 500) return null;
  if (!input.every((id) => typeof id === "string" && UUID_RE.test(id))) return null;
  return Array.from(new Set(input as string[]));
}

export function hasBlockingGaps(gaps: Gap[]): boolean {
  return gaps.length > 0;
}
