// src/lib/lender-api/status-events.ts
//
// The timeline behind lender_api_submissions.last_status: one row each time a
// lender's status for a submission CHANGES. Table: lender_api_status_events
// (migration 20261012). Service-role only.
//
// Everything here is best-effort and tolerates the table not existing yet — a
// status must still be applied to the file when its history can't be written.

import type { AdminClient } from "./source";
import type { NormalizedStatus } from "./types";

const TABLE = "lender_api_status_events";

/** How the status reached us. */
export type StatusEventSource = "send" | "webhook" | "refresh";

export interface StatusEvent {
  kind: NormalizedStatus["kind"];
  stage: string;
  note: string | null;
  source: StatusEventSource;
  applied: string;
  created_at: string;
}

/** PostgREST / Postgres "no such table" — the migration isn't applied yet. */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

function noteOf(status: NormalizedStatus): string | null {
  return "note" in status ? status.note : null;
}

/**
 * Appends an event unless it repeats the newest one already recorded, so a
 * poll that finds nothing new adds nothing — and the first status seen for a
 * submission is always recorded, whatever path it arrived on.
 */
export async function recordStatusEvent(
  admin: AdminClient,
  args: { submissionId: string; providerId: string; status: NormalizedStatus; source: StatusEventSource; applied: string }
): Promise<void> {
  try {
    const { data: newest, error: readErr } = await admin
      .from(TABLE)
      .select("kind, stage, note")
      .eq("submission_id", args.submissionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readErr) {
      if (!isMissingTable(readErr)) console.error("lender_api_status_events read error:", readErr.message);
      return;
    }

    const note = noteOf(args.status);
    if (newest && newest.kind === args.status.kind && newest.stage === args.status.stage && (newest.note ?? null) === note) {
      return;
    }

    const { error } = await admin.from(TABLE).insert({
      submission_id: args.submissionId,
      provider: args.providerId,
      kind: args.status.kind,
      stage: args.status.stage,
      note,
      source: args.source,
      applied: args.applied,
    });
    if (error && !isMissingTable(error)) console.error("lender_api_status_events insert error:", error.message);
  } catch (err) {
    console.error("recordStatusEvent error (non-fatal):", err instanceof Error ? err.message : "unknown");
  }
}

/** Events per submission id, oldest first. Empty when there are none or the table is missing. */
export async function loadStatusEvents(admin: AdminClient, submissionIds: string[]): Promise<Map<string, StatusEvent[]>> {
  const out = new Map<string, StatusEvent[]>();
  if (submissionIds.length === 0) return out;
  try {
    const { data, error } = await admin
      .from(TABLE)
      .select("submission_id, kind, stage, note, source, applied, created_at")
      .in("submission_id", submissionIds)
      .order("created_at", { ascending: true });
    if (error) {
      if (!isMissingTable(error)) console.error("lender_api_status_events list error:", error.message);
      return out;
    }
    for (const row of (data ?? []) as Array<StatusEvent & { submission_id: string }>) {
      const { submission_id, ...event } = row;
      const list = out.get(submission_id);
      if (list) list.push(event);
      else out.set(submission_id, [event]);
    }
  } catch (err) {
    console.error("loadStatusEvents error (non-fatal):", err instanceof Error ? err.message : "unknown");
  }
  return out;
}
