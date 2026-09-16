// src/lib/lender-assignment-transitions.ts
//
// The state changes a lender assignment goes through when a file leaves for a
// lender and when the lender answers — shared by the manual UW buttons and the
// lender-API engine, so an API submission fires exactly the same ledger rows,
// admin notifications and Slack posts as a manual one.
//
// NOTE: PATCH /api/lender-assignments/[id]/response keeps its own verdict code:
// its single update path also serves misclick corrections and re-submissions.
// recordLenderVerdict mirrors only its verdict branch, plus writes the note.

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closeAttempt, openAttempt } from "@/lib/lender-response-history";
import { slackPostMessage } from "@/lib/slack-api";
import { notifyAdminsOfLenderPipelineEvent } from "@/lib/notifications/lender-pipeline";

export interface TransitionActor {
  id: string | null;
  name: string | null;
}

export type TransitionResult =
  | { ok: true; assignment: Record<string, any> }
  | { ok: false; httpStatus: number; error: string };

export function submitGuard(
  existing: { decision: string; admin_review: string; status: string } | null
): { ok: true } | { ok: false; httpStatus: number; error: string } {
  if (!existing) return { ok: false, httpStatus: 404, error: "Assignment not found." };
  if (existing.decision !== "approved") {
    return { ok: false, httpStatus: 409, error: "Assignment was not approved by the matching engine." };
  }
  // Only an explicitly REMOVED lender is refused — admin_review is never an
  // approval gate (see memory: lender_admin_review_removal_only).
  if (existing.admin_review === "rejected") {
    return { ok: false, httpStatus: 409, error: "This lender was removed from the file." };
  }
  if (existing.status !== "pending") {
    return { ok: false, httpStatus: 409, error: `Assignment status is already "${existing.status}".` };
  }
  return { ok: true };
}

export async function markAssignmentSubmitted(
  admin: SupabaseClient,
  args: { assignmentId: string; actor: TransitionActor }
): Promise<TransitionResult> {
  const { assignmentId, actor } = args;

  const { data: existing, error: fetch_error } = await admin
    .from("client_lender_assignments")
    .select("id, client_id, lender_name, decision, admin_review, status")
    .eq("id", assignmentId)
    .maybeSingle();

  if (fetch_error) {
    console.error("markAssignmentSubmitted fetch error:", fetch_error);
    return { ok: false, httpStatus: 500, error: "Lookup failed." };
  }

  const guard = submitGuard(existing);
  if (!guard.ok) return guard;

  const now = new Date().toISOString();
  // submitted_at, not just updated_at: the verdict write later overwrites
  // updated_at, so "out 6 days, still silent" needs its own column.
  // Conditional on status='pending': two concurrent callers (a double click, or
  // submitApplication racing a manual submit) must not both flip the row and
  // both fire the ledger/notification side effects below.
  // Also conditional on not removed: an admin removal landing between the guard
  // read above and this write must still win (admin_review is NOT NULL).
  const { data: updated, error: update_error } = await admin
    .from("client_lender_assignments")
    .update({ status: "submitted", submitted_at: now, updated_at: now })
    .eq("id", assignmentId)
    .eq("status", "pending")
    .neq("admin_review", "rejected")
    .select("*")
    .maybeSingle();

  if (update_error) {
    console.error("markAssignmentSubmitted update error:", update_error);
    return { ok: false, httpStatus: 500, error: update_error.message };
  }
  if (!updated) {
    return { ok: false, httpStatus: 409, error: 'Assignment status is already "submitted".' };
  }

  // Best-effort by design — see lender-response-history.
  await openAttempt(admin, {
    assignmentId,
    submittedAt: now,
    recordedBy: actor.id,
    recordedByName: actor.name,
  });

  after(async () => {
    try {
      await notifyAdminsOfLenderPipelineEvent(
        {
          id: existing!.id,
          client_id: (existing as any).client_id,
          lender_name: (existing as any).lender_name,
          specialty: (updated as any)?.specialty ?? null,
        },
        "submitted"
      );
    } catch (e) {
      console.error("submit notify error (non-fatal):", e);
    }
  });

  // If EVERY lender still on this file is now out the door, post a summary
  // into the deal channel.
  try {
    const client_id = (existing as any).client_id as string | null;
    if (client_id) {
      const { data: all_approved } = await admin
        .from("client_lender_assignments")
        .select("lender_name, status")
        .eq("client_id", client_id)
        .neq("admin_review", "rejected");

      const rows = all_approved ?? [];
      const OUT = new Set(["submitted", "approved_by_lender", "funded"]);
      const all_out = rows.length > 0 && rows.every((r: any) => OUT.has(r.status));

      if (all_out) {
        const { data: vault } = await admin
          .from("client_data_vault")
          .select("slack_channel_id, company_name")
          .eq("id", client_id)
          .maybeSingle();

        const channel_id = (vault as any)?.slack_channel_id as string | null;
        if (channel_id) {
          const lender_list = rows.map((r: any) => `• ${r.lender_name}`).join("\n");
          const text =
            `✅ This file has been submitted to every lender on it` +
            `${(vault as any)?.company_name ? ` for ${(vault as any).company_name}` : ""}.\n${lender_list}`;
          await slackPostMessage(channel_id, text);
        }
      }
    }
  } catch (slack_err) {
    console.error("markAssignmentSubmitted Slack notify error (non-fatal):", slack_err);
  }

  return { ok: true, assignment: updated as Record<string, any> };
}

export async function recordLenderVerdict(
  admin: SupabaseClient,
  args: {
    assignmentId: string;
    status: "approved_by_lender" | "declined_by_lender";
    responseNotes: string;
    actor: TransitionActor;
  }
): Promise<TransitionResult> {
  const now = new Date().toISOString();

  // Conditional on status='submitted': an automatic verdict must never
  // overwrite one UW already recorded by hand, and two webhook deliveries
  // racing each other must not both transition the row.
  const { data: updated, error } = await admin
    .from("client_lender_assignments")
    .update({
      status: args.status,
      responded_at: now,
      response_notes: args.responseNotes,
      updated_at: now,
    })
    .eq("id", args.assignmentId)
    .eq("status", "submitted")
    .select("id, client_id, lender_name, specialty, response_notes")
    .maybeSingle();

  if (error) {
    console.error("recordLenderVerdict update error:", error.message);
    return { ok: false, httpStatus: 500, error: error.message };
  }
  if (!updated) {
    return { ok: false, httpStatus: 409, error: "Assignment is no longer awaiting the lender." };
  }

  await closeAttempt(admin, {
    assignmentId: args.assignmentId,
    status: args.status,
    responseNotes: args.responseNotes,
    respondedAt: now,
    recordedBy: args.actor.id,
    recordedByName: args.actor.name,
  });

  after(async () => {
    try {
      await notifyAdminsOfLenderPipelineEvent(
        {
          id: updated.id,
          client_id: updated.client_id,
          lender_name: updated.lender_name,
          specialty: updated.specialty ?? null,
          response_notes: updated.response_notes ?? null,
        },
        args.status
      );
    } catch (e) {
      console.error("recordLenderVerdict notify error (non-fatal):", e);
    }
  });

  return { ok: true, assignment: updated as Record<string, any> };
}
