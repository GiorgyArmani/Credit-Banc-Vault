// src/app/partner/layout.tsx
//
// Server-side gate + chrome for the Level-2 referral-partner portal (CPAs,
// bankers, professionals who refer clients and earn a commission).
//
// Sits at the ROOT of /partner, not on /dashboard, so it also covers
// /partner/welcome — the set-password step a partner lands on from their invite
// link. A partner mid-onboarding is already authenticated (the magic link gave
// them a session), so that page needs the same gate as everything else.
//
// Invite-only: unlike /affiliate, there is no public signup page, so the whole
// tree is role-gated in src/proxy.ts too. This is the defense-in-depth re-check
// — the proxy reads a role as well, but a layout that trusts it would leak the
// whole book of business on a single proxy regression.
//
// admin can reach it (admins bypass role guards everywhere). See [[role_model]].
//
// Two roles live here. `referral_partner` gets the read-only referral book.
// `partner_advisor` is the same person with the DEAL DESK enabled: they also
// work the deals they refer, through the same advisor components the staff
// portal uses. The whole deal desk is mounted under /partner rather than
// admitting them to /advisor, which keeps the advisor tree sealed to staff.

import { redirect } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/logout-button'
import { Toaster } from 'sonner'
import { PartnerDealDeskShell } from './_components/partner-deal-desk-shell'
import { isExternalAdvisor } from '@/lib/auth/roles'

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
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
  if (role !== 'referral_partner' && role !== 'partner_advisor' && role !== 'admin') {
    redirect('/dashboard')
  }

  // Admins get the deal desk too, so they can walk the partner experience end to
  // end when supporting one. Their own access is unaffected either way.
  const hasDealDesk = isExternalAdvisor(role) || role === 'admin'

  // A partner who works deals gets the full workspace chrome — the SAME sidebar,
  // global search and notifications the advisor portal has, pointed at /partner.
  // It brings its own Toaster and layout, so it replaces the simple header
  // rather than nesting inside it.
  if (hasDealDesk) {
    return <PartnerDealDeskShell>{children}</PartnerDealDeskShell>
  }

  // Referrals-only: a single read-only page. A sidebar with one destination on
  // it would be noise, so this keeps the light brand chrome.
  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink">
      <header className="sticky top-0 z-40 border-b border-black/5 bg-cb-cream/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Link href="/partner/dashboard" className="flex items-center group shrink-0">
            <Image
              src="/powered-by-shield.png"
              alt="Credit Banc — Powered by Shield Advisory Group"
              width={266}
              height={45}
              priority
              className="h-9 w-auto transition-transform group-hover:scale-105"
            />
          </Link>

          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-[0.18em] text-cb-gray">
              Referral Partner
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main>{children}</main>
      <Toaster position="top-right" richColors />
    </div>
  )
}
