'use client'

import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Sidebar } from '@/components/layout/sidebar'
import { useProtectedRoute } from '@/hooks/use-protected-route'
import { usePathname } from 'next/navigation'
import OnboardingGate from '@/components/onboarding/onboarding-gate'

import { NotificationBell } from '@/components/notifications/NotificationBell'
import { Menu } from 'lucide-react'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  useProtectedRoute()
  const pathname = usePathname()

  const isEmbed = pathname?.startsWith('/dashboard/embed/')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

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
      '/dashboard/business-vault': 'Business Vault',
    }
    // normaliza al primer segmento importante, ej: /dashboard/credit-report-assistant/123
    // const key = Object.keys(map).find(k => pathname?.startsWith(k))
    // return key ? map[key] : 'Dashboard'
    return 'Dashboard'
  }, [pathname])

  if (isEmbed) return <>{children}</>

  return (
    <OnboardingGate>
      <div className="min-h-screen bg-gray-50">
        <Sidebar
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(v => !v)}
        />

        {/* Margen dinámico solo md+ */}
        <div className={clsx('flex min-h-screen flex-col', collapsed ? 'md:ml-16' : 'md:ml-64')}>
          {/* Topbar (Mobile & Desktop) */}
          <header className="sticky top-0 z-30 bg-white border-b">
            <div className="h-14 px-4 flex items-center justify-between">
              {/* Mobile Menu Button */}
              <div className="flex items-center gap-3 md:hidden">
                <button
                  onClick={() => setMobileOpen(true)}
                  aria-label="Open sidebar"
                  className="inline-flex h-9 w-9 items-center justify-center rounded hover:bg-gray-100"
                >
                  <Menu className="h-5 w-5 text-gray-600" />
                </button>
                <div className="text-sm font-semibold text-gray-800">{currentTitle}</div>
              </div>

              {/* Desktop Search/Spacer */}
              <div className="hidden md:block">
                {/* Desktop header title removed per request */}
              </div>

              {/* Action Icons */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase tracking-wider hidden sm:block">Client Portal</div>
                  <div className="h-4 w-px bg-gray-200 hidden sm:block mx-1"></div>
                  <NotificationBell />
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1">
            <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </OnboardingGate>
  )
}
