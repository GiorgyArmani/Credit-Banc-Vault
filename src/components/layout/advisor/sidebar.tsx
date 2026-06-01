//src/components/layout/advisor/sidebar.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  MessageSquare,
  TrendingUp,
  FileSearch,
  Calendar,
  LogOut,
  User,
  BookMarked,
  X,
  ChevronsLeft,
  ChevronsRight,
  BookCheck,
  Users,
  LayoutGrid,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import clsx from 'clsx'

type SidebarProps = {
  mobileOpen?: boolean
  onMobileClose?: () => void
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

export function Sidebar({
  mobileOpen = false,
  onMobileClose,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const pathname = usePathname()
  const supabase = createClient()
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setUserEmail(user.email)
    })
  }, [supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    localStorage.clear()
    sessionStorage.clear()
    window.location.href = '/'
  }

  const navItems = [
    { label: 'Dashboard', href: '/advisor/dashboard', icon: BookCheck },
    { label: 'Pipeline', href: '/advisor/dashboard/pipeline', icon: LayoutGrid },
    { label: 'Prospects', href: '/advisor/dashboard/prospects', icon: Users },
    { label: 'Clients', href: '/advisor/dashboard/clients', icon: Users },
  ]

  // Ancho: en mobile siempre w-72; en desktop depende de "collapsed"
  const desktopWidth = collapsed ? 'md:w-20' : 'md:w-72'

  return (
    <>
      {/* Overlay (mobile) */}
      <div
        className={`fixed inset-0 z-40 bg-emerald-950/40 backdrop-blur-sm transition-opacity md:hidden ${mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        onClick={onMobileClose}
      />

      {/* Sidebar */}
      <aside
        aria-label="Sidebar navigation"
        className={[
          'fixed left-0 top-0 z-50 flex h-dvh md:h-screen w-64 flex-col bg-emerald-950 dark:bg-slate-950 text-emerald-50 dark:text-emerald-400 border-r border-white/5 shadow-2xl transition-all duration-300 ease-in-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
          collapsed ? 'md:w-20' : 'md:w-64',
        ].join(' ')}
      >
        {/* Branding */}
        <div className="px-6 py-8 mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl editorial-gradient flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>account_balance</span>
            </div>
            {!collapsed && (
              <div className="transition-all duration-300">
                <h2 className="text-lg font-black text-white dark:text-emerald-500 font-headline leading-tight">Advisor Dashboard</h2>
                <p className="text-[10px] uppercase tracking-widest opacity-60 font-manrope">Credit Banc</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            const iconName =
              label === 'Dashboard' ? 'dashboard'
              : label === 'Pipeline' ? 'account_tree'
              : label === 'Prospects' ? 'person_search'
              : label === 'Clients' ? 'verified_user'
              : 'group'

            return (
              <Link href={href} key={href} onClick={onMobileClose} title={collapsed ? label : undefined}>
                <div className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer active:scale-95 transform',
                  active
                    ? 'bg-gradient-to-br from-emerald-800 to-emerald-700 text-white shadow-lg shadow-emerald-950/40'
                    : 'text-emerald-200/70 hover:text-white hover:bg-emerald-900/50'
                )}>
                  <span className="material-symbols-outlined">{iconName}</span>
                  {!collapsed && <span className="font-manrope text-sm font-medium">{label}</span>}
                </div>
              </Link>
            )
          })}

          <div className="pt-4 px-3">
            <Link href="/advisor/dashboard/clients/new">
              <button className={clsx(
                "w-full editorial-gradient text-white rounded-xl py-3 px-4 font-bold shadow-lg shadow-primary/20 flex items-center justify-center gap-2 active:scale-95 transition-transform",
                collapsed ? "px-0" : ""
              )}>
                <span className="material-symbols-outlined text-lg">add</span>
                {!collapsed && <span>New Funding</span>}
              </button>
            </Link>
          </div>
        </nav>

        {/* Footer */}
        <footer className="pt-6 border-t border-emerald-900/30 px-3 pb-8">

          <div
            onClick={handleSignOut}
            className="text-emerald-200/70 hover:text-white px-4 py-3 rounded-xl hover:bg-emerald-900/50 transition-all duration-200 cursor-pointer active:scale-95 transform flex items-center gap-3"
          >
            <span className="material-symbols-outlined">logout</span>
            {!collapsed && <span className="font-manrope text-sm font-medium">Sign Out</span>}
          </div>
        </footer>
      </aside>

      {/* Toggle Button (Desktop Only) */}
      <button
        onClick={() => {
          const next = !collapsed
          onToggleCollapsed?.()
          localStorage.setItem('sidebar_collapsed', next ? '1' : '0')
        }}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="hidden md:flex fixed z-50 h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all duration-300 ease-in-out active:scale-90"
        style={{ bottom: 100, left: collapsed ? 60 : 236 }}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
      </button>
    </>
  )
}
