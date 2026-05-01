// src/app/underwriting/layout.tsx
//
// Server-side underwriting gate. Runs before any /underwriting/* page renders.
// If the user isn't authenticated or doesn't have role='underwriting' (or
// 'admin'), they're redirected — no underwriting UI ever reaches the browser.
//
// Defense-in-depth on top of the proxy gate at src/proxy.ts.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { UnderwritingShell } from './_components/underwriting-shell'

export default async function UnderwritingLayout({ children }: { children: React.ReactNode }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/auth/login')
    }

    const { data: userRow } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()

    const role = userRow?.role
    if (role !== 'underwriting' && role !== 'admin') {
        redirect('/dashboard')
    }

    return <UnderwritingShell>{children}</UnderwritingShell>
}
