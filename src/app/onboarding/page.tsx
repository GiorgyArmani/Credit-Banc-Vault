"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, ArrowLeft, CheckCircle, Sparkles } from "lucide-react"

interface BusinessProfile {
  business_name?: string
  business_description?: string
  business_model?: string
  years_in_business?: string
  industry?: string
  primary_goal?: string
  secondary_goal?: string
  main_challenge?: string
  annual_revenue_last_year?: string
  monthly_revenue?: string
  completion_level: number
  completed_categories: string[]
  updated_at: string
}

interface Field {
  key: keyof BusinessProfile
  label: string
  type: "input" | "textarea" | "select"
  placeholder?: string
  options?: string[]
  required?: boolean
}

interface Step {
  title: string
  description: string
  fields: Field[]
}

const steps: Step[] = [
  {
    title: "Tell us about your business",
    description: "Help us understand what you do",
    fields: [
      { key: "business_name", label: "Business Name", type: "input", placeholder: "e.g., Great Business LLC", required: true },
      { key: "business_description", label: "Business Description", type: "textarea", placeholder: "Describe your business...", required: true },
      { key: "years_in_business", label: "How many years in business?", type: "select", required: true, options: ["Less than 1 year", "1-2 years", "3-5 years", "6-10 years", "More than 10 years"] },
      {
        key: "industry", label: "Industry", type: "select", required: true, options: [
          "Accommodation and Food Services", "Administrative and Support Services", "Agriculture, Forestry, Fishing and Hunting",
          "Arts, Entertainment, and Recreation", "Construction", "Educational Services", "Finance and Insurance",
          "Health Care and Social Assistance", "Information", "Manufacturing", "Mining, Quarrying, and Oil and Gas Extraction",
          "Other Services (except Public Administration)", "Professional, Scientific, and Technical Services",
          "Real Estate and Rental and Leasing", "Retail Trade", "Transportation and Warehousing", "Utilities", "Wholesale Trade"
        ]
      },
      { key: "business_model", label: "Business Model", type: "select", options: ["Service-based", "Product-based", "E-commerce", "SaaS/Software", "Consulting", "Agency", "Retail", "Other"], required: true },
    ]
  },
  {
    title: "What are your goals?",
    description: "Let's understand what you want to achieve",
    fields: [
      {
        key: "primary_goal", label: "Primary Goal", type: "select", required: true,
        options: ["Increase revenue", "Scale operations", "Improve efficiency", "Expand market reach", "Launch new products", "Build team", "Improve Fundability", "Other"]
      },
      {
        key: "secondary_goal", label: "Secondary Goal", type: "select", required: false,
        options: ["Increase revenue", "Scale operations", "Improve efficiency", "Expand market reach", "Launch new products", "Build team", "Improve Fundability", "Other"]
      },
      {
        key: "main_challenge", label: "Biggest Challenge", type: "textarea", required: true,
        placeholder: "What's your biggest business challenge right now?"
      }
    ]
  },
  {
    title: "Financial overview",
    description: "Help us understand your business size",
    fields: [
      {
        key: "monthly_revenue", label: "Average Monthly Revenue", type: "select", options: ["Less than $6K", "$6K - $10K", "$10K - $20K", "$30K - $50K", "$50K - $100K", "$100K - $250K", "More than $500K"]
      },
      {
        key: "annual_revenue_last_year", label: "Annual Revenue Last Year", type: "select", options: ["Less than $60K", "$60K - $200K", "$200K - $500K", "$500K - $1M", "$1M - $5M", "$5M - $10M", "More than $15M"]
      }
    ]
  }
]

export default function OnboardingFlow() {
  // const [currentStep, setCurrentStep] = useState(0)
  // const [profile, setProfile] = useState<Partial<BusinessProfile>>({})
  const router = useRouter()
  const supabase = createClient()
  // const currentStepData = steps[currentStep]
  // const progress = ((currentStep + 1) / steps.length) * 100

  // const handleFieldChange = (key: keyof BusinessProfile, value: string) => {
  //   setProfile(prev => ({ ...prev, [key]: value }))
  // }

  // const isStepValid = () => {
  //   return currentStepData.fields
  //     .filter(field => field.required)
  //     .every(field => !!profile[field.key])
  // }

  const handleComplete = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const finalProfile: Partial<BusinessProfile> = {
      // business_name: profile.business_name ?? undefined,
      // ...
      completion_level: 100,
      completed_categories: ["video_tutorial"],
      updated_at: new Date().toISOString()
    }

    const { error } = await supabase.from("business_profiles").upsert({
      user_id: user.id,
      ...finalProfile
    }, { onConflict: "user_id" })

    if (error) {
      console.error("Error saving profile:", error)
    } else {
      router.push("/dashboard")
    }
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
          <p className="text-gray-600">Watch this quick tutorial to learn how to get the most out of our platform.</p>
        </div>

        {/* <div className="mb-8">
          <div className="flex justify-between text-sm text-gray-500 mb-2">
            <span>Step {currentStep + 1} of {steps.length}</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div> */}

        <Card className="bg-background border-border overflow-hidden">
          {/* <CardHeader>
            <CardTitle>{currentStepData.title}</CardTitle>
            <CardDescription>{currentStepData.description}</CardDescription>
          </CardHeader> */}
          <CardContent className="p-0">
            <div className="flex flex-col items-center justify-center p-6 space-y-6">
              <div className="w-full aspect-video bg-muted rounded-lg overflow-hidden relative shadow-lg border border-border">
                {/* Placeholder for Video - Replace src with actual Supabase URL */}
                <video
                  className="w-full h-full object-cover"
                  controls
                  autoPlay
                  // src="YOUR_SUPABASE_VIDEO_URL_HERE"
                  poster="/placeholder-video-poster.jpg" // Optional: Add a poster image
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
      </div>
    </div>
  )
}
