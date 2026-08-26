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
import { getPartnerOnboardingState, syncPartnerW9 } from '@/lib/partner-onboarding'
import { isValidUsPhone } from '@/lib/phone'
import { PartnerOnboardingScreen } from './welcome/_components/partner-onboarding-screen'

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

  // ── Compliance gate for partner_advisor (migration 20260825) ─────────────
  //
  // A partner who works their own deals is a payee we report on, so the desk
  // stays shut until they have signed a W-9 and told us where to send the
  // money — and until they have given us a number, because their clients see
  // them as their advisor and the client portal puts that number on the contact
  // card. Enforced HERE, at the root of /partner, because it is the one place
  // every deal-desk URL passes through.
  //
  // A TAKEOVER, not a redirect. A layout cannot read the pathname, so
  // `redirect('/partner/welcome')` would fire on /partner/welcome as well and
  // loop forever. Rendering the onboarding screen in place of `children` has no
  // such edge, and it also means there is no half-open desk to click into.
  //
  // Admins are exempt — they have no referral_partners row, and bouncing an
  // admin into a partner welcome screen would be absurd.
  if (role === 'partner_advisor') {
    const partner = await getPartnerOnboardingState(user.id)
    if (partner?.requires_onboarding) {
      // Same catch-up sync the welcome page does: no webhook backs the W-9, so
      // a page load is what notices a partner who signed and closed the tab.
      let w9Signed = !!partner.w9_signed_at
      if (!w9Signed && partner.w9_document_id) {
        const { signed } = await syncPartnerW9(partner)
        w9Signed = signed
      }

      // One more read is not worth it: if that sync just completed the W-9 the
      // partner still owes a voided check, or they would not be in here.
      const firstName = (partner.name || '').trim().split(/\s+/)[0] || 'there'

      return (
        <div className="min-h-screen bg-cb-cream font-body text-cb-ink">
          <header className="sticky top-0 z-40 border-b border-black/5 bg-cb-cream/80 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
              <Image
                src="/powered-by-shield.png"
                alt="Credit Banc — Powered by Shield Advisory Group"
                width={266}
                height={45}
                priority
                className="h-9 w-auto"
              />
              <LogoutButton />
            </div>
          </header>
          <main>
            <PartnerOnboardingScreen
              email={user.email ?? ''}
              firstName={firstName}
              isDealDesk
              passwordSet={!!partner.password_set_at}
              phone={partner.phone}
              phoneSet={isValidUsPhone(partner.phone)}
              w9Signed={w9Signed}
              voidedCheckFilename={partner.voided_check_filename}
            />
          </main>
          <Toaster position="top-right" richColors />
        </div>
      )
    }
  }

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
