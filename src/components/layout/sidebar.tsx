//src/components/layout/sidebar.tsx  VAULT
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
    { label: 'CB Vault', href: '/dashboard', icon: BookMarked },
    // { label: 'AI Chat', href: '/dashboard/chat', icon: MessageSquare },
    //{ label: 'Credit Report Assistant', href: '/dashboard/credit-report-assistant', icon: FileSearch },
    //{ label: 'Book Consultation', href: '/dashboard/book-consultation', icon: Calendar },
    // { label: 'Business Vault', href: '/dashboard/business-vault', icon: BookMarked },
    //{ label: 'Business Profile', href: '/dashboard/business-profile', icon: User },
  ]

  // Ancho: en mobile siempre w-72; en desktop depende de "collapsed"
  const desktopWidth = collapsed ? 'md:w-16' : 'md:w-64'

  return (
    <>
      {/* Overlay (mobile) */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onMobileClose}
      />

      {/* Sidebar */}
      <aside
        aria-label="Sidebar navigation"
        className={[
          // altura + scroll, y sin scroll horizontal
          'fixed left-0 top-0 z-50 flex h-dvh md:h-screen w-72 flex-col bg-white border-r shadow-sm overflow-y-auto overflow-x-hidden',
          // animación drawer
          'transition-transform duration-300 ease-in-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
          desktopWidth,
        ].join(' ')}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white">
          <div className="flex items-center justify-between px-4 py-3 md:justify-center border-b">
            {/* En desktop colapsado: ocultar branding totalmente */}
           <div className={collapsed ? 'hidden' : 'block'}>
              <img src="vaultlogo.svg" alt="Logo" className="h-60 w-100 mb-1" />
              <p className="text-sm text-gray-500">Business Document Hub</p>
            </div>
            <button
              onClick={onMobileClose}
              className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-3 py-3 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link href={href} key={href} onClick={onMobileClose} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}>
                <Button
                  variant={active ? 'default' : 'ghost'}
                  className={[
                    'w-full h-11 rounded-md',
                    // Desktop colapsado: solo ícono centrado, sin padding
                    collapsed ? 'md:justify-center md:px-0' : 'justify-start px-3',
                    active ? 'bg-emerald-500 text-white' : 'text-gray-700 hover:bg-gray-100',
                  ].join(' ')}
                >
                  <Icon className={['h-5 w-5', collapsed ? 'md:mr-0' : 'mr-3', 'shrink-0'].join(' ')} />
                  {/* En mobile SIEMPRE mostrar etiqueta; en desktop ocultar si colapsado */}
                  <span className={collapsed ? 'md:hidden inline' : 'inline'}>{label}</span>
                </Button>
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="mt-auto px-3 pb-3 pt-2 border-t bg-gray-50">
          {/* Identidad:
              - mobile y desktop expandido: visible
              - desktop colapsado: oculto (para no “aplastar” texto) */}
          <div className={`space-x-3 mb-3 items-center ${collapsed ? 'hidden md:flex md:hidden' : 'flex'}`}>
            <div className="bg-emerald-100 rounded-full p-2">
              <User className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-gray-800 truncate">{userEmail?.split('@')[0] || 'User'}</p>
              <Badge className="bg-green-100 text-green-800 text-xs">Free Plan</Badge>
            </div>
          </div>

          {/* Logout:
              - mobile y desktop expandido: botón completo
              - desktop colapsado: solo ícono (sin texto) */}
          <div className="flex items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              className={`w-full text-gray-700 ${collapsed ? 'md:hidden' : ''}`}
            >
              <LogOut className="h-4 w-4 mr-2" />
              <span>Sign Out</span>
            </Button>

            <button
              onClick={handleSignOut}
              aria-label="Sign out"
              title="Sign Out"
              className={`hidden ${collapsed ? 'md:inline-flex' : 'md:hidden'} ml-0 items-center justify-center w-10 h-10 rounded-md border text-gray-700 hover:bg-gray-100`}
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Botón colapsar/expandir (solo desktop) */}
      <button
        onClick={() => {
          const next = !collapsed
          onToggleCollapsed?.()
          localStorage.setItem('sidebar_collapsed', next ? '1' : '0')
        }}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="hidden md:flex fixed left-3 z-[60] h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow hover:bg-emerald-600"
        // colócalo justo encima del footer (ajusta si cambias padding del footer)
        style={{ bottom: 96 }}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
      </button>
    </>
  )
}
