// src/app/api/admin/lender-reviews/route.ts
//
// Admin writes to a client's lender list. There is no admin approval step any
// more — admins are informed of the lenders, not asked to clear them — so what
// these two verbs mean now is:
//   PATCH  { assignment_id, decision: 'rejected' } — REMOVE a lender from the
//          file. ('approved' still restores one, and legacy batches still work.)
//          A removal is posted to the deal's Slack channel so UW can't submit a
//          lender that was just pulled.
//   POST   adds a lender the admin already knows this file is going to —
//          inserted ready to submit, no match run and no bank analysis needed.
//
// AuthZ: caller must be authenticated AND have role = 'admin' in public.users.
// We resolve the reviewer's advisor_id from session and stamp it on every row
// so we know who made each call (admin_reviewed_by). admin_reviewed_at is
// stamped at write time.

import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';
import { send_lender_review_approved_notification } from '@/lib/email';
import { slackPostMessage } from '@/lib/slack-api';

const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

interface ReviewItem {
  assignment_id: string;
  decision: 'approved' | 'rejected';
  notes?: string;
}

/**
 * Notify the underwriting team that admin has cleared a batch of lenders for
 * outreach on a specific client. Sends email + creates in-app notifications.
 *
 * Non-fatal: failures are logged but never bubbled, since the DB write that
 * caused the notification has already committed and the user has been told
 * the action succeeded.
 */
async function notify_uw_of_approved_lenders(
  client_id: string,
  approved_lenders: string[],
  notes_by_lender: Record<string, string | null>,
  admin_advisor_id: string,
): Promise<void> {
  if (approved_lenders.length === 0) return;

  try {
    const [{ data: client }, { data: admin_row }, { data: uw_users }] = await Promise.all([
      supabase_admin
        .from('client_data_vault')
        .select('id, client_name, company_name')
        .eq('id', client_id)
        .maybeSingle(),
      supabase_admin
        .from('advisors')
        .select('first_name, last_name')
        .eq('id', admin_advisor_id)
        .maybeSingle(),
      supabase_admin
        .from('users')
        .select('id, email, first_name')
        .eq('role', 'underwriting'),
    ]);

    if (!client) {
      console.warn(`notify_uw_of_approved_lenders: client ${client_id} not found`);
      return;
    }

    if (!uw_users || uw_users.length === 0) {
      console.warn('notify_uw_of_approved_lenders: no UW users to notify');
      return;
    }

    const admin_name = admin_row
      ? `${admin_row.first_name ?? ''} ${admin_row.last_name ?? ''}`.trim() || 'Admin'
      : 'Admin';

    const app_url = process.env.NEXT_PUBLIC_APP_URL || 'https://vault.creditbanc.io';
    const client_profile_url = `${app_url}/underwriting/dashboard/clients/${client.id}`;

    const notif_message = `${admin_name} approved ${approved_lenders.length} lender${approved_lenders.length === 1 ? '' : 's'} for outreach on ${client.client_name}.`;
    const notif_rows = uw_users.map((u) => ({
      user_id: u.id,
      client_id: client.id,
      title: 'Lenders cleared for outreach',
      message: notif_message,
    }));
    await supabase_admin.from('in_app_notifications').insert(notif_rows);

    await Promise.all(
      uw_users
        .filter((u) => !!u.email)
        .map((u) =>
          send_lender_review_approved_notification({
            underwriter_email: u.email,
            client_name: client.client_name,
            company_name: client.company_name,
            admin_name,
            approved_lenders,
            notes_by_lender,
            client_profile_url,
          }).catch((err) => {
            console.error(`notify_uw_of_approved_lenders: email to ${u.email} failed:`, err);
          }),
        ),
    );

    console.log(
      `✅ UW notified of ${approved_lenders.length} approved lender(s) for ${client.client_name}`,
    );
  } catch (err) {
    console.error('notify_uw_of_approved_lenders: unexpected failure (non-fatal):', err);
  }
}

