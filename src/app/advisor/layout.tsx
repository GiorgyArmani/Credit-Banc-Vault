// src/app/advisor/layout.tsx
//
// Server-side advisor gate. Runs before any /advisor/* page renders. If the
// user isn't authenticated or doesn't have role='advisor' (or 'admin', which
// can access everywhere), they're redirected — no advisor UI ever reaches
// the browser.
//
// Defense-in-depth on top of the proxy gate at src/proxy.ts.
//
// Interactive UI lives in _components/advisor-shell.tsx as a client component.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdvisorShell } from './_components/advisor-shell'

export default async function AdvisorLayout({ children }: { children: React.ReactNode }) {
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

  const role = userRow?.role
  if (role !== 'advisor' && role !== 'admin') {
    redirect('/dashboard')
  }

  return <AdvisorShell>{children}</AdvisorShell>
}
