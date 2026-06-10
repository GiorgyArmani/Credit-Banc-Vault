// src/app/api/lender-assignments/[id]/submit/route.ts
//
// PATCH /api/lender-assignments/[id]/submit
//   Marks an admin-approved lender assignment as submitted to the lender —
//   the signal that UW has physically pushed the deal out and we're now
//   waiting on the lender's approval.
//
// Transition: status='pending' → status='submitted'. Refused if:
//   • the row doesn't exist
//   • decision is not 'approved' (matcher rejected the lender)
//   • admin_review is not 'approved' (admin hasn't cleared it for outreach)
//   • status is not 'pending' (already submitted, or beyond)
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireStaff } from '@/lib/auth/require-staff';
import { slackPostMessage } from '@/lib/slack-api';
import { notifyAdminsOfLenderPipelineEvent } from '@/lib/notifications/lender-pipeline';

const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing assignment id.' }, { status: 400 });
    }

    const { data: existing, error: fetch_error } = await supabase_admin
      .from('client_lender_assignments')
      .select('id, client_id, lender_name, decision, admin_review, status')
      .eq('id', id)
      .maybeSingle();

    if (fetch_error) {
      console.error('lender-assignment submit fetch error:', fetch_error);
      return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }
    if (existing.decision !== 'approved') {
      return NextResponse.json(
        { error: 'Assignment was not approved by the matching engine.' },
        { status: 409 }
      );
    }
    if (existing.admin_review !== 'approved') {
      return NextResponse.json(
        { error: 'Admin has not approved this lender for outreach yet.' },
        { status: 409 }
      );
    }
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: `Assignment status is already "${existing.status}".` },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const { data: updated, error: update_error } = await supabase_admin
      .from('client_lender_assignments')
      .update({ status: 'submitted', updated_at: now })
      .eq('id', id)
      .select('*')
      .single();

    if (update_error) {
      console.error('lender-assignment submit update error:', update_error);
      return NextResponse.json({ error: update_error.message }, { status: 500 });
    }

    // Trigger #1: notify admins that this specific lender was just submitted
    // (in-app + email + Slack). Fire-and-forget — never block the transition.
    void notifyAdminsOfLenderPipelineEvent(
      {
        id: existing.id,
        client_id: (existing as any).client_id,
        lender_name: (existing as any).lender_name,
        specialty: (updated as any)?.specialty ?? null,
      },
      'submitted'
    ).catch((e) => console.error('submit notify error (non-fatal):', e));

    // Trigger #2: if EVERY admin-approved lender for this client is now out the
    // door (status submitted / approved_by_lender / funded), post a Slack
    // summary into the deal channel. Fire-and-forget, only if a channel exists.
    try {
      const client_id = (existing as any).client_id as string | null;
      if (client_id) {
        const { data: all_approved } = await supabase_admin
          .from('client_lender_assignments')
          .select('lender_name, status')
          .eq('client_id', client_id)
          .eq('admin_review', 'approved');

        const rows = all_approved ?? [];
        const OUT = new Set(['submitted', 'approved_by_lender', 'funded']);
        const all_out = rows.length > 0 && rows.every((r: any) => OUT.has(r.status));

        if (all_out) {
          const { data: vault } = await supabase_admin
            .from('client_data_vault')
            .select('slack_channel_id, company_name')
            .eq('id', client_id)
            .maybeSingle();

          const channel_id = (vault as any)?.slack_channel_id as string | null;
          if (channel_id) {
            const lender_list = rows.map((r: any) => `• ${r.lender_name}`).join('\n');
            const text =
              `✅ This file has been submitted to all approved lenders` +
              `${(vault as any)?.company_name ? ` for ${(vault as any).company_name}` : ''}.\n${lender_list}`;
            await slackPostMessage(channel_id, text);
          }
        }
      }
    } catch (slack_err) {
      console.error('lender-assignment submit Slack notify error (non-fatal):', slack_err);
    }

    return NextResponse.json({ success: true, assignment: updated });
  } catch (err: any) {
    console.error('lender-assignment submit error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
