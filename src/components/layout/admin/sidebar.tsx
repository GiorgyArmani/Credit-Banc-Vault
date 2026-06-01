// src/components/layout/admin/sidebar.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  LogOut,
  X,
  ChevronsLeft,
  ChevronsRight,
  ShieldCheck,
  BarChart3,
  Search,
  Database,
  Users,
  LayoutGrid,
  UserCog,
  ChevronDown,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import clsx from 'clsx'

type SidebarProps = {
  mobileOpen?: boolean
  onMobileClose?: () => void
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

const uwNavItems = [
  { label: 'Review Queue', href: '/admin/uw/dashboard', icon: LayoutDashboard },
  { label: 'Bank Analysis', href: '/admin/uw/bank-analysis', icon: BarChart3 },
  { label: 'Lender Match', href: '/admin/uw/lender-match', icon: Search },
  { label: 'Lender Database', href: '/admin/uw/lender-guidelines', icon: Database },
]

const advisorNavItems = [
  { label: 'Pipeline', href: '/admin/pipeline', icon: LayoutGrid },
  { label: 'Prospects', href: '/admin/prospects', icon: Users },
  { label: 'Clients', href: '/admin/clients', icon: ShieldCheck },
]

export function Sidebar({
  mobileOpen = false,
  onMobileClose,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const pathname = usePathname()
  const supabase = createClient()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [uwOpen, setUwOpen] = useState(true)
  const [advOpen, setAdvOpen] = useState(true)

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

  return (
    <>
      {/* Overlay (mobile) */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm transition-opacity md:hidden ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onMobileClose}
      />

      {/* Sidebar */}
      <aside
        aria-label="Admin sidebar navigation"
        className={clsx(
          'fixed left-0 top-0 z-50 flex h-dvh md:h-screen flex-col',
          'bg-white border-r border-slate-200 shadow-xl',
          'transition-all duration-300 ease-in-out overflow-y-auto overflow-x-hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
          collapsed ? 'md:w-20 w-72' : 'md:w-72 w-72',
        )}
      >
        {/* Header / Branding */}
        <div className="px-5 py-7 border-b border-slate-100 relative">
          <div className={clsx('flex items-center gap-3', collapsed && 'md:justify-center')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            {!collapsed && (
              <div className="transition-all duration-300">
                <h2 className="text-base font-black text-slate-900 leading-tight">Admin Portal</h2>
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Credit Banc</p>
              </div>
            )}
          </div>

          <button
            onClick={onMobileClose}
            className="md:hidden absolute right-4 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-slate-100 transition-colors"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Admin Home */}
        <nav className="px-3 pt-4 space-y-1">
          <Link href="/admin/dashboard" onClick={onMobileClose} title={collapsed ? 'Admin Home' : undefined}>
            <div className={clsx(
              'flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 cursor-pointer',
              pathname === '/admin/dashboard'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            )}>
              <ShieldCheck className={clsx('h-5 w-5 shrink-0', pathname === '/admin/dashboard' ? 'text-emerald-500' : '')} />
              {!collapsed && <span className="text-sm font-semibold">Admin Home</span>}
            </div>
          </Link>
        </nav>

        {/* Underwriting Section */}
        <div className="px-3 pt-5">
          {!collapsed ? (
            <button
              onClick={() => setUwOpen(v => !v)}
              className="w-full flex items-center justify-between px-3 py-1.5 mb-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
            >
              <span className="text-[10px] font-black uppercase tracking-widest">Underwriting</span>
              <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform duration-200', uwOpen ? 'rotate-0' : '-rotate-90')} />
            </button>
          ) : (
            <div className="h-px bg-slate-100 mx-1 my-3" />
          )}
          <div className={clsx('space-y-1', !collapsed && !uwOpen && 'hidden')}>
            {uwNavItems.map(({ href, label, icon: Icon }) => {
              const active = pathname?.startsWith(href)
              return (
                <Link href={href} key={href} onClick={onMobileClose} title={collapsed ? label : undefined}>
                  <div className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer',
                    active
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  )}>
                    <Icon className={clsx('h-4 w-4 shrink-0', active ? 'text-emerald-400' : '')} />
                    {!collapsed && <span className="text-sm font-medium">{label}</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Advisor Section */}
        <div className="px-3 pt-4">
          {!collapsed ? (
            <button
              onClick={() => setAdvOpen(v => !v)}
              className="w-full flex items-center justify-between px-3 py-1.5 mb-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
            >
              <span className="text-[10px] font-black uppercase tracking-widest">Advisor</span>
              <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform duration-200', advOpen ? 'rotate-0' : '-rotate-90')} />
            </button>
          ) : (
            <div className="h-px bg-slate-100 mx-1 my-3" />
          )}
          <div className={clsx('space-y-1', !collapsed && !advOpen && 'hidden')}>
            {advisorNavItems.map(({ href, label, icon: Icon }) => {
              const active = pathname === href
              return (
                <Link href={href} key={href} onClick={onMobileClose} title={collapsed ? label : undefined}>
                  <div className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer',
                    active
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                  )}>
                    <Icon className={clsx('h-4 w-4 shrink-0', active ? 'text-emerald-400' : '')} />
                    {!collapsed && <span className="text-sm font-medium">{label}</span>}
                  </div>
                </Link>
              )
            })}
            {/* New Funding shortcut */}
            {!collapsed && (
              <Link href="/admin/clients/new" onClick={onMobileClose}>
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-all duration-200 cursor-pointer">
                  <span className="material-symbols-outlined text-[18px] text-emerald-500">add_circle</span>
                  <span className="text-sm font-medium">New Funding</span>
                </div>
              </Link>
            )}
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Footer */}
        <div className="px-3 pb-6 pt-4 border-t border-slate-100">
          <div className={clsx('flex items-center gap-3 mb-3', collapsed && 'md:flex-col md:gap-2')}>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
              <UserCog className="h-4 w-4 text-emerald-500" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">{userEmail?.split('@')[0] || 'Admin'}</p>
                <Badge className="bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest border border-emerald-100 mt-0.5">Admin</Badge>
              </div>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className={clsx(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-all duration-200 group',
              collapsed && 'md:justify-center'
            )}
          >
            <LogOut className="h-4 w-4 transition-transform group-hover:-translate-x-1 shrink-0" />
            {!collapsed && <span className="text-sm font-medium">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Toggle Button (Desktop Only) */}
      <button
        onClick={() => {
          onToggleCollapsed?.()
          localStorage.setItem('sidebar_collapsed_admin', !collapsed ? '1' : '0')
        }}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="hidden md:flex fixed z-[60] h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all duration-300 ease-in-out active:scale-90"
        style={{ bottom: 100, left: collapsed ? 60 : 268 }}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
      </button>
    </>
  )
}
