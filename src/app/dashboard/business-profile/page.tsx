'use client'

import { useEffect, useState } from 'react'
import { BusinessProfileBuilder } from '@/components/business-profile-builder'
import { createClient } from '@/lib/supabase/client'
import type { BusinessProfile } from '@/types/business-profile'
import { User } from '@supabase/supabase-js'

export default function BusinessProfilePage() {
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [initialProfile, setInitialProfile] = useState<BusinessProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUserAndProfile = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        console.error('No user found')
        return
      }

      setUser(user)

      const { data, error } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (error && error.code !== 'PGRST116') console.error('Error loading profile:', error)
      if (data) setInitialProfile(data)

      setLoading(false)
    }

    fetchUserAndProfile()
  }, [supabase])

  const handleSave = async (updatedProfile: BusinessProfile) => {
    if (!user) return

    // 1) Ensure record in public.users exists (Fixes FK violation)
    const { data: dbUser } = await supabase
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!dbUser) {
      console.log("Provisioning missing user record...");
      const firstName = user.user_metadata?.first_name || user.user_metadata?.full_name?.split(" ")[0] || "User";
      const lastName = user.user_metadata?.last_name || user.user_metadata?.full_name?.split(" ").slice(1).join(" ") || "";

      await fetch("/api/post-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          firstName,
          lastName,
          email: user.email,
          tags: ["repair-dashboard"],
        }),
      });
    }

    const { error } = await supabase.from('business_profiles').upsert({
      ...updatedProfile,
      user_id: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    if (error) {
      console.error('Failed to save profile:', error)
      alert(`There was an error saving your profile: ${error.message}`)
    } else {
      alert('Profile saved!')
    }
  }

  if (loading) return <p className="text-center p-4">Loading profile...</p>

  return (
    <BusinessProfileBuilder
      initialProfile={initialProfile || undefined}
      onSave={handleSave}
      onClose={() => { }}
    />
  )
}
