// src/app/underwriting/_components/underwriting-shell.tsx
//
// Client-side UI shell for the underwriting layout — sidebar, topbar, toaster.
// Auth/role gating happens in the parent server layout.tsx, so this only
// renders for confirmed underwriting users (or admins).

'use client'

import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Sidebar } from '@/components/layout/underwriting/sidebar'
import { Toaster } from 'sonner'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { GlobalSearch } from '@/components/layout/underwriting/global-search'
import { createClient } from '@/lib/supabase/client'

export function UnderwritingShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()

    const [mobileOpen, setMobileOpen] = useState(false)
    const [collapsed, setCollapsed] = useState(false)
    const [name, setName] = useState<string | null>(null)

    // Who is signed in, for the topbar chip. Underwriters have no advisors row
    // (and no client-facing photo), so this reads public.users only; the email
    // prefix is the fallback for an account without a name on file.
    useEffect(() => {
        async function getName() {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const { data } = await supabase
                .from('users')
                .select('first_name, last_name')
                .eq('id', user.id)
                .maybeSingle()
            const full = `${data?.first_name ?? ''} ${data?.last_name ?? ''}`.trim()
            setName(full || user.email?.split('@')[0] || 'Underwriter')
        }
        getName()
    }, [])

    useEffect(() => {
        setMobileOpen(false)
    }, [pathname])

    useEffect(() => {
        const saved = typeof window !== 'undefined' && localStorage.getItem('sidebar_collapsed_uw')
        setCollapsed(saved === '1')
    }, [])

    const currentTitle = useMemo(() => {
        const map: Record<string, string> = {
            '/underwriting/dashboard': 'Review Queue',
            '/underwriting/bank-analysis': 'Bank Analysis',
            '/underwriting/lender-match': 'Lender Match',
            '/underwriting/lender-guidelines': 'Lender Guidelines',
            '/underwriting/loan-types': 'Loan Types',
        }
        const key = Object.keys(map).find(k => pathname?.startsWith(k))
        return key ? map[key] : 'Underwriting'
    }, [pathname])

    return (
        <div className="min-h-screen bg-cb-cream font-body text-cb-ink">
            <Sidebar
                mobileOpen={mobileOpen}
                onMobileClose={() => setMobileOpen(false)}
                collapsed={collapsed}
                onToggleCollapsed={() => setCollapsed(v => !v)}
            />

            {/* Dynamic margin for sidebar */}
            <div className={clsx('flex min-h-screen flex-col', collapsed ? 'md:ml-20' : 'md:ml-72')}>
                {/* Topbar (Mobile) */}
                <header className="sticky top-0 z-30 bg-white border-b md:hidden">
                    <div className="h-14 px-3 flex items-center justify-between">
                        <button
                            onClick={() => setMobileOpen(true)}
                            aria-label="Open sidebar"
                            className="inline-flex h-10 w-10 items-center justify-center rounded hover:bg-slate-100"
                        >
                            <Menu className="h-6 w-6 text-slate-600" />
                        </button>
                        <div className="text-sm font-bold text-slate-900 uppercase tracking-widest">{currentTitle}</div>
                        <NotificationBell clientBasePath="/underwriting/dashboard/clients" />
                    </div>
                    {/* Search row — desktop keeps it in the topbar; mobile gets its own row. */}
                    <div className="px-3 pb-3">
                        <GlobalSearch />
                    </div>
                </header>

                {/* Topbar (Desktop) */}
                <header className="hidden md:flex sticky top-0 z-30 w-full px-8 py-3 h-16 bg-cb-cream border-b border-black/5 shadow-sm items-center justify-between transition-all">
                    <div className="flex items-center gap-8 flex-1">
                        <GlobalSearch />
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-slate-200 transition-colors cursor-pointer">
                            <NotificationBell clientBasePath="/underwriting/dashboard/clients" />
                        </div>
                        {/* Same chip the admin topbar shows, minus the photo
                            picker — that photo is the client-facing advisor one. */}
                        {name && (
                            <>
                                <div className="h-8 w-px bg-slate-200" />
                                <div className="flex items-center gap-3">
                                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
                                        {name.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()}
                                    </span>
                                    <span className="hidden text-left lg:block">
                                        <span className="block text-xs font-bold leading-none text-slate-900">{name}</span>
                                        <span className="block text-[10px] uppercase tracking-tighter text-slate-500">Underwriting</span>
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                </header>

                <main className="flex-1">
                    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                        {children}
                    </div>
                </main>
                <Toaster position="top-right" richColors />
            </div>
        </div>
    )
}
