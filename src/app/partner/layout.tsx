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

import { redirect } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/logout-button'

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
  if (role !== 'referral_partner' && role !== 'admin') {
    redirect('/dashboard')
  }

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
    </div>
  )
}
