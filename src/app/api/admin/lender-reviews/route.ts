// src/app/api/admin/lender-reviews/route.ts
//
// Admin records per-lender review decisions on a client's lender-match results.
// Accepts a batch of { assignment_id, decision, notes } so the admin can mark
// several lenders in one round-trip from the in-profile review panel.
//
// AuthZ: caller must be authenticated AND have role = 'admin' in public.users.
// We resolve the reviewer's advisor_id from session and stamp it on every row
// so we know who made each call (admin_reviewed_by). admin_reviewed_at is
// stamped at write time.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/require-admin';

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
