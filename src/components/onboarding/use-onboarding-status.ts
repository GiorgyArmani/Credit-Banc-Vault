"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export function useOnboardingStatus() {
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [dataVaultCompleted, setDataVaultCompleted] = useState(false)
  const [contractCompleted, setContractCompleted] = useState(false)
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

      // Check user role - skip onboarding for advisors
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()

      if (userError) {
        console.warn("[onboarding] error fetching user role:", userError)
      }

      // If user is an advisor, skip onboarding entirely
      if (userData?.role === "advisor" || userData?.role === "underwriting") {
        setNeedsOnboarding(false)
        setDataVaultCompleted(true) // Mark as completed to prevent any checks
        setContractCompleted(true)
        setLoading(false)
        return
      }

      // Check business profile completion
      const { data, error } = await supabase
        .from("business_profiles")
        .select("completion_level")
        .eq("user_id", user.id)
        .maybeSingle()

      let profileIncomplete = false
      if (error) {
        console.warn("[onboarding] status error:", error)
        profileIncomplete = true
      } else {
        profileIncomplete = !data || (data?.completion_level ?? 0) < 100
      }

      // Check if data vault has been submitted and contract is signed
      const { data: vaultData, error: vaultError } = await supabase
        .from("client_data_vault")
        .select("data_vault_submitted_at, contract_completed")
        .eq("user_id", user.id)
        .maybeSingle()

      let isVaultDone = false
      let isContractDone = false

      if (vaultError) {
        console.warn("[onboarding] vault status error:", vaultError)
      } else {
        isVaultDone = !!vaultData?.data_vault_submitted_at
        isContractDone = !!vaultData?.contract_completed
      }

      setDataVaultCompleted(isVaultDone)
      setContractCompleted(isContractDone)

      // Needs onboarding if:
      // 1. Profile is incomplete (Step 1 - likely handled elsewhere actually, but kept for consistency)
      // 2. OR Data Vault is not submitted (Step 2)
      // 3. OR Contract is not signed (Step 3)
      // Note: The modal internal logic handles skipping steps, so we just need to know if ANY part is missing.
      // Actually, based on previous code, `needsOnboarding` was driven by profile status mostly, but `OnboardingGate` opens if `needsOnboarding` is true.
      // We should probably ensure it opens if vault or contract are missing too.
      // For now, let's keep the boolean simple: if any step is missing, we need onboarding.

      setNeedsOnboarding(profileIncomplete || !isVaultDone || !isContractDone)

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

  return { needsOnboarding, dataVaultCompleted, contractCompleted, loading, refetch }
}
