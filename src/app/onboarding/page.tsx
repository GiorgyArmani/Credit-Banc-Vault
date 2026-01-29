"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, ArrowLeft, CheckCircle, Sparkles, Loader2 } from "lucide-react"
import { DataVaultForm } from "@/components/onboarding/data-vault-form"
import { ContractCheckStep } from "@/components/onboarding/contract-check-step"

export default function OnboardingFlow() {
  const [currentStep, setCurrentStep] = useState<"form" | "contract_check">("form")
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  // Check if data vault has already been submitted
  useEffect(() => {
    async function checkStatus() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      // Check user role - redirect advisors to their dashboard
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()

      if (userData?.role === 'advisor' || userData?.role === 'underwriting') {
        router.push('/advisor/dashboard')
        return
      }

      const { data: vaultData } = await supabase
        .from('client_data_vault')
        .select('data_vault_submitted_at, contract_completed')
        .eq('user_id', user.id)
        .maybeSingle()

      if (vaultData?.data_vault_submitted_at) {
        if (!vaultData?.contract_completed) {
          setCurrentStep("contract_check")
        } else {
          // Both done, go to dashboard
          router.push("/dashboard")
          return
        }
      }

      setLoading(false)
    }

    checkStatus()
  }, [supabase, router])

  const handleDataVaultComplete = () => {
    setCurrentStep("contract_check")
  }

  const handleComplete = async () => {
    try {
      await fetch('/api/onboarding/complete', { method: 'POST' });
      window.dispatchEvent(new Event("onboarding-completed"));
      sessionStorage.removeItem("skipOnboarding");
      router.push("/dashboard")
    } catch (error) {
      console.error("Error completing onboarding:", error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600 font-medium">Authenticating...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <Badge className="mb-4 bg-blue-100 text-blue-800 border-blue-200 px-3 py-1">
            <Sparkles className="h-4 w-4 mr-2" />
            Quick Setup
          </Badge>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to Credit Banc Vault</h1>
          <p className="text-gray-600">
            {currentStep === "form"
              ? "Please complete this mandatory security step to proceed."
              : "Review and sign your personalized agreement."}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-blue-50 overflow-hidden">
          {currentStep === "form" ? (
            <div className="p-8">
              <DataVaultForm onComplete={handleDataVaultComplete} />
            </div>
          ) : (
            <div className="p-8">
              <ContractCheckStep
                onComplete={handleComplete}
              />
            </div>
          )}
        </div>

        <p className="text-center text-gray-400 text-sm mt-8">
          Step {currentStep === "form" ? "1" : "2"} of 2 • Secure Encryption Active
        </p>
      </div>
    </div>
  )
}
