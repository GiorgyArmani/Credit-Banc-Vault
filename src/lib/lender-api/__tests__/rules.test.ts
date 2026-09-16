import { describe, expect, it } from "vitest";
import {
  canRetrySubmission,
  canStartSubmission,
  decideStatusAction,
  hasBlockingGaps,
  isAssignmentRemoved,
  isResubmittedSinceSend,
  isStaleInFlight,
  isUncertainCreateFailure,
  mergeAttachmentResults,
  needsResendConfirmation,
  nextAttemptNo,
  normalizeDocumentIds,
  normalizePicks,
  pendingDocumentIds,
  referenceIdFor,
  shouldOnlyFlip,
  STALE_IN_FLIGHT_MS,
  submissionErrorKind,
  submissionStatusFromResults,
} from "@/lib/lender-api/rules";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("attempts", () => {
  it("numbers attempts from 1", () => {
    expect(nextAttemptNo([])).toBe(1);
    expect(nextAttemptNo([{ attempt_no: 2 }, { attempt_no: 1 }])).toBe(3);
  });

  it("builds reference ids", () => {
    expect(referenceIdFor("abc", 2)).toBe("cb-abc-2");
  });
});

describe("canStartSubmission", () => {
  const NOW = 1_700_000_000_000;
  const recent = new Date(NOW - 1000).toISOString();
  const stale = new Date(NOW - STALE_IN_FLIGHT_MS - 1000).toISOString();

  it("allows a pending assignment with no prior send", () => {
    expect(canStartSubmission("pending", null, NOW)).toEqual({ ok: true, supersede: false });
  });

  it("allows a retry after a failed send", () => {
    expect(canStartSubmission("pending", { status: "failed", updated_at: recent }, NOW)).toEqual({
      ok: true,
      supersede: false,
    });
  });

  it("supersedes a stale sending attempt", () => {
    expect(canStartSubmission("pending", { status: "sending", updated_at: stale }, NOW)).toEqual({
      ok: true,
      supersede: true,
    });
  });

  it("refuses a fresh sending attempt (not yet stale)", () => {
    expect(canStartSubmission("pending", { status: "sending", updated_at: recent }, NOW)).toEqual({
      ok: false,
      httpStatus: 409,
      error: "This deal was already sent to the lender by API.",
    });
  });

  it.each(["lead_created", "sent", "partial"] as const)("refuses when the latest send is %s", (status) => {
    expect(canStartSubmission("pending", { status, updated_at: recent }, NOW)).toEqual({
      ok: false,
      httpStatus: 409,
      error: "This deal was already sent to the lender by API.",
    });
  });

  it("refuses a non-pending assignment", () => {
    expect(canStartSubmission("submitted", null, NOW)).toEqual({
      ok: false,
      httpStatus: 409,
      error: 'Assignment status is already "submitted".',
    });
  });
});

