// src/app/affiliate/dashboard/layout.tsx
//
// Server-side affiliate gate + dashboard chrome. Wraps only /affiliate/dashboard/*
// so that the public /affiliate signup page (one level up) stays reachable by
// anyone. Affiliates are public partners who refer leads via a referral link and
// earn a fixed reward when a referral gets funded. See [[role_model]].
//
// admin can also reach it (admins bypass role guards everywhere).
// Defense-in-depth on top of the proxy gate at src/proxy.ts.

import { redirect } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/logout-button'

export default async function AffiliateDashboardLayout({ children }: { children: React.ReactNode }) {
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
  if (role !== 'affiliate' && role !== 'admin') {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink">
      <header className="sticky top-0 z-40 border-b border-black/5 bg-cb-cream/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* logo */}
          <Link href="/affiliate/dashboard" className="flex items-center group shrink-0">
            <Image
              src="/powered-by-shield.png"
              alt="Credit Banc — Powered by Shield Advisory Group"
              width={266}
              height={45}
              priority
              className="h-9 w-auto transition-transform group-hover:scale-105"
            />
          </Link>

          <LogoutButton />
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
