// src/app/admin/_components/admin-shell.tsx
//
// Client-side UI shell for the admin layout — sidebar collapse state,
// mobile drawer, topbar with title + search + notifications, toaster.
// Auth/role gating is done in the parent server layout.tsx, so this
// component assumes it only renders for confirmed admin users.

'use client'

import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Sidebar } from '@/components/layout/admin/sidebar'
import { Toaster } from 'sonner'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { GlobalSearch } from '@/components/layout/admin/global-search'

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    const saved = typeof window !== 'undefined' && localStorage.getItem('sidebar_collapsed_admin')
    setCollapsed(saved === '1')
  }, [])

  const currentTitle = useMemo(() => {
    const map: Record<string, string> = {
      '/admin/dashboard': 'Admin Portal',
      '/admin/uw/dashboard': 'Review Queue',
      '/admin/uw/bank-analysis': 'Bank Analysis',
      '/admin/uw/lender-match': 'Lender Match',
      '/admin/uw/lender-guidelines': 'Lender Database',
      '/admin/pipeline': 'Pipeline',
      '/admin/prospects': 'Prospects',
      '/admin/clients': 'Clients',
      '/admin/affiliates': 'Affiliates',
    }
    const key = Object.keys(map).find(k => pathname?.startsWith(k))
    return key ? map[key] : 'Admin'
  }, [pathname])

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(v => !v)}
      />

      <div className={clsx('flex min-h-screen flex-col', collapsed ? 'md:ml-20' : 'md:ml-72')}>
        {/* Topbar (Mobile) */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 md:hidden">
          <div className="h-14 px-3 flex items-center justify-between">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open sidebar"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl hover:bg-slate-100 transition-colors"
            >
              <Menu className="h-6 w-6 text-slate-600" />
            </button>
            <div className="text-sm font-black text-slate-900 uppercase tracking-widest">{currentTitle}</div>
            <NotificationBell clientBasePath="/admin/clients" />
          </div>
          {/* Search row — desktop keeps it in the topbar; mobile gets its own row. */}
          <div className="px-3 pb-3">
            <GlobalSearch />
          </div>
        </header>

        {/* Topbar (Desktop) */}
        <header className="hidden md:flex sticky top-0 z-30 w-full px-8 py-3 h-16 bg-white border-b border-slate-200 shadow-sm items-center justify-between gap-6">
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs font-black uppercase tracking-[0.2em] text-emerald-500">
              {currentTitle}
            </span>
          </div>
          <div className="flex-1 flex justify-center">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <NotificationBell clientBasePath="/admin/clients" />
          </div>
        </header>

        <main className="flex-1 bg-slate-50">
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </div>
        </main>
        <Toaster position="top-right" richColors />
      </div>
    </div>
  )
}
