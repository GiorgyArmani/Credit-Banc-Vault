'use client'

import { useEffect, useState } from 'react'
import { BusinessProfileBuilder } from '@/components/business-profile-builder'
import { BusinessTabStrip, type BusinessTab } from '@/app/advisor/dashboard/clients/[id]/_components/business-tab-strip'
import { createClient } from '@/lib/supabase/client'
import type { BusinessProfile } from '@/types/business-profile'
import { User } from '@supabase/supabase-js'

/**
 * Client-facing business-profile editor. Was hard-pinned to is_primary=true,
 * which left multi-business clients unable to edit their secondary businesses
 * — secondary entities were unreachable from anywhere in the client UI. Now
 * mirrors the advisor/UW pattern: load every business for the user, surface
 * a tab strip, scope load/save to the active tab.
 *
 * Secondary businesses are created by the advisor via /api/advisor/clients/
 * [id]/businesses — clients can't add their own (intentional).
 */
export default function BusinessProfilePage() {
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [businesses, setBusinesses] = useState<BusinessTab[]>([])
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null)
  const [initialProfile, setInitialProfile] = useState<BusinessProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUserAndBusinesses = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        console.error('No user found')
        setLoading(false)
        return
      }

      setUser(user)

      const { data: rows, error: bizErr } = await supabase
        .from('business_profiles')
        .select('id, company_name, is_primary, legal_entity_type, business_start_date, company_city, company_state, company_zip_code, avg_monthly_deposits, avg_annual_revenue, employees_count, is_home_based, industry')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true })

      if (bizErr) {
        console.error('Failed to load businesses:', bizErr)
        setLoading(false)
        return
      }

      const list = (rows ?? []) as BusinessTab[]
      setBusinesses(list)
      const primary = list.find((b) => b.is_primary) ?? list[0]
      if (primary) setActiveBusinessId(primary.id)
      setLoading(false)
    }

    fetchUserAndBusinesses()
  }, [supabase])

  // Whenever the active tab changes, load the full profile row for that
  // business. Single-row fetch — no client-side filtering on a bag of rows,
  // so the editor always reads the canonical persisted state.
  useEffect(() => {
    if (!activeBusinessId) {
      setInitialProfile(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('id', activeBusinessId)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        console.error('Failed to load profile for active business:', error)
        return
      }
      setInitialProfile(data ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [activeBusinessId, supabase])

  const handleSave = async (updatedProfile: BusinessProfile) => {
    if (!user || !activeBusinessId) return

    // Ensure the public.users row exists (FK target for several tables).
    // Defensive provisioning — left over from the legacy flow where users
    // could land here before post-signup completed.
    const { data: dbUser } = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()

    if (!dbUser) {
      const firstName = user.user_metadata?.first_name || user.user_metadata?.full_name?.split(' ')[0] || 'User'
      const lastName = user.user_metadata?.last_name || user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || ''
      await fetch('/api/post-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          firstName,
          lastName,
          email: user.email,
          tags: ['repair-dashboard'],
        }),
      })
    }

    // Update the active business by id. is_primary stays whatever the row
    // already is — clients can't promote a secondary to primary from here.
    const active = businesses.find((b) => b.id === activeBusinessId)
    const payload = {
      ...updatedProfile,
      user_id: user.id,
      is_primary: active?.is_primary ?? false,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('business_profiles')
      .update(payload)
      .eq('id', activeBusinessId)

    if (error) {
      console.error('Failed to save profile:', error)
      alert(`There was an error saving your profile: ${error.message}`)
    } else {
      alert('Profile saved!')
      // Optimistically refresh the tab strip's display fields.
      setBusinesses((prev) =>
        prev.map((b) =>
          b.id === activeBusinessId
            ? {
                ...b,
                company_name: (updatedProfile as any).company_name ?? b.company_name,
              }
            : b,
        ),
      )
    }
  }

  if (loading) return <p className="text-center p-4">Loading profile...</p>

  return (
    <div>
      {businesses.length > 1 && (
        <BusinessTabStrip
          businesses={businesses}
          active_business_id={activeBusinessId}
          on_select={setActiveBusinessId}
          show_when_single={false}
        />
      )}
      <BusinessProfileBuilder
        key={activeBusinessId ?? 'none'}
        initialProfile={initialProfile || undefined}
        onSave={handleSave}
        onClose={() => {}}
      />
    </div>
  )
}
