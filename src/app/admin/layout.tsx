// src/app/admin/layout.tsx
//
// Server-side admin gate. Runs before any /admin/* page renders. If the
// user isn't authenticated or doesn't have role='admin' in the users
// table, they're redirected here — no admin UI ever reaches the browser.
//
// This is defense-in-depth on top of the proxy gate at src/proxy.ts.
// If the proxy is ever bypassed (config drift, framework change, edge
// case), this server check still blocks non-admins.
//
// Interactive UI (sidebar collapse, mobile drawer, toaster) lives in
// _components/admin-shell.tsx as a client component.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdminShell } from './_components/admin-shell'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (userRow?.role !== 'admin') {
    redirect('/dashboard')
  }

  return <AdminShell>{children}</AdminShell>
}
