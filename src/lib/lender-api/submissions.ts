// src/lib/lender-api/submissions.ts
//
// Orchestrates a lender-API send for ANY provider:
//   write-back → build → record attempt → create application (sync, so UW sees
//   validation errors) → mark assignment submitted → documents in after().
// And the return path: fetch status → record → verdict / needs-info.
// Every decision is a pure function in rules.ts; this file is the I/O around it.

import { after } from "next/server";
import { slackPostMessage } from "@/lib/slack-api";
import {
  markAssignmentSubmitted,
  recordLenderVerdict,
  submitGuard,
  type TransitionActor,
} from "@/lib/lender-assignment-transitions";
import type {
  LenderApiProvider,
  LenderApiSource,
  NormalizedStatus,
  OutboundDocument,
  OutboundDocumentResult,
} from "./types";
import { loadLenderApiSource, type AdminClient } from "./source";
import { listSubmittableDocuments, prepareOutboundDocuments } from "./documents";
import { applyVaultUpdates } from "./vault-updates";
import { normalizeVaultUpdates } from "./vault-fields";
import {
  canRetrySubmission,
  canStartSubmission,
  decideStatusAction,
  hasBlockingGaps,
  isAssignmentRemoved,
  isResubmittedSinceSend,
  isUncertainCreateFailure,
  mergeAttachmentResults,
  needsResendConfirmation,
  nextAttemptNo,
  normalizeDocumentIds,
  normalizePicks,
  pendingDocumentIds,
  referenceIdFor,
  shouldOnlyFlip,
  submissionErrorKind,
  submissionStatusFromResults,
  type SubmissionStatus,
} from "./rules";