export async function PATCH(request: Request) {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return gate.response;
    const { advisor_id } = gate;

    const body = await request.json();
    const items: ReviewItem[] = Array.isArray(body?.items) ? body.items : [];

    if (items.length === 0) {
      return NextResponse.json({ error: 'No review items provided.' }, { status: 400 });
    }

    // Validate each item before writing — refuse the whole batch on any bad row
    // so the client never sees a partial commit.
    for (const item of items) {
      if (!item.assignment_id || typeof item.assignment_id !== 'string') {
        return NextResponse.json(
          { error: 'Each item must include an assignment_id string.' },
          { status: 400 }
        );
      }
      if (item.decision !== 'approved' && item.decision !== 'rejected') {
        return NextResponse.json(
          { error: `Invalid decision "${item.decision}" — must be "approved" or "rejected".` },
          { status: 400 }
        );
      }
    }

    const now = new Date().toISOString();

    // Snapshot prior admin_review state so we can fire UW notifications only
    // for rows that transitioned non-approved → approved (avoids spamming UW
    // when the admin re-saves an already-approved row).
    const { data: prior_rows } = await supabase_admin
      .from('client_lender_assignments')
      .select('id, client_id, lender_name, admin_review')
      .in('id', items.map((i) => i.assignment_id));
    const prior_by_id = new Map<string, { client_id: string; lender_name: string; admin_review: string }>();
    for (const r of prior_rows ?? []) {
      prior_by_id.set(r.id, { client_id: r.client_id, lender_name: r.lender_name, admin_review: r.admin_review });
    }

    const updates = await Promise.all(
      items.map((item) =>
        supabase_admin
          .from('client_lender_assignments')
          .update({
            admin_review: item.decision,
            admin_review_notes: item.notes ?? null,
            admin_reviewed_by: advisor_id,
            admin_reviewed_at: now,
            updated_at: now,
          })
          .eq('id', item.assignment_id)
          .select('id, client_id, admin_review')
          .single()
      )
    );

    const failures = updates.filter((u) => u.error);
    if (failures.length > 0) {
      console.error('admin lender-review batch had failures:', failures);
      return NextResponse.json(
        {
          error: 'Some review updates failed.',
          details: failures.map((f) => f.error?.message),
        },
        { status: 500 }
      );
    }

    // Group newly-approved lenders by client and notify UW. A batch could in
    // principle span multiple clients (the panel writes one client at a time
    // today, but the API doesn't enforce it), so group defensively.
    const approved_by_client = new Map<
      string,
      { lender_names: string[]; notes_by_lender: Record<string, string | null> }
    >();
    for (const item of items) {
      if (item.decision !== 'approved') continue;
      const prior = prior_by_id.get(item.assignment_id);
      if (!prior) continue;
      if (prior.admin_review === 'approved') continue; // no transition — skip
      const entry =
        approved_by_client.get(prior.client_id) ??
        { lender_names: [], notes_by_lender: {} as Record<string, string | null> };
      entry.lender_names.push(prior.lender_name);
      entry.notes_by_lender[prior.lender_name] = item.notes ?? null;
      approved_by_client.set(prior.client_id, entry);
    }
    // Fire-and-forget — never block the response on email I/O.
    Promise.all(
      Array.from(approved_by_client.entries()).map(([client_id, entry]) =>
        notify_uw_of_approved_lenders(client_id, entry.lender_names, entry.notes_by_lender, advisor_id),
      ),
    ).catch((err) => console.error('UW notification dispatch failed (non-fatal):', err));

    // A REMOVED lender has to reach the deal channel. The admin card is now
    // informational — nothing about it makes UW look before submitting — so
    // without this, UW can push out a lender the admin pulled thirty seconds
    // earlier. One line, no @-mentions: it's a correction, not an alarm.
    after(async () => {
      try {
        const removed_by_client = new Map<string, string[]>();
        for (const item of items) {
          if (item.decision !== 'rejected') continue;
          const prior = prior_by_id.get(item.assignment_id);
          if (!prior || prior.admin_review === 'rejected') continue; // no transition
          const list = removed_by_client.get(prior.client_id) ?? [];
          list.push(prior.lender_name);
          removed_by_client.set(prior.client_id, list);
        }

        for (const [client_id, lender_names] of removed_by_client) {
          const { data: vault } = await supabase_admin
            .from('client_data_vault')
            .select('slack_channel_id')
            .eq('id', client_id)
            .maybeSingle();
          const channel_id = (vault as any)?.slack_channel_id as string | null;
          if (!channel_id) continue;
          await slackPostMessage(
            channel_id,
            `🚫 Removed from this file — do not submit: ${lender_names.map((n) => `*${n}*`).join(', ')}`
          );
        }
      } catch (err) {
        console.error('lender removal Slack post failed (non-fatal):', err);
      }
    });

    return NextResponse.json({
      success: true,
      updated: updates.map((u) => u.data),
    });
  } catch (err: any) {
    console.error('admin lender-review error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}

// Admin adds a lender manually — picks from lender_guidelines, gets inserted
// as a client_lender_assignments row already cleared for submission. The
// lender's terms (specialty / payment_type / min_funding / max_funding) are
// snapshotted from the guideline at insert time so subsequent guideline edits
// don't retroactively change historical reviews.
export async function POST(request: Request) {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return gate.response;
    const { advisor_id } = gate;

    const body = await request.json();
    const client_id: string | undefined = body?.client_id;
    const lender_guideline_id: string | undefined = body?.lender_guideline_id;
    const notes: string | undefined = body?.notes;

    if (!client_id || typeof client_id !== 'string') {
      return NextResponse.json({ error: 'client_id is required.' }, { status: 400 });
    }
    if (!lender_guideline_id || typeof lender_guideline_id !== 'string') {
      return NextResponse.json({ error: 'lender_guideline_id is required.' }, { status: 400 });
    }

    const { data: guideline, error: guideline_error } = await supabase_admin
      .from('lender_guidelines')
      .select('id, lender_name, specialty, tier_label, payment_type, min_funding, max_funding')
      .eq('id', lender_guideline_id)
      .single();
    if (guideline_error || !guideline) {
      return NextResponse.json({ error: 'Lender not found.' }, { status: 404 });
    }

    // One (client, lender) assignment at a time. A row that was REMOVED is
    // restored rather than refused: removal is now a one-click list operation,
    // so undoing a misclick has to be possible — and the old 409 made it
    // permanent, since the removed row also hides the lender from the picker.
    // Any other existing row is a genuine duplicate and still refused.
    const { data: existing } = await supabase_admin
      .from('client_lender_assignments')
      .select('id, admin_review, status')
      .eq('client_id', client_id)
      .eq('lender_name', guideline.lender_name)
      .maybeSingle();

    const now = new Date().toISOString();

    if (existing && existing.admin_review === 'rejected') {
      const { data: restored, error: restore_error } = await supabase_admin
        .from('client_lender_assignments')
        .update({
          admin_review: 'approved',
          admin_review_notes: notes ?? null,
          admin_reviewed_by: advisor_id,
          admin_reviewed_at: now,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select('*')
        .single();

      if (restore_error) {
        console.error('admin lender restore error:', restore_error);
        return NextResponse.json(
          { error: restore_error.message || 'Failed to restore lender.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, assignment: restored, restored: true });
    }

    if (existing) {
      return NextResponse.json(
        { error: `${guideline.lender_name} is already assigned to this client.` },
        { status: 409 }
      );
    }

    // Manual-adds land CLEARED — admin_review='approved' — so UW can submit
    // immediately. An admin adding a lender by hand IS the decision; making
    // them then approve their own addition through the Save Review batch was a
    // second click that expressed nothing, and it left the row indistinguishable
    // from a match awaiting sign-off.
    //
    // This matches the UW manual path (/api/lender-assignments/manual) and, as
    // of the same change, the match tool. decision='approved' because the
    // matching engine "would have" passed it (the admin overrode the algorithm);
    // admin_review is no longer a gate, only a veto — flipping it to 'rejected'
    // via PATCH still pulls the lender out.
    const { data: inserted, error: insert_error } = await supabase_admin
      .from('client_lender_assignments')
      .insert({
        client_id,
        lender_name: guideline.lender_name,
        specialty: guideline.specialty,
        tier_label: guideline.tier_label,
        payment_type: guideline.payment_type,
        min_funding: guideline.min_funding,
        max_funding: guideline.max_funding,
        decision: 'approved',
        source: 'admin_manual',
        status: 'pending',
        admin_review: 'approved',
        admin_reviewed_by: advisor_id,
        admin_reviewed_at: now,
        admin_review_notes: notes ?? null,
        assigned_at: now,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (insert_error) {
      console.error('manual lender-add insert error:', insert_error);
      return NextResponse.json(
        { error: insert_error.message || 'Failed to add lender.' },
        { status: 500 }
      );
    }

    // Tell UW here, because the row no longer passes through the PATCH batch.
    // It used to arrive as admin_review='pending' and get notified on the
    // pending → approved transition; now it lands approved, that transition
    // never happens, and without this the lender would be silently submittable
    // with nobody told it exists. Non-fatal, same as the PATCH path.
    notify_uw_of_approved_lenders(
      client_id,
      [guideline.lender_name],
      { [guideline.lender_name]: notes ?? null },
      advisor_id,
    ).catch((err) => console.error('UW notification dispatch failed (non-fatal):', err));

    return NextResponse.json({ success: true, assignment: inserted });
  } catch (err: any) {
    console.error('manual lender-add error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
