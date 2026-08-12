// src/components/workspace/workspace-shell.tsx
//
// The deal-working UI shell — sidebar, topbar, global search, notifications,
// profile photo, toaster. Shared by the advisor portal and the partner deal
// desk; only `basePath` and `roleLabel` differ.
//
// Auth and role gating happen in the parent SERVER layout, so this only renders
// for people already confirmed to belong here.
//
// Every surface in here is scoped to the caller's own book:
//   * GlobalSearch resolves the caller's advisors row and searches owned ∪
//     followed vaults only — it never sees the whole client base.
//   * NotificationBell filters on user_id.
//   * The sidebar links nowhere outside basePath.
// That is what makes it safe to hand to an external partner advisor. The
// database enforces the same bound independently via is_assigned_advisor_for().

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
import { ProfilePhotoButton } from '@/components/staff/profile-photo-button'

export function WorkspaceShell({
  children,
  basePath = '/advisor/dashboard',
  dashboardHref,
  roleLabel = 'Advisor',
  extraNavItems = [],
}: {
  children: React.ReactNode
  basePath?: string
  /** Where "Dashboard" points, when the portal's landing page isn't basePath
   *  itself. See the note on SidebarProps. */
  dashboardHref?: string
  roleLabel?: string
  extraNavItems?: { label: string; href: string; icon?: string }[]
}) {
  const pathname = usePathname()
  const homeHref = dashboardHref ?? basePath

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

  // Mobile topbar title.
  const currentTitle = useMemo(() => {
    const map: Record<string, string> = {
      [`${basePath}/pipeline`]: 'Pipeline',
      [`${basePath}/prospects`]: 'Prospects',
      [`${basePath}/clients`]: 'Clients',
      [homeHref]: `${roleLabel} Dashboard`,
    }
    // Longest prefix wins, so /clients/new doesn't resolve to the bare basePath.
    const key = Object.keys(map)
      .sort((a, b) => b.length - a.length)
      .find(k => pathname?.startsWith(k))
    return key ? map[key] : 'Dashboard'
  }, [pathname, basePath, homeHref, roleLabel])

  if (isEmbed) return <>{children}</>

  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(v => !v)}
        basePath={basePath}
        dashboardHref={homeHref}
        extraNavItems={extraNavItems}
      />

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
            <NotificationBell clientBasePath={`${basePath}/clients`} />
          </div>
          {/* Search row — desktop keeps it in the topbar; mobile gets its own row. */}
          <div className="px-3 pb-3">
            <GlobalSearch />
          </div>
        </header>

        {/* Topbar (Desktop) */}
        <header className="hidden md:flex sticky top-0 z-30 w-full px-8 py-3 h-16 bg-cb-cream dark:bg-slate-900 shadow-sm dark:shadow-none docked full-width no-border tonal-shift items-center justify-between">
          <div className="flex items-center gap-8 flex-1">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer">
              <NotificationBell clientBasePath={`${basePath}/clients`} />
            </div>

            <div className="h-8 w-px bg-slate-200 mx-2"></div>
            {/* Clicking this opens the photo picker. It's the only place an
                advisor or partner can set the picture their clients see on the
                "Your Advisor" card — which is why the website tour has a step
                pointing at this id. */}
            <div id="tour-profile-photo">
              <ProfilePhotoButton
                name={profile?.name ?? ''}
                photoUrl={profile?.avatarUrl ?? null}
                roleLabel={roleLabel}
              />
            </div>
          </div>
        </header>

        <main className="flex-1">
          <div className={clsx(
            "w-full mx-auto px-4 sm:px-6 lg:px-8 py-6",
            pathname === `${basePath}/pipeline` ? "max-w-[1800px]" : "max-w-7xl"
          )}>
            <OnboardingGate>{children}</OnboardingGate>
          </div>
        </main>
        <Toaster position="top-right" richColors />
      </div>
    </div>
  )
}
