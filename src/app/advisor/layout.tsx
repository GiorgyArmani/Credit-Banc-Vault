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
import { getAdvisorOnboardingState, syncAdvisorW9 } from '@/lib/advisor-onboarding'
import { AdvisorOnboardingScreen } from './_components/advisor-onboarding-screen'

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

  // ── Compliance gate for staff advisors (migration 20260903) ──────────────
  //
  // Same two documents the partner deal desk collects — a signed W-9 and a
  // voided check — because an advisor is paid on funded files too. The invite
  // signup already took name, phone, photo and password; this is the rest.
  //
  // A TAKEOVER, not a redirect: a layout cannot read the pathname, so a
  // redirect would fire on its own target and loop. Rendering the card in
  // place of `children` also means there is no half-open workspace to reach.
  //
  // Admins are exempt. Existing advisors were grandfathered by the migration.
  // If the migration is not applied yet the state read fails and returns
  // null, and the portal behaves exactly as before — no gate.
  if (role === 'advisor') {
    const advisor = await getAdvisorOnboardingState(user.id)
    if (advisor?.requires_onboarding) {
      // Catch-up: the webhook usually recorded the signature already; this
      // also fetches our PDF copy if SignWell was still rendering it then.
      let w9Signed = !!advisor.w9_signed_at
      if (advisor.w9_document_id && (!w9Signed || !advisor.w9_file_path)) {
        const { signed } = await syncAdvisorW9(advisor)
        w9Signed = signed
      }
      const firstName = advisor.name.trim().split(/\s+/)[0] || 'there'
      return (
        <AdvisorOnboardingScreen
          firstName={firstName}
          w9Signed={w9Signed}
          voidedCheckFilename={advisor.voided_check_filename}
        />
      )
    }
  }

  return <AdvisorShell>{children}</AdvisorShell>
}
