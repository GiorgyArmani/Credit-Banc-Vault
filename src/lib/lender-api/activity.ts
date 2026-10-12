// src/lib/lender-api/activity.ts
//
// "What is running at this lender?" — every deal we sent to one provider by
// API, with the lender's status as we last read it. The per-file view lives on
// the client file (one assignment at a time); this is the same data turned the
// other way, for the lender database.
//
// SERVER ONLY (reads lender_api_submissions with the service role). The row
// type is imported by the browser with `import type`.

import type { AdminClient } from "./source";
import type { LenderApiProvider, NormalizedStatus } from "./types";
import { refreshSubmissionStatus, type SubmissionRow } from "./submissions";
import { loadStatusEvents, type StatusEvent } from "./status-events";

export interface ProviderActivityRow {
  submission_id: string;
  assignment_id: string;
  client_id: string;
  client_name: string | null;
  company_name: string | null;
  attempt_no: number;
  /** A newer attempt on the same assignment reached the lender — this one is history. */
  superseded: boolean;
  /** Our side of the send: sending / lead_created / sent / partial / failed. */
  send_status: string;
  external_id: string | null;
  /** The lender's status as last read; null until they have reported one. */
  lender_status: { kind: NormalizedStatus["kind"]; stage: string; note: string | null } | null;
  last_checked_at: string | null;
  /** Every change of the lender's status, oldest first. Empty for sends that predate the timeline. */
  history: StatusEvent[];
  /** client_lender_assignments.status — what the file itself shows. */
  assignment_status: string | null;
  error: string | null;
  sent_at: string;
}

/** Enough for a lender's test + early production volume; newest first. */
const ACTIVITY_LIMIT = 200;
/** Live refreshes per request — each is a lender round trip inside one function call. */
const REFRESH_LIMIT = 30;

const COLUMNS =
  "id, assignment_id, client_id, business_profile_id, funding_deal_id, provider, attempt_no, reference_id, external_id, status, picks, document_ids, attachments, field_errors, last_status, last_status_at, error, created_at, updated_at";

async function loadRows(admin: AdminClient, providerId: string): Promise<SubmissionRow[] | null> {
  const { data, error } = await admin
    .from("lender_api_submissions")
    .select(COLUMNS)
    .eq("provider", providerId)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_LIMIT);
  if (error) {
    console.error("lender-api activity read error:", error.message);
    return null;
  }
  return (data ?? []) as unknown as SubmissionRow[];
}

/** The newest attempt per assignment that actually reached the lender. */
function currentByAssignment(rows: SubmissionRow[]): Map<string, SubmissionRow> {
  const current = new Map<string, SubmissionRow>();
  for (const row of rows) {
    if (!row.external_id) continue;
    const seen = current.get(row.assignment_id);
    if (!seen || row.attempt_no > seen.attempt_no) current.set(row.assignment_id, row);
  }
  return current;
}

/** null = the read failed (the caller answers 500); [] = nothing sent yet. */
export async function listProviderActivity(
  admin: AdminClient,
  provider: LenderApiProvider
): Promise<ProviderActivityRow[] | null> {
  const rows = await loadRows(admin, provider.id);
  if (!rows) return null;
  if (rows.length === 0) return [];

  const clientIds = Array.from(new Set(rows.map((r) => r.client_id)));
  const assignmentIds = Array.from(new Set(rows.map((r) => r.assignment_id)));
  const [{ data: vaults }, { data: assignments }, events] = await Promise.all([
    admin.from("client_data_vault").select("id, client_name, company_name").in("id", clientIds),
    admin.from("client_lender_assignments").select("id, status").in("id", assignmentIds),
    loadStatusEvents(admin, rows.map((r) => r.id)),
  ]);
  const vaultById = new Map((vaults ?? []).map((v: any) => [v.id as string, v]));
  const statusByAssignment = new Map((assignments ?? []).map((a: any) => [a.id as string, a.status as string]));
  const current = currentByAssignment(rows);

  return rows.map((row) => {
    const normalized = row.last_status == null ? null : provider.interpretStatus(row.last_status);
    const vault = vaultById.get(row.client_id);
    return {
      submission_id: row.id,
      assignment_id: row.assignment_id,
      client_id: row.client_id,
      client_name: vault?.client_name ?? null,
      company_name: vault?.company_name?.trim() || null,
      attempt_no: row.attempt_no,
      superseded: !!row.external_id && current.get(row.assignment_id)?.id !== row.id,
      send_status: row.status,
      external_id: row.external_id,
      lender_status: normalized
        ? { kind: normalized.kind, stage: normalized.stage, note: "note" in normalized ? normalized.note : null }
        : null,
      last_checked_at: row.last_status_at,
      history: events.get(row.id) ?? [],
      assignment_status: statusByAssignment.get(row.assignment_id) ?? null,
      error: row.error,
      sent_at: row.created_at,
    };
  });
}

export interface ProviderRefreshSummary {
  refreshed: number;
  failed: number;
  /** Current submissions left for the next click (over the per-request cap). */
  remaining: number;
  /** The lender has no status API — their answers only ever arrive on their own. */
  unsupported: boolean;
}

/**
 * Re-reads every current submission's status from the lender and applies it
 * exactly as "Refresh status" on the file does (a verdict is written back, an
 * unchanged status never re-notifies). Superseded attempts are left alone —
 * an old lead's verdict says nothing about the newer send.
 */
export async function refreshProviderActivity(
  admin: AdminClient,
  provider: LenderApiProvider
): Promise<ProviderRefreshSummary | null> {
  if (!provider.fetchStatus) return { refreshed: 0, failed: 0, remaining: 0, unsupported: true };

  const rows = await loadRows(admin, provider.id);
  if (!rows) return null;

  // Least recently checked first, so repeated clicks walk a long list.
  const current = Array.from(currentByAssignment(rows).values()).sort((a, b) =>
    (a.last_status_at ?? "").localeCompare(b.last_status_at ?? "")
  );
  const batch = current.slice(0, REFRESH_LIMIT);

  let refreshed = 0;
  let failed = 0;
  for (const row of batch) {
    try {
      const result = await refreshSubmissionStatus(admin, provider, row);
      if (result.httpStatus < 400) refreshed++;
      else failed++;
    } catch (err) {
      console.error("lender-api activity refresh error:", err instanceof Error ? err.message : "unknown");
      failed++;
    }
  }
  return { refreshed, failed, remaining: current.length - batch.length, unsupported: false };
}
