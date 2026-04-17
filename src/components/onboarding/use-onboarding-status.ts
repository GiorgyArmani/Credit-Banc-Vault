"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export function useOnboardingStatus() {
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [dataVaultCompleted, setDataVaultCompleted] = useState(false)
  const [contractCompleted, setContractCompleted] = useState(false)
  const [clientName, setClientName] = useState<string | null>(null)
  const [vaultId, setVaultId] = useState<string | null>(null)
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

      // Check user role and vault status in parallel
      const [userResult, vaultResult] = await Promise.all([
        supabase
          .from("users")
          .select("role")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("client_data_vault")
          .select("id, data_vault_submitted_at, contract_completed, client_name")
          .eq("user_id", user.id)
          .maybeSingle()
      ])

      const { data: userData, error: userError } = userResult
      const { data: vaultData, error: vaultError } = vaultResult

      if (userError) {
        console.warn("[onboarding] error fetching user role:", userError)
      }

      // ALWAYS set the client name if we got data, regardless of onboarding status
      setClientName(vaultData?.client_name || null)
      setVaultId(vaultData?.id || null)

      // If user is an advisor, underwriter, or admin, skip onboarding entirely
      if (userData?.role === "advisor" || userData?.role === "underwriting" || userData?.role === "admin") {
        setNeedsOnboarding(false)
        setDataVaultCompleted(true)
        setContractCompleted(true)
        setLoading(false)
        return
      }

      // Check vault status
      let isVaultDone = false
      let isContractDone = false

      if (vaultError) {
        console.warn("[onboarding] vault status error:", vaultError)
      } else {
        isVaultDone = !!vaultData?.data_vault_submitted_at
        isContractDone = !!vaultData?.contract_completed
      }

      // 0. Check Auth Metadata and Contract Status (Fast path)
      const isMetadataComplete = user.user_metadata?.onboarding_complete === true

      if (isMetadataComplete && isContractDone) {
        setNeedsOnboarding(false)
        setDataVaultCompleted(isVaultDone)
        setContractCompleted(true)
        setLoading(false)
        return
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

      // Needs onboarding if:
      // 1. Profile is incomplete (Step 1)
      // 2. OR Data Vault is not submitted (Step 2)
      // 3. OR Contract is not signed (Step 3)
      // 4. OR Metadata says not complete (Step 4 - Video)

      // Even if vault and contract are done, we might still be showing the video step.
      // So we should say needsOnboarding = true if !isMetadataComplete regardless of the intermediate steps?
      // Yes, provided the "fast path" hasn't already returned false.

      // If we are here, isMetadataComplete is false (or undefined).
      // So if (isVaultDone && isContractDone) we STILL need onboarding (for video) until metadata is set.

      setNeedsOnboarding(true); // Since we haven't hit the fast path return, we assume incomplete.

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

  // SAFETY TIMEOUT removed because it was causing "fail-active" behavior on slow networks
  // We trust the refetch() and auth listeners to handle state correctly.


  return { needsOnboarding, dataVaultCompleted, contractCompleted, clientName, vaultId, loading, refetch }
}
