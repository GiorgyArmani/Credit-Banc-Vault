// src/lib/auth/require-staff.ts
//
// Helper for API routes that admin OR underwriting may both call (e.g. moving
// a lender assignment from "approved by admin" to "submitted to lender" once
// UW physically sends the file out). Mirrors require-admin.ts in shape but
// accepts role ∈ {admin, underwriting}. Advisors are deliberately excluded —
// they don't run the matching or submission steps.
//
// Usage:
//   const gate = await requireStaff();
//   if (!gate.ok) return gate.response;
//   const { user, role } = gate;
//   ... rest of the handler ...

import { NextResponse } from 'next/server';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabase_admin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export type StaffRole = 'admin' | 'underwriting';

export type RequireStaffResult =
  | {
      ok: true;
      user: { id: string; email?: string };
      role: StaffRole;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export async function requireStaff(): Promise<RequireStaffResult> {
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

  const role = user_row?.role as string | undefined;
  if (role !== 'admin' && role !== 'underwriting') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Admin or underwriting role required.' },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    user: { id: user.id, email: user.email },
    role: role as StaffRole,
  };
}
