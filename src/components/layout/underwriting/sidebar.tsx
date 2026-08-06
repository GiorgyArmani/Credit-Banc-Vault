// src/components/layout/underwriting/sidebar.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    LayoutDashboard,
    Users,
    LogOut,
    User,
    X,
    ChevronsLeft,
    ChevronsRight,
    BarChart3 as ChartBarIcon,
    Search,
    Database,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

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
        { label: 'Review Queue', href: '/underwriting/dashboard', icon: LayoutDashboard },
        { label: 'Bank Analysis', href: '/underwriting/bank-analysis', icon: ChartBarIcon },
        { label: 'Lender Match', href: '/underwriting/lender-match', icon: Search },
        { label: 'Lender Database', href: '/underwriting/lender-guidelines', icon: Database },
    ]

    const desktopWidth = collapsed ? 'md:w-20' : 'md:w-72'

    return (
        <>
            {/* Overlay (mobile) */}
            <div
                className={`fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm transition-opacity md:hidden ${mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                onClick={onMobileClose}
            />

            {/* Sidebar */}
            <aside
                aria-label="Sidebar navigation"
                className={[
                    'fixed left-0 top-0 z-50 flex h-dvh md:h-screen w-72 flex-col bg-slate-900 border-r border-white/5 shadow-2xl overflow-y-auto overflow-x-hidden',
                    // transition-transform, NOT transition-all: the mobile
                    // drawer still slides in, but the collapse/expand width
                    // snaps. Animating the width meant the expanded labels spent
                    // 300ms laid out inside an 80px box — they wrapped onto
                    // several lines, pushed the content past the viewport, and
                    // flashed a scrollbar before the width caught up.
                    'transition-transform duration-300 ease-in-out',
                    mobileOpen ? 'translate-x-0' : '-translate-x-full',
                    'md:translate-x-0',
                    desktopWidth,
                ].join(' ')}
            >
                {/* Header */}
                <div className="sticky top-0 bg-slate-900/80 backdrop-blur-md z-20">
                    <div className="flex flex-col items-center justify-center px-4 py-8 border-b border-white/5 relative">
                        <div className={`transition-all duration-300 ${collapsed ? 'md:opacity-0 md:scale-90 md:h-0 md:overflow-hidden opacity-100 scale-100' : 'opacity-100 scale-100'}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/CBLOGOWHITE.png" alt="Credit Banc" className="h-8 w-auto mx-auto" />
                           
                        </div>

                        {/* CB mark for collapsed state */}
                        {collapsed && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src="/cb-logo.png" alt="Credit Banc" className="w-10 h-10 max-w-none shrink-0 hidden md:block" />
                        )}

                        <button
                            onClick={onMobileClose}
                            className="md:hidden absolute right-4 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5 text-white hover:bg-white/10 transition-colors"
                            aria-label="Close sidebar"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="px-4 py-6 space-y-2 flex-grow">
                    {navItems.map(({ href, label, icon: Icon }) => {
                        const active = pathname === href
                        return (
                            <Link href={href} key={href} onClick={onMobileClose} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}>
                                <Button
                                    variant="ghost"
                                    className={[
                                        'w-full h-14 rounded-2xl transition-all duration-300 group relative overflow-hidden',
                                        collapsed ? 'md:justify-center md:px-0' : 'justify-start px-5',
                                        active
                                            ? 'bg-white text-slate-950 font-black shadow-[0_0_30px_rgba(16,185,129,0.1)]'
                                            : 'text-slate-300/60 hover:bg-white/5 hover:text-slate-50 font-bold',
                                    ].join(' ')}
                                >
                                    {/* Active Indicator Glow */}
                                    {active && (
                                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-transparent pointer-events-none" />
                                    )}

                                    <Icon className={[
                                        'h-5 w-5 shrink-0 transition-transform duration-300 group-hover:scale-110',
                                        collapsed ? 'md:mr-0' : 'mr-4',
                                        active ? 'text-emerald-500' : 'text-inherit'
                                    ].join(' ')} />

                                    <span className={[
                                        'transition-all duration-300 font-bold',
                                        collapsed ? 'md:hidden md:opacity-0 md:translate-x-2' : 'inline opacity-100 translate-x-0'
                                    ].join(' ')}>{label}</span>

                                    {/* Dot indicator for active in collapsed mode */}
                                    {active && collapsed && (
                                        <div className="absolute right-2 w-1 h-5 bg-emerald-500 rounded-full md:block hidden" />
                                    )}
                                </Button>
                            </Link>
                        )
                    })}
                </nav>

                {/* Footer */}
                <div className="mt-auto px-4 pb-6 pt-4 border-t border-white/5 bg-slate-800/10 backdrop-blur-md">
                    {/* Identidad */}
                    <div className={`space-x-4 mb-6 items-center transition-all duration-300 flex ${collapsed ? 'md:flex-col md:space-x-0 md:gap-3' : ''}`}>
                        <div className="bg-emerald-500/20 rounded-[1.25rem] p-3 border border-emerald-500/20 flex-shrink-0">
                            <User className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div className={`min-w-0 transition-all duration-300 ${collapsed ? 'md:hidden block' : 'block'}`}>
                            <p className="font-black text-white truncate text-sm mb-1">{userEmail?.split('@')[0] || 'Underwriter'}</p>
                            <Badge className="bg-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-widest border-emerald-500/30">Underwriting</Badge>
                        </div>
                    </div>

                    {/* Logout */}
                    <div className="flex items-center gap-2">
                        {!collapsed ? (
                            <Button
                                variant="outline"
                                onClick={handleSignOut}
                                className="w-full h-12 rounded-2xl border-white/10 text-slate-100/60 font-black hover:bg-white/5 hover:text-white transition-all bg-transparent group"
                            >
                                <LogOut className="h-4 w-4 mr-3 transition-transform group-hover:-translate-x-1" />
                                <span className="uppercase tracking-widest text-[10px]">Sign Out</span>
                            </Button>
                        ) : (
                            <button
                                onClick={handleSignOut}
                                aria-label="Sign out"
                                title="Sign Out"
                                className="flex items-center justify-center w-full h-12 rounded-2xl border border-white/10 text-slate-100/60 hover:bg-white/5 hover:text-white transition-all group"
                            >
                                <LogOut className="h-5 w-5 transition-transform group-hover:-translate-x-1" />
                            </button>
                        )}
                    </div>
                </div>
            </aside>

            {/* Toggle Button (Desktop Only) */}
            <button
                onClick={() => {
                    const next = !collapsed
                    onToggleCollapsed?.()
                    localStorage.setItem('sidebar_collapsed_uw', next ? '1' : '0')
                }}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="hidden md:flex fixed z-50 h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-[transform,background-color] duration-150 ease-out active:scale-90"
                style={{ bottom: 100, left: collapsed ? 60 : 268 }}
                title={collapsed ? 'Expand' : 'Collapse'}
            >
                {collapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
            </button>
        </>
    )
}
