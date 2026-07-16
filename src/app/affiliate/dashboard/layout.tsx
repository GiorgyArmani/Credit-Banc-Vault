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
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/logout-button'
import { Gift } from 'lucide-react'

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
    <div className="min-h-screen bg-emerald-50/30">
      <header className="border-b border-emerald-100 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center">
              <Gift className="w-5 h-5" />
            </div>
            <span className="font-black uppercase tracking-tight text-emerald-950">
              Affiliate Dashboard
            </span>
          </div>
          <LogoutButton />
        </div>
      </header>
      <main>{children}</main>
    </div>
  )
}
