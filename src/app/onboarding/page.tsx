"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, ArrowLeft, CheckCircle, Sparkles } from "lucide-react"
import { DataVaultForm } from "@/components/onboarding/data-vault-form"

export default function OnboardingFlow() {
  const [currentStep, setCurrentStep] = useState(0)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  // Check if data vault has already been submitted
  useEffect(() => {
    async function checkDataVaultStatus() {
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

      // If user is an advisor, redirect to advisor dashboard
      if (userData?.role === 'advisor' || userData?.role === 'underwriting') {
        router.push('/advisor/dashboard')
        return
      }

      const { data: vaultData } = await supabase
        .from('client_data_vault')
        .select('data_vault_submitted_at')
        .eq('user_id', user.id)
        .maybeSingle()

      // If data vault is already submitted, skip to video step
      if (vaultData?.data_vault_submitted_at) {
        setCurrentStep(1)
      }

      setLoading(false)
    }

    checkDataVaultStatus()
  }, [supabase, router])

  const handleDataVaultComplete = () => {
    setCurrentStep(1)
  }

  const handleComplete = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Mark tutorial as viewed if needed, or just redirect
    // Since user said "no other info", we assume the profile update is not needed here
    // or handled elsewhere. We'll just redirect.
    router.push("/dashboard")
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Sparkles className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <Badge className="mb-4 bg-blue-100 text-blue-800 border-blue-200">
            <Sparkles className="h-4 w-4 mr-2" />
            Quick Setup
          </Badge>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to Credit Banc Vault</h1>
          <p className="text-gray-600">
            {currentStep === 0
              ? "Please complete this mandatory security step to proceed."
              : "Watch this quick tutorial to learn how to get the most out of our platform."}
          </p>
        </div>

        {currentStep === 0 && (
          <DataVaultForm onComplete={handleDataVaultComplete} />
        )}

        {currentStep === 1 && (
          <Card className="bg-background border-border overflow-hidden">
            <CardContent className="p-0">
              <div className="flex flex-col items-center justify-center p-6 space-y-6">
                <div className="w-full aspect-video bg-muted rounded-lg overflow-hidden relative shadow-lg border border-border">
                  <video
                    className="w-full h-full object-cover"
                    controls
                    autoPlay
                    poster="/placeholder-video-poster.jpg"
                  >
                    <source src="https://vowcnxlmahbildgsreso.supabase.co/storage/v1/object/sign/public%20videos/riverside_2025_11%2025%2019%2054%2059.mp4%20magic%20episode%20_%20nov%2026,%202_the_weekly%20recap.mp4?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9iNmYyMTI4MC04NmY3LTQ3NDgtYTUxZC02M2RhNmRmNjBiYzQiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJwdWJsaWMgdmlkZW9zL3JpdmVyc2lkZV8yMDI1XzExIDI1IDE5IDU0IDU5Lm1wNCBtYWdpYyBlcGlzb2RlIF8gbm92IDI2LCAyX3RoZV93ZWVrbHkgcmVjYXAubXA0IiwiaWF0IjoxNzY0MTI2MjI5LCJleHAiOjIwNzk0ODYyMjl9.Ik77t63UnAnbZF9P0F8zcGV8uX0a7Jyq_gSCVKQUAEo" type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>
                </div>

                <div className="flex w-full justify-between items-center">
                  <Button
                    variant="ghost"
                    onClick={() => router.push("/dashboard")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Skip for now
                  </Button>

                  <Button
                    size="lg"
                    onClick={handleComplete}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                  >
                    Get Started <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