describe("canRetrySubmission", () => {
  const NOW = 1_700_000_000_000;
  const recent = new Date(NOW - 1000).toISOString();
  const stale = new Date(NOW - STALE_IN_FLIGHT_MS - 1000).toISOString();
  const EXT = "ext-1";

  it("refuses when there is no prior submission", () => {
    expect(canRetrySubmission("submitted", null, NOW)).toEqual({
      ok: false,
      httpStatus: 409,
      error: "Nothing to retry for this assignment.",
    });
  });

  it("refuses when the submission never reached the lender (no external_id)", () => {
    expect(
      canRetrySubmission("pending", { status: "failed", external_id: null, updated_at: recent }, NOW)
    ).toEqual({
      ok: false,
      httpStatus: 409,
      error: "Nothing to retry for this assignment.",
    });
  });

  it("allows retrying a partial send regardless of assignment status", () => {
    expect(
      canRetrySubmission("submitted", { status: "partial", external_id: EXT, updated_at: recent }, NOW)
    ).toEqual({ ok: true });
  });

  it("allows retrying when the assignment flip never completed (assignment still pending)", () => {
    expect(
      canRetrySubmission("pending", { status: "sending", external_id: EXT, updated_at: recent }, NOW)
    ).toEqual({ ok: true });
  });

  it("allows retrying a stale in-flight send", () => {
    expect(
      canRetrySubmission("submitted", { status: "lead_created", external_id: EXT, updated_at: stale }, NOW)
    ).toEqual({ ok: true });
    expect(
      canRetrySubmission("submitted", { status: "sending", external_id: EXT, updated_at: stale }, NOW)
    ).toEqual({ ok: true });
  });

  it("refuses a fresh in-flight send", () => {
    expect(
      canRetrySubmission("submitted", { status: "lead_created", external_id: EXT, updated_at: recent }, NOW)
    ).toEqual({
      ok: false,
      httpStatus: 409,
      error: "Documents are still uploading — try again in a few minutes.",
    });
    expect(
      canRetrySubmission("submitted", { status: "sending", external_id: EXT, updated_at: recent }, NOW)
    ).toEqual({
      ok: false,
      httpStatus: 409,
      error: "Documents are still uploading — try again in a few minutes.",
    });
  });

  it("refuses a completed send on a non-pending assignment", () => {
    expect(
      canRetrySubmission("submitted", { status: "sent", external_id: EXT, updated_at: recent }, NOW)
    ).toEqual({
      ok: false,
      httpStatus: 409,
      error: "Nothing to retry for this assignment.",
    });
  });
});

describe("decideStatusAction", () => {
  const approved = { kind: "approved", stage: "Approval Sent", note: "terms" } as const;
  const declined = { kind: "declined", stage: "Declined", note: "why" } as const;
  const needs = { kind: "needs_info", stage: "File Missing Info", note: "stmts" } as const;
  const working = { kind: "in_progress", stage: "Working" } as const;

  const changed = { statusChanged: true, resubmittedSinceSend: false };
  const unchanged = { statusChanged: false, resubmittedSinceSend: false };

  it("records verdicts only while submitted", () => {
    expect(decideStatusAction("submitted", approved, unchanged)).toEqual({
      type: "verdict",
      status: "approved_by_lender",
      note: "terms",
    });
    expect(decideStatusAction("submitted", declined, changed)).toEqual({
      type: "verdict",
      status: "declined_by_lender",
      note: "why",
    });
    expect(decideStatusAction("declined_by_lender", approved, changed)).toEqual({ type: "none" });
    expect(decideStatusAction("funded", declined, changed)).toEqual({ type: "none" });
  });

  it("notifies needs-info only when the status actually changed", () => {
    expect(decideStatusAction("submitted", needs, changed)).toEqual({ type: "needs_info", note: "stmts" });
    expect(decideStatusAction("submitted", needs, unchanged)).toEqual({ type: "none" });
    expect(decideStatusAction("approved_by_lender", needs, changed)).toEqual({ type: "none" });
  });

  it("does nothing for in-progress stages", () => {
    expect(decideStatusAction("submitted", working, changed)).toEqual({ type: "none" });
  });

  it.each([approved, declined, needs, working])(
    "applies nothing once the file was manually re-submitted after this send (%j)",
    (status) => {
      expect(decideStatusAction("submitted", status, { statusChanged: true, resubmittedSinceSend: true })).toEqual({
        type: "none",
      });
    }
  );
});

describe("isResubmittedSinceSend", () => {
  const created = "2026-09-15T12:00:00.000Z";

  it("is false when the assignment has no submitted_at", () => {
    expect(isResubmittedSinceSend(null, created)).toBe(false);
  });

  it("allows the 60 s between the row insert and the assignment flip", () => {
    expect(isResubmittedSinceSend("2026-09-15T12:00:30.000Z", created)).toBe(false);
    expect(isResubmittedSinceSend("2026-09-15T12:01:00.000Z", created)).toBe(false);
    expect(isResubmittedSinceSend("2026-09-15T11:59:00.000Z", created)).toBe(false);
  });

  it("is true when submitted_at is more than 60 s after the send", () => {
    expect(isResubmittedSinceSend("2026-09-15T12:01:00.001Z", created)).toBe(true);
    expect(isResubmittedSinceSend("2026-09-16T09:00:00.000Z", created)).toBe(true);
  });
});