export interface SubmissionRow {
  id: string;
  assignment_id: string;
  client_id: string;
  business_profile_id: string | null;
  funding_deal_id: string | null;
  provider: string;
  attempt_no: number;
  reference_id: string;
  external_id: string | null;
  status: SubmissionStatus;
  picks: Record<string, string | null>;
  document_ids: string[];
  attachments: OutboundDocumentResult[];
  field_errors: Record<string, string[]> | null;
  last_status: unknown;
  last_status_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EngineResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

const TABLE = "lender_api_submissions";
const SUBMISSION_COLUMNS =
  "id, assignment_id, client_id, business_profile_id, funding_deal_id, provider, attempt_no, reference_id, external_id, status, picks, document_ids, attachments, field_errors, last_status, last_status_at, error, created_at, updated_at";

export async function listSubmissions(admin: AdminClient, assignmentId: string): Promise<SubmissionRow[]> {
  const { data, error } = await admin
    .from(TABLE)
    .select(SUBMISSION_COLUMNS)
    .eq("assignment_id", assignmentId)
    .order("attempt_no", { ascending: false });
  if (error) console.error("listSubmissions error:", error.message);
  return (data ?? []) as unknown as SubmissionRow[];
}

export async function findSubmissionByExternalId(
  admin: AdminClient,
  providerId: string,
  externalId: string
): Promise<SubmissionRow | null> {
  const { data } = await admin
    .from(TABLE)
    .select(SUBMISSION_COLUMNS)
    .eq("provider", providerId)
    .eq("external_id", externalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as unknown as SubmissionRow | null;
}

/** Returns true on success, so callers on the critical path (e.g. recording a
 * lender's external_id) can detect and react to a write failure. */
async function updateSubmission(admin: AdminClient, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await admin
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("lender_api_submissions update error:", error.message);
    return false;
  }
  return true;
}

/** Clears one specific warning, only while it is still the row's error — a newer failure is kept. */
async function clearSubmissionError(admin: AdminClient, id: string, expectedError: string): Promise<void> {
  const { error } = await admin
    .from(TABLE)
    .update({ error: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("error", expectedError);
  if (error) console.error("lender_api_submissions clear error:", error.message);
}

export async function buildPreview(
  admin: AdminClient,
  provider: LenderApiProvider,
  source: LenderApiSource
): Promise<Record<string, unknown>> {
  const built = provider.buildApplication(source, {}, { referenceId: "preview" });
  const [documents, submissions] = await Promise.all([
    listSubmittableDocuments(admin, source, provider),
    listSubmissions(admin, source.assignment.id),
  ]);
  const ssn = source.resolved.values.ssn;

  return {
    provider: {
      id: provider.id,
      displayName: provider.displayName,
      picks: provider.picks,
      requiredVaultFields: provider.requiredVaultFields,
    },
    assignment: {
      id: source.assignment.id,
      status: source.assignment.status,
      lender_name: source.assignment.lender_name,
    },
    business_name: source.business?.company_name ?? source.business?.business_name ?? source.vault.company_name,
    // The SSN itself never reaches the browser — only whether one is on file.
    vault: {
      values: { ...source.resolved.values, ssn: null },
      ssn_last4: ssn && ssn.length === 9 ? ssn.slice(-4) : null,
      parsed: source.resolved.parsed,
      free_text: {
        industry: source.business?.industry ?? source.vault.industry,
        loan_purpose: source.deal?.loan_purpose ?? source.vault.loan_purpose,
        home_address: source.vault.home_address,
        // The vault's free-text business address is the primary business's.
        business_address: source.business && !source.business.is_primary ? null : source.vault.business_address,
      },
    },
    suggested_picks: built.effectivePicks,
    gaps: built.gaps,
    documents,
    submissions,
  };
}

async function sendDocuments(
  admin: AdminClient,
  provider: LenderApiProvider,
  submission: { id: string; external_id: string; document_ids: string[]; attachments: OutboundDocumentResult[] },
  source: LenderApiSource,
  documentIds: string[]
): Promise<void> {
  try {
    const { docs, failures } = await prepareOutboundDocuments(admin, source, provider, documentIds);
    const uploaded = docs.length > 0 ? await provider.uploadDocuments(submission.external_id, docs) : [];
    const merged = mergeAttachmentResults(submission.attachments ?? [], [...uploaded, ...failures]);
    // Do not clear `error` here: a prior non-fatal warning (e.g. "assignment
    // could not be marked submitted") must survive a successful document send.
    await updateSubmission(admin, submission.id, {
      attachments: merged,
      status: submissionStatusFromResults(submission.document_ids, merged),
    });
  } catch (err) {
    console.error("lender-api sendDocuments error:", err instanceof Error ? err.message : "unknown");
    await updateSubmission(admin, submission.id, {
      status: "partial",
      error: "Document upload failed — use Retry failed files.",
    });
  }
}

export async function submitApplication(args: {
  admin: AdminClient;
  provider: LenderApiProvider;
  assignmentId: string;
  actor: TransitionActor;
  vaultUpdates: unknown;
  picks: unknown;
  documentIds: unknown;
  /** Must be strictly `true` to send again after an attempt that may have reached the lender. */
  confirmResend?: unknown;
}): Promise<EngineResult> {
  const { admin, provider, assignmentId, actor } = args;

  const updates = normalizeVaultUpdates(args.vaultUpdates);
  if (!updates.ok) return { httpStatus: 400, body: { error: updates.error } };
  const picks = normalizePicks(args.picks);
  if (!picks) return { httpStatus: 400, body: { error: "picks must be an object of strings" } };
  const documentIds = normalizeDocumentIds(args.documentIds ?? []);
  if (!documentIds) return { httpStatus: 400, body: { error: "document_ids must be a list of document ids" } };

  let source = await loadLenderApiSource(admin, assignmentId);
  if (!source) return { httpStatus: 404, body: { error: "Assignment not found." } };

  // Removed/unapproved lenders must never receive the application — check this
  // before any vault write-back, row insert, or lender call, not only inside
  // markAssignmentSubmitted (which runs after the lender already has it).
  const preflight = submitGuard(source.assignment);
  if (!preflight.ok) return { httpStatus: preflight.httpStatus, body: { error: preflight.error } };

  const existing = await listSubmissions(admin, assignmentId);
  const startGuard = canStartSubmission(source.assignment.status, existing[0] ?? null);
  if (!startGuard.ok) return { httpStatus: startGuard.httpStatus, body: { error: startGuard.error } };

  // The previous attempt may already be at the lender (timeout, 5xx, 2xx without
  // a lead id): a second application could duplicate the deal there. UW must
  // confirm with the lender first. Reference ids can't be reused (unique).
  if (needsResendConfirmation(existing[0] ?? null) && args.confirmResend !== true) {
    return {
      httpStatus: 409,
      body: {
        error: "The previous attempt may have reached the lender. Confirm with them, then tick the confirmation to send again.",
        needs_confirmation: true,
      },
    };
  }

  if (startGuard.supersede && existing[0]) {
    // A "sending" row stuck past the stale window: the lender may or may not
    // have received it — mark it failed (with a warning, not a clean failure)
    // before this new attempt takes its place.
    await updateSubmission(admin, existing[0].id, {
      status: "failed",
      error: `Timed out before the lender answered (reference ${existing[0].reference_id}). The lender may have this attempt — confirm before relying on the new one.`,
    });
  }

  if (Object.keys(updates.updates).length > 0) {
    const saved = await applyVaultUpdates(admin, source, updates.updates);
    if (saved.error) return { httpStatus: saved.httpStatus ?? 500, body: { error: saved.error } };
    source = await loadLenderApiSource(admin, assignmentId);
    if (!source) return { httpStatus: 404, body: { error: "Assignment not found." } };
  }

  const attemptNo = nextAttemptNo(existing);
  const referenceId = referenceIdFor(assignmentId, attemptNo);
  const built = provider.buildApplication(source, picks, { referenceId });
  if (hasBlockingGaps(built.gaps)) {
    return { httpStatus: 400, body: { error: "Some required information is missing.", gaps: built.gaps } };
  }

  const { data: inserted, error: insertError } = await admin
    .from(TABLE)
    .insert({
      assignment_id: assignmentId,
      client_id: source.assignment.client_id,
      business_profile_id: source.assignment.business_profile_id,
      funding_deal_id: source.assignment.funding_deal_id,
      provider: provider.id,
      attempt_no: attemptNo,
      reference_id: referenceId,
      status: "sending",
      picks: built.effectivePicks,
      payload_snapshot: built.redacted,
      document_ids: documentIds,
      created_by: actor.id,
    })
    .select("id, created_at")
    .single();

  if (insertError || !inserted) {
    // 23505: a concurrent click already claimed this attempt number.
    const busy = (insertError as any)?.code === "23505";
    console.error("lender_api_submissions insert error:", insertError?.message);
    return {
      httpStatus: busy ? 409 : 500,
      body: { error: busy ? "Another submission is already in progress." : "Could not record the submission." },
    };
  }

  // A lender that only takes files inside the application gets them now, not
  // in after(). Nothing has reached the lender yet, so a failure here is clean.
  let inline: { docs: OutboundDocument[]; failures: OutboundDocumentResult[] } | null = null;
  if (provider.documentsInline) {
    try {
      inline = await prepareOutboundDocuments(admin, source, provider, documentIds);
    } catch (err) {
      console.error("lender-api inline documents error:", err instanceof Error ? err.message : "unknown");
      const error = "Could not prepare the documents — nothing was sent. Try again.";
      await updateSubmission(admin, inserted.id, { status: "failed", error });
      return { httpStatus: 500, body: { error, submission_id: inserted.id } };
    }
  }

  const created = await provider.createApplication(built.payload, inline ? { documents: inline.docs } : undefined);
  if (!created.ok || !created.externalId) {
    // Only a 4xx is a clean rejection. No status, 0 (network/timeout), a 5xx,
    // or a 2xx that came back without a lead id all mean we don't know whether
    // the lender created the application — never say "rejected" for those.
    if (isUncertainCreateFailure(created.status)) {
      const error = `Uncertain: the lender may have received this application (reference ${referenceId}). Confirm with the lender before resending.`;
      await updateSubmission(admin, inserted.id, { status: "failed", error });
      return { httpStatus: 502, body: { error, submission_id: inserted.id } };
    }
    await updateSubmission(admin, inserted.id, {
      status: "failed",
      error: created.error ?? "The lender rejected the application.",
      field_errors: created.fieldErrors ?? null,
    });
    return {
      httpStatus: 422,
      body: {
        error: created.error ?? "The lender rejected the application.",
        field_errors: created.fieldErrors ?? null,
        submission_id: inserted.id,
      },
    };
  }

  // The lender now has this application — record its id before doing anything
  // else. A failure to record it must not be swallowed: the caller must not
  // resend (it would duplicate the lead), so retry the write once and, if it
  // still fails, stop here without flipping the assignment or sending files.
  const inlineResults = inline ? mergeAttachmentResults([], [...(created.attachments ?? []), ...inline.failures]) : null;
  const recordPatch: Record<string, unknown> = inlineResults
    ? {
        status: submissionStatusFromResults(documentIds, inlineResults),
        external_id: created.externalId,
        attachments: inlineResults,
      }
    : { status: "lead_created", external_id: created.externalId };
  if (created.initialStatus !== undefined) {
    recordPatch.last_status = created.initialStatus;
    recordPatch.last_status_at = new Date().toISOString();
  }
  let recorded = await updateSubmission(admin, inserted.id, recordPatch);
  if (!recorded) recorded = await updateSubmission(admin, inserted.id, recordPatch);
  if (!recorded) {
    console.error("lender_api_submissions: could not record external_id", {
      reference_id: referenceId,
      external_id: created.externalId,
    });
    return {
      httpStatus: 500,
      body: {
        error: `The lender accepted the application (lead ${created.externalId}) but it could not be recorded. Do not resend — contact support.`,
        external_id: created.externalId,
        reference_id: referenceId,
      },
    };
  }

  const marked = await markAssignmentSubmitted(admin, { assignmentId, actor });
  const warning = marked.ok
    ? null
    : `Sent to ${provider.displayName}, but the assignment could not be marked submitted (${marked.error}). Use Retry.`;
  if (warning) await updateSubmission(admin, inserted.id, { error: warning });

  if (!inline) {
    const submission = { id: inserted.id, external_id: created.externalId, document_ids: documentIds, attachments: [] };
    const sourceForDocs = source;
    after(() => sendDocuments(admin, provider, submission, sourceForDocs, documentIds));
  }

  // The lender answered in the same call: record the verdict now, exactly as a
  // status refresh would. Its failure is not the send's failure — Refresh
  // re-applies the stored status.
  let lenderStatus: unknown = null;
  if (created.initialStatus !== undefined) {
    const applied = await applyLenderStatus(
      admin,
      provider,
      { id: inserted.id, assignment_id: assignmentId, created_at: inserted.created_at },
      created.initialStatus,
      null
    );
    lenderStatus = applied.body.status ?? null;
  }

  return {
    httpStatus: 201,
    body: {
      submission_id: inserted.id,
      external_id: created.externalId,
      reference_id: referenceId,
      documents_queued: inline ? 0 : documentIds.length,
      documents_accepted: inlineResults ? inlineResults.filter((r) => r.accepted).length : undefined,
      lender_status: lenderStatus,
      warning,
    },
  };
}

export async function retrySubmission(args: {
  admin: AdminClient;
  provider: LenderApiProvider;
  assignmentId: string;
  actor: TransitionActor;
}): Promise<EngineResult> {
  const { admin, provider, assignmentId, actor } = args;

  let [latest] = await listSubmissions(admin, assignmentId);

  const source = await loadLenderApiSource(admin, assignmentId);
  if (!source) return { httpStatus: 404, body: { error: "Assignment not found." } };

  // A lender removed from the file (or never approved) gets nothing more.
  if (isAssignmentRemoved(source.assignment)) {
    return { httpStatus: 409, body: { error: "This lender was removed from the file." } };
  }

  // The "could not be marked submitted" warning is obsolete once the assignment
  // has moved on (flipped by a later Retry or by hand): clear it so it stops showing.
  if (latest && latest.error && source.assignment.status !== "pending" && submissionErrorKind(latest.error) === "flip_failed") {
    await clearSubmissionError(admin, latest.id, latest.error);
    const stillPending = pendingDocumentIds(latest.document_ids ?? [], latest.attachments ?? []);
    if (stillPending.length === 0) {
      if (latest.external_id && (latest.status === "lead_created" || latest.status === "partial")) {
        await updateSubmission(admin, latest.id, { status: "sent" });
      }
      return { httpStatus: 200, body: { submission_id: latest.id, retrying: 0 } };
    }
    // Files still need sending: continue with the row as it is now (updated_at moved).
    [latest] = await listSubmissions(admin, assignmentId);
  }

  // The lead exists and the original upload may still be running: only finish
  // the assignment flip. Claiming the row or scheduling uploads here could send
  // the same files twice.
  if (latest && shouldOnlyFlip(source.assignment.status, latest)) {
    const marked = await markAssignmentSubmitted(admin, { assignmentId, actor });
    if (!marked.ok) return { httpStatus: marked.httpStatus, body: { error: marked.error } };
    if (latest.error && submissionErrorKind(latest.error) === "flip_failed") {
      await clearSubmissionError(admin, latest.id, latest.error);
    }
    return { httpStatus: 200, body: { submission_id: latest.id, retrying: 0, flipped: true } };
  }

  const guard = canRetrySubmission(source.assignment.status, latest ?? null);
  if (!guard.ok) return { httpStatus: guard.httpStatus, body: { error: guard.error } };
  // canRetrySubmission guarantees a non-null latest with an external_id when ok.
  const current = latest!;

  // Claim the retry atomically (optimistic concurrency on updated_at) before
  // scheduling any upload work: a second concurrent click (or a stale-window
  // race with a fresh attempt) must not both start uploading the same files.
  const { data: claimed, error: claimError } = await admin
    .from(TABLE)
    .update({ status: "lead_created", error: null, updated_at: new Date().toISOString() })
    .eq("id", current.id)
    .eq("updated_at", current.updated_at)
    .select("id");
  if (claimError) console.error("retrySubmission claim error:", claimError.message);
  if (!claimed || claimed.length === 0) {
    return { httpStatus: 409, body: { error: "A retry is already in progress." } };
  }

  // The application exists at the lender; finish the local flip if it failed.
  if (source.assignment.status === "pending") {
    const marked = await markAssignmentSubmitted(admin, { assignmentId, actor });
    if (!marked.ok) return { httpStatus: marked.httpStatus, body: { error: marked.error } };
  }

  const ids = pendingDocumentIds(current.document_ids ?? [], current.attachments ?? []);
  if (ids.length === 0) {
    await updateSubmission(admin, current.id, { status: "sent", error: null });
    return { httpStatus: 200, body: { submission_id: current.id, retrying: 0 } };
  }

  const submission = {
    id: current.id,
    external_id: current.external_id as string,
    document_ids: current.document_ids ?? [],
    attachments: current.attachments ?? [],
  };
  after(() => sendDocuments(admin, provider, submission, source, ids));

  return { httpStatus: 202, body: { submission_id: current.id, retrying: ids.length } };
}

async function notifyLenderNeedsInfo(
  admin: AdminClient,
  args: { clientId: string; displayName: string; stage: string; note: string }
): Promise<void> {
  try {
    const [{ data: admins }, { data: vault }] = await Promise.all([
      admin.from("users").select("id").eq("role", "admin"),
      admin.from("client_data_vault").select("company_name, slack_channel_id").eq("id", args.clientId).maybeSingle(),
    ]);

    if (admins && admins.length > 0) {
      const { error } = await admin.from("in_app_notifications").insert(
        admins.map((u: any) => ({
          user_id: u.id,
          client_id: args.clientId,
          title: `${args.displayName}: ${args.stage}`,
          message: `${vault?.company_name ?? "Client"} — ${args.note}`.slice(0, 500),
          is_read: false,
        }))
      );
      if (error) console.error("notifyLenderNeedsInfo in-app error:", error.message);
    }

    const channel = (vault as any)?.slack_channel_id as string | null;
    if (channel) {
      await slackPostMessage(
        channel,
        `ℹ️ ${args.displayName} (${args.stage}) needs more on ${vault?.company_name ?? "this file"}:\n${args.note}`
      );
    }
  } catch (err) {
    console.error("notifyLenderNeedsInfo error (non-fatal):", err instanceof Error ? err.message : "unknown");
  }
}

export async function refreshSubmissionStatus(
  admin: AdminClient,
  provider: LenderApiProvider,
  submission: SubmissionRow
): Promise<EngineResult> {
  if (!submission.external_id) {
    return { httpStatus: 409, body: { error: "This submission never reached the lender." } };
  }

  // No status API: the lender's answer arrived with the submission. Re-apply
  // what is stored — a verdict write that failed the first time lands now,
  // and an unchanged status never re-notifies.
  if (!provider.fetchStatus) {
    if (submission.last_status == null) {
      return {
        httpStatus: 409,
        body: { error: `${provider.displayName} has not reported a decision yet — it will arrive on its own.` },
      };
    }
    return applyLenderStatus(admin, provider, submission, submission.last_status, submission.last_status);
  }

  const fetched = await provider.fetchStatus(submission.external_id);
  if (!fetched.ok) return { httpStatus: 502, body: { error: fetched.error ?? "Could not fetch status." } };

  return applyLenderStatus(admin, provider, submission, fetched.raw, submission.last_status);
}

/**
 * A status pushed by a lender that has no status API (verified webhook body).
 * Applied exactly like a refresh; an unchanged status never re-notifies.
 */
export async function applyPushedStatus(
  admin: AdminClient,
  provider: LenderApiProvider,
  submission: SubmissionRow,
  raw: unknown
): Promise<EngineResult> {
  if (!submission.external_id) {
    return { httpStatus: 409, body: { error: "This submission never reached the lender." } };
  }
  return applyLenderStatus(admin, provider, submission, raw, submission.last_status);
}

/** Records a lender status on the submission and applies it to the assignment (verdict / needs-info). */
async function applyLenderStatus(
  admin: AdminClient,
  provider: LenderApiProvider,
  submission: { id: string; assignment_id: string; created_at: string },
  raw: unknown,
  previousRaw: unknown
): Promise<EngineResult> {
  const normalized = provider.interpretStatus(raw);
  // Compare by meaning, not raw JSON: the lender's raw payload can carry
  // volatile fields (timestamps, ids) that change on every poll without the
  // status itself changing, which would otherwise fire "needs info" every time.
  const previous = previousRaw == null ? null : provider.interpretStatus(previousRaw);
  const statusChanged = previous === null || !sameNormalizedStatus(previous, normalized);
  await updateSubmission(admin, submission.id, {
    last_status: raw ?? null,
    last_status_at: new Date().toISOString(),
  });

  const { data: assignment } = await admin
    .from("client_lender_assignments")
    .select("id, client_id, status, submitted_at")
    .eq("id", submission.assignment_id)
    .maybeSingle();
  if (!assignment) return { httpStatus: 404, body: { error: "Assignment not found." } };

  // Manually re-submitted after this lead was created: the lead's (old) verdict
  // must not overwrite the new submission. last_status is still stored above.
  const resubmittedSinceSend = isResubmittedSinceSend(assignment.submitted_at, submission.created_at);
  const action = decideStatusAction(assignment.status, normalized, { statusChanged, resubmittedSinceSend });
  const apiActor: TransitionActor = { id: null, name: `${provider.displayName} (API)` };

  let applied: string = action.type;
  if (action.type === "verdict") {
    const recorded = await recordLenderVerdict(admin, {
      assignmentId: assignment.id,
      status: action.status,
      responseNotes: action.note,
      actor: apiActor,
    });
    if (!recorded.ok) {
      if (recorded.httpStatus !== 409) {
        return { httpStatus: recorded.httpStatus, body: { error: recorded.error, status: normalized } };
      }
      // Already resolved by hand (or by a racing poll) — not an error, just nothing new applied.
      applied = "none";
    }
  } else if (action.type === "needs_info") {
    await notifyLenderNeedsInfo(admin, {
      clientId: assignment.client_id,
      displayName: provider.displayName,
      stage: normalized.stage,
      note: action.note,
    });
  }

  return { httpStatus: 200, body: { status: normalized, applied } };
}

/** Same lender status for the caller's purposes: kind + stage + note (when present). */
function sameNormalizedStatus(a: NormalizedStatus, b: NormalizedStatus): boolean {
  if (a.kind !== b.kind || a.stage !== b.stage) return false;
  const aNote = "note" in a ? a.note : undefined;
  const bNote = "note" in b ? b.note : undefined;
  return aNote === bNote;
}
