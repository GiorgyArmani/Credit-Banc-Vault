// src/lib/auth/require-admin.ts
//
// Helper for admin-only API routes. Centralizes the auth + role + advisor-row
// lookup so each route doesn't repeat ~30 lines of boilerplate (and so it's
// harder to forget the role check on a new admin endpoint).
//
// Usage in a route handler:
//   const gate = await requireAdmin();
//   if (!gate.ok) return gate.response;
//   const { user, advisor_id } = gate;
//   ... rest of the handler ...
//
// Returns either { ok: true, user, advisor_id } or { ok: false, response }
// where `response` is a ready-to-return NextResponse with the right status.

import { NextResponse } from 'next/server';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabase_admin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export type RequireAdminResult =
  | {
      ok: true;
      user: { id: string; email?: string };
      advisor_id: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401 }
      ),
    };
  }

  const { data: user_row } = await supabase_admin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (user_row?.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Admin role required.' },
        { status: 403 }
      ),
    };
  }

  const { data: advisor_row } = await supabase_admin
    .from('advisors')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!advisor_row) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'No advisors row linked to the current admin user.' },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    user: { id: user.id, email: user.email },
    advisor_id: advisor_row.id,
  };
}
