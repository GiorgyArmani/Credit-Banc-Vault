// src/app/api/lender-assignments/[id]/response/route.ts
//
// PATCH /api/lender-assignments/[id]/response
//   Records where a submitted file stands with the lender — the signal that UW
//   heard back. Drives the row between the post-submission lifecycle states,
//   which the admin portal mirrors on its Lender Match — Admin Review card.
//
// Body: { status: 'submitted' | 'approved_by_lender' | 'declined_by_lender' }
//   UW picks this from a dropdown, so any of these may follow any other (e.g.
//   correcting a misclick back to "awaiting lender"). Refused if the row
//   doesn't exist or hasn't been submitted yet — you can't record a lender
//   response before the file was pushed out (use the /submit route first).
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireStaff } from '@/lib/auth/require-staff';
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

    const { data: existing, error: fetch_error } = await supabase_admin
      .from('client_lender_assignments')
      .select('id, client_id, lender_name, specialty, status')
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

    // No-op if the status isn't actually changing.
    if (existing.status === next_status) {
      return NextResponse.json({ success: true, assignment: existing, unchanged: true });
    }

    const now = new Date().toISOString();
    const { data: updated, error: update_error } = await supabase_admin
      .from('client_lender_assignments')
      .update({ status: next_status, updated_at: now })
      .eq('id', id)
      .select('*')
      .single();

    if (update_error) {
      console.error('lender-assignment response update error:', update_error);
      return NextResponse.json({ error: update_error.message }, { status: 500 });
    }

    // Notify admins (in-app + email + Slack) so the admin portal status stays
    // in sync. Fire-and-forget — never block the transition.
    void notifyAdminsOfLenderPipelineEvent(
      {
        id: existing.id,
        client_id: (existing as any).client_id,
        lender_name: (existing as any).lender_name,
        specialty: (existing as any).specialty ?? null,
      },
      next_status as LenderPipelineEvent
    ).catch((e) => console.error('response notify error (non-fatal):', e));

    return NextResponse.json({ success: true, assignment: updated });
  } catch (err: any) {
    console.error('lender-assignment response error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
