// src/app/advisor/_components/advisor-shell.tsx
//
// Client-side UI shell for the advisor layout — sidebar, topbar, profile,
// onboarding gate, toaster. Auth/role gating happens in the parent server
// layout.tsx, so this only renders for confirmed advisors (or admins).

'use client'

import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Sidebar } from '@/components/layout/advisor/sidebar'
import { Toaster } from 'sonner'
import { usePathname } from 'next/navigation'
import OnboardingGate from '@/components/onboarding/onboarding-gate'
import { Menu } from 'lucide-react'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { createClient } from '@/lib/supabase/client'
import { GlobalSearch } from '@/components/layout/advisor/global-search'

export function AdvisorShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const isEmbed = pathname?.startsWith('/dashboard/embed/')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [profile, setProfile] = useState<{ name: string; avatarUrl: string | null } | null>(null)

  useEffect(() => {
    async function getProfile() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: advisorData } = await supabase
          .from('advisors')
          .select('first_name, last_name, profile_pic_url')
          .eq('user_id', user.id)
          .maybeSingle()

        if (advisorData) {
          setProfile({
            name: `${advisorData.first_name} ${advisorData.last_name}`,
            avatarUrl: advisorData.profile_pic_url
          })
        } else {
          // fallback to user metadata if advisor record not found
          const { data: userData } = await supabase
            .from('users')
            .select('first_name, last_name')
            .eq('id', user.id)
            .maybeSingle()

          if (userData) {
            setProfile({
              name: `${userData.first_name} ${userData.last_name}`,
              avatarUrl: null
            })
          }
        }
      }
    }
    getProfile()
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    const saved = typeof window !== 'undefined' && localStorage.getItem('sidebar_collapsed')
    setCollapsed(saved === '1')
  }, [])

  // Título dinámico para el topbar en mobile
  const currentTitle = useMemo(() => {
    const map: Record<string, string> = {
      '/advisor/dashboard': 'Advisor Dashboard',
      // '/dashboard/credit-report-assistant': 'Credit Report Assistant',
      '/dashboard/book-consultation': 'Book Consultation',
      '/dashboard/business-vault': 'Business Vault',
      '/dashboard/business-profile': 'Business Profile',
    }
    // normaliza al primer segmento importante, ej: /dashboard/credit-report-assistant/123
    const key = Object.keys(map).find(k => pathname?.startsWith(k))
    return key ? map[key] : 'Dashboard'
    // return 'Dashboard'
  }, [pathname])

  if (isEmbed) return <>{children}</>

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(v => !v)}
      />

      {/* Margen dinámico solo md+ */}
      <div className={clsx('flex min-h-screen flex-col', collapsed ? 'md:ml-16' : 'md:ml-64')}>
        {/* Topbar (Mobile) */}
        <header className="sticky top-0 z-30 bg-white border-b md:hidden">
          <div className="h-14 px-3 flex items-center justify-between">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open sidebar"
              className="inline-flex h-10 w-10 items-center justify-center rounded hover:bg-gray-100"
            >
              <Menu className="h-6 w-6" />
            </button>
            <div className="text-sm font-medium text-gray-700">{currentTitle}</div>
            <NotificationBell />
          </div>
        </header>

        {/* Topbar (Desktop) */}
        <header className="hidden md:flex sticky top-0 z-30 w-full px-8 py-3 h-16 bg-slate-50 dark:bg-slate-900 shadow-sm dark:shadow-none docked full-width no-border tonal-shift items-center justify-between">
          <div className="flex items-center gap-8 flex-1">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer">
              <NotificationBell />
            </div>

            <div className="h-8 w-px bg-slate-200 mx-2"></div>
            <div className="flex items-center gap-3">
              {profile?.avatarUrl ? (
                <img
                  className="h-9 w-9 rounded-full object-cover border-2 border-primary-container"
                  alt="Advisor"
                  src={profile.avatarUrl}
                />
              ) : (
                <div className="h-9 w-9 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold border-2 border-primary-container">
                  {profile?.name ? profile.name.split(' ').map(n => n[0]).join('') : 'A'}
                </div>
              )}
              <div className="hidden lg:block">
                <p className="text-xs font-bold leading-none text-slate-900 dark:text-slate-100">{profile?.name || 'Loading...'}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-tighter">Advisor</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <div className={clsx(
            "w-full mx-auto px-4 sm:px-6 lg:px-8 py-6",
            pathname === '/advisor/dashboard/pipeline' ? "max-w-[1800px]" : "max-w-7xl"
          )}>
            <OnboardingGate>{children}</OnboardingGate>
          </div>
        </main>
        <Toaster position="top-right" richColors />
      </div>
    </div>
  )
}
