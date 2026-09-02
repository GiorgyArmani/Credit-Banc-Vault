// src/app/api/lender-assignments/[id]/response/route.ts
//
// PATCH /api/lender-assignments/[id]/response
//   Records where a submitted file stands with the lender — the signal that UW
//   heard back. Drives the row between the post-submission lifecycle states,
//   which the admin portal mirrors on its Lender Match — Admin Review card.
//
// Body: { status: 'submitted' | 'approved_by_lender' | 'declined_by_lender',
//         resubmission?: boolean, resubmit_note?: string }
//   UW picks the status from a dropdown, so any of these may follow any other
//   (e.g. correcting a misclick back to "awaiting lender"). Refused if the row
//   doesn't exist or hasn't been submitted yet — you can't record a lender
//   response before the file was pushed out (use the /submit route first).
//
//   `resubmission: true` is the OTHER way a row goes verdict → 'submitted': the
//   deal being sent back to a lender that already answered, with the extra
//   documents or corrections that lender asked for. A declined lender is not a
//   closed door here, so this is a normal part of the workflow.
//
//   The flag matters because the two look identical on the wire and must not be
//   treated the same. A misclick correction keeps the recorded response — UW
//   typed those decline reasons and meant them. A real re-submission retires
//   them: the note is filed to the internal-notes audit trail and the column is
//   cleared, so the panel is blank for the round now in flight and the next
//   response Slack follow-up fires again instead of being suppressed as a
//   duplicate of the last one. Only an explicit flag from the Re-submit action
//   sets that in motion; the bare dropdown never does.
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireStaff } from '@/lib/auth/require-staff';
import {
  closeAttempt,
  openAttempt,
  resolveRecorderName,
  type AttemptStatus,
} from '@/lib/lender-response-history';
import { notifyAdminsOfLenderPipelineEvent } from '@/lib/notifications/lender-pipeline';
import type { LenderPipelineEvent } from '@/lib/email';

