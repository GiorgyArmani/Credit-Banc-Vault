"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export function useOnboardingStatus() {
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [loading, setLoading] = useState(true)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const refetch = useCallback(async () => {
    const supabase = supabaseRef.current ?? createClient()
    supabaseRef.current = supabase

    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        // still not hydrated; keep loading until auth event triggers
        setLoading(true)
        return
      }

      const { data, error } = await supabase
        .from("business_profiles")
        .select("completion_level")
        .eq("user_id", user.id)
        .maybeSingle()

      if (error) {
        console.warn("[onboarding] status error:", error)
        setNeedsOnboarding(true) // default to showing modal on error
      } else {
        setNeedsOnboarding(!data || (data?.completion_level ?? 0) < 100)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // initial try
  useEffect(() => {
    refetch()
  }, [refetch])

  // auth subscription (login / token refresh)
  useEffect(() => {
    const supabase = supabaseRef.current ?? createClient()
    supabaseRef.current = supabase
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        refetch()
      }
      if (event === "SIGNED_OUT") {
        setNeedsOnboarding(false)
        setLoading(false)
      }
    })
    return () => sub.subscription?.unsubscribe()
  }, [refetch])

  // focus + “completed” event → recheck
  useEffect(() => {
    const onFocus = () => refetch()
    const onCompleted = () => refetch()
    window.addEventListener("focus", onFocus)
    window.addEventListener("onboarding-completed", onCompleted)
    return () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("onboarding-completed", onCompleted)
    }
  }, [refetch])

  // SAFETY TIMEOUT: if we still loading after 3s but user is likely logged in, open anyway
  useEffect(() => {
    if (loading && timeoutRef.current == null) {
      timeoutRef.current = window.setTimeout(() => {
        // only force if we’re still loading (e.g., slow RLS or network)
        setNeedsOnboarding(true)
        setLoading(false)
      }, 3000)
    }
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [loading])

  return { needsOnboarding, loading, refetch }
}