describe("isUncertainCreateFailure", () => {
  it.each([undefined, 0, 200, 201, 299, 500, 502, 504])("status %s is uncertain", (status) => {
    expect(isUncertainCreateFailure(status)).toBe(true);
  });

  it.each([400, 401, 422, 499])("status %s is a clean rejection", (status) => {
    expect(isUncertainCreateFailure(status)).toBe(false);
  });
});

describe("submissionErrorKind / needsResendConfirmation", () => {
  const UNCERTAIN = "Uncertain: the lender may have received this application (reference cb-a-1).";
  const TIMED_OUT = "Timed out before the lender answered (reference cb-a-1).";
  const FLIP = "Sent to Forward Financing, but the assignment could not be marked submitted (x). Use Retry.";

  const NOW = 1_700_000_000_000;
  const recent = new Date(NOW - 1000).toISOString();
  const stale = new Date(NOW - STALE_IN_FLIGHT_MS - 1000).toISOString();

  it("classifies submission errors", () => {
    expect(submissionErrorKind(null)).toBeNull();
    expect(submissionErrorKind(UNCERTAIN)).toBe("uncertain");
    expect(submissionErrorKind(TIMED_OUT)).toBe("uncertain");
    expect(submissionErrorKind(FLIP)).toBe("flip_failed");
    expect(submissionErrorKind("The lender rejected the application.")).toBe("other");
  });

  it("requires confirmation only after an uncertain failed attempt", () => {
    expect(needsResendConfirmation(null, NOW)).toBe(false);
    expect(needsResendConfirmation({ status: "failed", error: UNCERTAIN, updated_at: recent }, NOW)).toBe(true);
    expect(needsResendConfirmation({ status: "failed", error: TIMED_OUT, updated_at: recent }, NOW)).toBe(true);
    expect(
      needsResendConfirmation({ status: "failed", error: "The lender rejected the application.", updated_at: recent }, NOW)
    ).toBe(false);
    expect(needsResendConfirmation({ status: "failed", error: null, updated_at: recent }, NOW)).toBe(false);
    expect(needsResendConfirmation({ status: "sent", error: UNCERTAIN, updated_at: recent }, NOW)).toBe(false);
  });

  it("requires confirmation for a 'sending' row stuck past the stale window", () => {
    expect(needsResendConfirmation({ status: "sending", error: null, updated_at: stale }, NOW)).toBe(true);
  });

  it("does not require confirmation for a fresh 'sending' row (still legitimately in flight)", () => {
    expect(needsResendConfirmation({ status: "sending", error: null, updated_at: recent }, NOW)).toBe(false);
  });
});

describe("isStaleInFlight / shouldOnlyFlip / isAssignmentRemoved", () => {
  const NOW = 1_700_000_000_000;
  const recent = new Date(NOW - 1000).toISOString();
  const stale = new Date(NOW - STALE_IN_FLIGHT_MS - 1000).toISOString();

  it("isStaleInFlight is true only for an in-flight row past the stale window", () => {
    expect(isStaleInFlight(null, NOW)).toBe(false);
    expect(isStaleInFlight({ status: "lead_created", updated_at: stale }, NOW)).toBe(true);
    expect(isStaleInFlight({ status: "sending", updated_at: stale }, NOW)).toBe(true);
    expect(isStaleInFlight({ status: "lead_created", updated_at: recent }, NOW)).toBe(false);
    expect(isStaleInFlight({ status: "partial", updated_at: stale }, NOW)).toBe(false);
  });

  it("shouldOnlyFlip while the original upload may still be running", () => {
    expect(shouldOnlyFlip("pending", { status: "lead_created", external_id: "e", updated_at: recent }, NOW)).toBe(true);
    expect(shouldOnlyFlip("pending", { status: "lead_created", external_id: "e", updated_at: stale }, NOW)).toBe(false);
    expect(shouldOnlyFlip("submitted", { status: "lead_created", external_id: "e", updated_at: recent }, NOW)).toBe(false);
    expect(shouldOnlyFlip("pending", { status: "partial", external_id: "e", updated_at: recent }, NOW)).toBe(false);
    expect(shouldOnlyFlip("pending", { status: "lead_created", external_id: null, updated_at: recent }, NOW)).toBe(false);
    expect(shouldOnlyFlip("pending", null, NOW)).toBe(false);
  });

  it("isAssignmentRemoved when admin removed it or the engine did not approve it", () => {
    expect(isAssignmentRemoved({ decision: "approved", admin_review: "pending" })).toBe(false);
    expect(isAssignmentRemoved({ decision: "approved", admin_review: "approved" })).toBe(false);
    expect(isAssignmentRemoved({ decision: "approved", admin_review: "rejected" })).toBe(true);
    expect(isAssignmentRemoved({ decision: "rejected", admin_review: "pending" })).toBe(true);
    expect(isAssignmentRemoved({ decision: "pending", admin_review: "pending" })).toBe(true);
  });
});