const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// The post-submission lifecycle states UW may toggle between via the dropdown.
const SELECTABLE_STATUSES = ['submitted', 'approved_by_lender', 'declined_by_lender'] as const;
// A file must already be at one of these (i.e. out the door) before UW can move
// it around the lifecycle.
const TRANSITIONABLE_FROM = new Set(['submitted', 'approved_by_lender', 'declined_by_lender', 'funded']);
// The states a lender has actually answered from. Only these can be re-submitted.
const VERDICT_STATUSES = new Set(['approved_by_lender', 'declined_by_lender']);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing assignment id.' }, { status: 400 });
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      /* empty body handled below */
    }
    const next_status = body?.status;
    if (!SELECTABLE_STATUSES.includes(next_status)) {
      return NextResponse.json(
        { error: `Body must include status: one of ${SELECTABLE_STATUSES.join(', ')}.` },
        { status: 400 }
      );
    }
    const wants_resubmission = body?.resubmission === true;
    const resubmit_note =
      typeof body?.resubmit_note === 'string' && body.resubmit_note.trim()
        ? body.resubmit_note.trim().slice(0, 2000)
        : null;

    const { data: existing, error: fetch_error } = await supabase_admin
      .from('client_lender_assignments')
      .select('id, client_id, lender_name, specialty, status, response_notes')
      .eq('id', id)
      .maybeSingle();

    if (fetch_error) {
      console.error('lender-assignment response fetch error:', fetch_error);
      return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }
    if (!TRANSITIONABLE_FROM.has(existing.status)) {
      return NextResponse.json(
        { error: `File must be submitted to a lender first (current: "${existing.status}").` },
        { status: 409 }
      );
    }

    // A re-submission is only meaningful from a state the lender actually
    // answered from. Refuse rather than quietly downgrading it to a plain status
    // change: the caller asked for the previous response to be retired, and
    // would otherwise be told that happened when it didn't.
    const is_resubmission = wants_resubmission && next_status === 'submitted';
    if (is_resubmission && !VERDICT_STATUSES.has(existing.status)) {
      return NextResponse.json(
        { error: `Only a lender that has already responded can be re-submitted (current: "${existing.status}").` },
        { status: 409 }
      );
    }

    // No-op if the status isn't actually changing.
    if (existing.status === next_status) {
      return NextResponse.json({ success: true, assignment: existing, unchanged: true });
    }

    const prior_note = (existing.response_notes ?? '').trim();

    // Archive the outgoing response BEFORE clearing it, and treat a failed
    // archive as fatal. The whole point of the step is that the decline reasons
    // survive the re-submission; clearing the column on the hope that the audit
    // note landed would lose exactly what we set out to keep.
    if (is_resubmission && prior_note) {
      const verdict_label =
        existing.status === 'declined_by_lender' ? 'declined' : 'approved';
      const note_label =
        existing.status === 'declined_by_lender'
          ? 'Decline reasons'
          : 'Offer / stips / requested documents';

      const { data: profile } = await supabase_admin
        .from('users')
        .select('first_name, last_name')
        .eq('id', gate.user.id)
        .maybeSingle();
      const author_name = profile
        ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Underwriter'
        : 'Underwriter';

      const sections = [
        `Re-submitted to ${existing.lender_name} after the lender ${verdict_label}.`,
        `${note_label} on the previous round:\n${prior_note}`,
      ];
      if (resubmit_note) sections.push(`What changed this round:\n${resubmit_note}`);

      const { error: archive_error } = await supabase_admin
        .from('client_internal_notes')
        .insert({
          client_id: existing.client_id,
          author_id: gate.user.id,
          author_role: gate.role,
          author_name,
          content: sections.join('\n\n'),
        });

      if (archive_error) {
        console.error('lender-assignment resubmit archive error:', archive_error);
        return NextResponse.json(
          { error: 'Could not archive the previous lender response — nothing was changed.' },
          { status: 500 }
        );
      }
    }

    const now = new Date().toISOString();
    // A re-submission retires the previous round's response so the panel opens
    // blank for the round now in flight — and so the "note recorded" Slack
    // follow-up fires again when UW types the new one, instead of being
    // suppressed as an edit of the old one.
    const update_payload: Record<string, string | null> = { status: next_status, updated_at: now };
    if (is_resubmission) update_payload.response_notes = null;

    // When the lender actually came back. Only a real verdict sets it —
    // moving a row back to 'submitted' is either a misclick correction or a
    // genuine re-submission, and in both cases there is no outstanding answer,
    // so the clock restarts rather than keeping a stale response date.
    if (next_status === 'approved_by_lender' || next_status === 'declined_by_lender') {
      update_payload.responded_at = now;
    } else if (next_status === 'submitted') {
      update_payload.responded_at = null;
      // A genuine re-submission is a fresh send; a misclick correction is not.
      if (is_resubmission) update_payload.submitted_at = now;
    }

    const { data: updated, error: update_error } = await supabase_admin
      .from('client_lender_assignments')
      .update(update_payload)
      .eq('id', id)
      .select('*')
      .single();

    if (update_error) {
      console.error('lender-assignment response update error:', update_error);
      return NextResponse.json({ error: update_error.message }, { status: 500 });
    }

    // ── Response ledger ────────────────────────────────────────────────────
    // The half of this route that makes a re-submission legible later. All
    // best-effort: the assignment row above is already committed and is the
    // source of truth for current state, so a ledger failure must not turn a
    // recorded verdict into a 500.
    {
      const recorder_name = await resolveRecorderName(supabase_admin, gate.user.id);

      if (is_resubmission) {
        // A genuine second trip. The previous attempt keeps its verdict and its
        // response_notes — which is exactly what the assignment row is about to
        // lose — and `resubmit_reason` records why we went back.
        await openAttempt(supabase_admin, {
          assignmentId: id,
          submittedAt: now,
          resubmitReason: resubmit_note || null,
          recordedBy: gate.user.id,
          recordedByName: recorder_name,
        });
      } else if (next_status === 'approved_by_lender' || next_status === 'declined_by_lender') {
        // A verdict — closes the attempt in play. Correcting a misclicked
        // verdict revises that same attempt rather than inventing a second trip.
        // The note is not passed: it is typed afterwards via response-detail,
        // and passing undefined leaves whatever is already recorded intact.
        await closeAttempt(supabase_admin, {
          assignmentId: id,
          status: next_status as AttemptStatus,
          respondedAt: now,
          recordedBy: gate.user.id,
          recordedByName: recorder_name,
        });
      }
      // A plain move back to 'submitted' (a misclick correction, not a
      // re-submission) deliberately writes nothing: no new trip happened, and
      // the attempt it belongs to is already open.
    }

    // Notify admins (in-app + email + Slack) so the admin portal status stays
    // in sync. Deferred with after() rather than a bare `void` promise: on
    // Vercel the function is frozen the moment the response is returned, so a
    // detached promise with no awaited work behind it never finishes — which is
    // exactly why lender verdicts stopped reaching Slack while /submit (which
    // awaits its own Slack summary) kept working. after() keeps it alive.
    after(async () => {
      try {
        await notifyAdminsOfLenderPipelineEvent(
          {
            id: existing.id,
            client_id: (existing as any).client_id,
            lender_name: (existing as any).lender_name,
            specialty: (existing as any).specialty ?? null,
            // Include the note if UW already typed it — the channel gets the
            // decline reasons / offer terms in the same message as the verdict.
            // The notifier only reads it on a verdict event, so a stale note
            // can't ride out on a submission.
            response_notes: (existing as any).response_notes ?? null,
          },
          next_status as LenderPipelineEvent,
          { resubmission: is_resubmission, resubmit_note }
        );
      } catch (e) {
        console.error('response notify error (non-fatal):', e);
      }
    });

    return NextResponse.json({ success: true, assignment: updated, resubmitted: is_resubmission });
  } catch (err: any) {
    console.error('lender-assignment response error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
