'use client'

import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Sidebar } from '@/components/layout/sidebar'
import { useProtectedRoute } from '@/hooks/use-protected-route'
import { usePathname } from 'next/navigation'
import OnboardingGate from '@/components/onboarding/onboarding-gate'
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
      '/dashboard': 'Finance Academy',
      '/dashboard/chat': 'AI Chat',
      '/dashboard/credit-report-assistant': 'Credit Report Assistant',
      '/dashboard/book-consultation': 'Book Consultation',
      '/dashboard/business-vault': 'Business Vault',
      '/dashboard/business-profile': 'Business Profile',
    }
    // normaliza al primer segmento importante, ej: /dashboard/credit-report-assistant/123
    const key = Object.keys(map).find(k => pathname?.startsWith(k))
    return key ? map[key] : 'Dashboard'
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
        {/* Topbar (solo mobile) */}
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
            <div className="w-10" />
          </div>
        </header>

        <main className="flex-1">
          <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <OnboardingGate>{children}</OnboardingGate>
          </div>
        </main>
      </div>
    </div>
  )
}