describe("attachment results", () => {
  const r = (documentId: string, accepted: boolean) => ({ documentId, filename: `${documentId}.pdf`, stamped: true, accepted });

  it("later results replace earlier ones for the same document", () => {
    expect(mergeAttachmentResults([r("a", false), r("b", true)], [r("a", true), r("c", false)])).toEqual([
      r("a", true),
      r("b", true),
      r("c", false),
    ]);
  });

  it("is sent only when every selected document was accepted", () => {
    expect(submissionStatusFromResults(["a", "b"], [r("a", true), r("b", true)])).toBe("sent");
    expect(submissionStatusFromResults(["a", "b"], [r("a", true)])).toBe("partial");
    expect(submissionStatusFromResults(["a"], [r("a", false)])).toBe("partial");
    expect(submissionStatusFromResults([], [])).toBe("sent");
  });

  it("lists documents never attempted or not accepted", () => {
    expect(pendingDocumentIds(["a", "b", "c"], [r("a", true), r("b", false)])).toEqual(["b", "c"]);
  });

  it("treats documents that are no longer available as settled", () => {
    const gone = { documentId: "b", filename: "(unavailable)", stamped: false, accepted: false, unavailable: true, error: "No longer available" };
    expect(pendingDocumentIds(["a", "b", "c"], [r("a", true), gone])).toEqual(["c"]);
    expect(submissionStatusFromResults(["a", "b"], [r("a", true), gone])).toBe("sent");
    expect(submissionStatusFromResults(["a", "b", "c"], [r("a", true), gone])).toBe("partial");
  });
});

describe("input normalization", () => {
  it("normalizePicks keeps string/null values and rejects junk", () => {
    expect(normalizePicks({ industry_name: "Retail", loan_use: null })).toEqual({ industry_name: "Retail", loan_use: null });
    expect(normalizePicks(undefined)).toEqual({});
    expect(normalizePicks({ x: 5 })).toBeNull();
    expect(normalizePicks([])).toBeNull();
    expect(normalizePicks({ x: "a".repeat(201) })).toBeNull();
    expect(normalizePicks(JSON.parse('{"__proto__": "x"}'))).toBeNull();
    expect(normalizePicks({ constructor: "x" })).toBeNull();
  });

  it("normalizeDocumentIds dedupes uuids and rejects junk", () => {
    expect(normalizeDocumentIds([UUID_A, UUID_B, UUID_A])).toEqual([UUID_A, UUID_B]);
    expect(normalizeDocumentIds([])).toEqual([]);
    expect(normalizeDocumentIds(["not-a-uuid"])).toBeNull();
    expect(normalizeDocumentIds("x")).toBeNull();
  });

  it("hasBlockingGaps", () => {
    expect(hasBlockingGaps([])).toBe(false);
    expect(hasBlockingGaps([{ field: "ssn", label: "SSN", kind: "missing" }])).toBe(true);
  });
});
