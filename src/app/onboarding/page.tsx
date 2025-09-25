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
  const [currentStep, setCurrentStep] = useState(0)
  const [profile, setProfile] = useState<Partial<BusinessProfile>>({})
  const router = useRouter()
  const supabase = createClient()
  const currentStepData = steps[currentStep]
  const progress = ((currentStep + 1) / steps.length) * 100

  const handleFieldChange = (key: keyof BusinessProfile, value: string) => {
    setProfile(prev => ({ ...prev, [key]: value }))
  }

  const isStepValid = () => {
    return currentStepData.fields
      .filter(field => field.required)
      .every(field => !!profile[field.key])
  }

  const handleComplete = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const finalProfile: BusinessProfile = {
      business_name: profile.business_name ?? undefined,
      business_description: profile.business_description ?? undefined,
      business_model: profile.business_model ?? undefined,
      years_in_business: profile.years_in_business ?? undefined,
      industry: profile.industry ?? undefined,
      primary_goal: profile.primary_goal ?? undefined,
      secondary_goal: profile.secondary_goal ?? undefined,
      main_challenge: profile.main_challenge ?? undefined,
      annual_revenue_last_year: profile.annual_revenue_last_year ?? undefined,
      monthly_revenue: profile.monthly_revenue ?? undefined,
      completion_level: 100,
      completed_categories: ["basic", "goals", "financial"],
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
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <Badge className="mb-4 bg-blue-100 text-blue-800 border-blue-200">
            <Sparkles className="h-4 w-4 mr-2" />
            Quick Setup
          </Badge>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Let's get to know your business</h1>
          <p className="text-gray-600">This helps us provide personalized recommendations</p>
        </div>

        <div className="mb-8">
          <div className="flex justify-between text-sm text-gray-500 mb-2">
            <span>Step {currentStep + 1} of {steps.length}</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{currentStepData.title}</CardTitle>
            <CardDescription>{currentStepData.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {currentStepData.fields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={field.key}>{field.label}{field.required && <span className="text-red-500 ml-1">*</span>}</Label>

                {field.type === "input" && (
                  <Input id={field.key} name={field.key} placeholder={field.placeholder} value={String(profile[field.key] ?? "")} onChange={(e) => handleFieldChange(field.key, e.target.value)} />
                )}
                {field.type === "textarea" && (
                  <Textarea id={field.key} name={field.key} placeholder={field.placeholder} rows={3} value={String(profile[field.key] ?? "")} onChange={(e) => handleFieldChange(field.key, e.target.value)} />
                )}
                {field.type === "select" && (
                  <Select value={String(profile[field.key] ?? "")} onValueChange={(value) => handleFieldChange(field.key, value)}>
                    <SelectTrigger id={field.key} name={field.key}>
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}

            <div className="flex justify-between pt-6">
              <div className="flex gap-2">
                {currentStep > 0 && (
                  <Button variant="outline" onClick={() => setCurrentStep(currentStep - 1)}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                  </Button>
                )}
                <Button variant="ghost" onClick={() => router.push("/dashboard")}>Skip for now</Button>
              </div>

              <Button onClick={currentStep === steps.length - 1 ? handleComplete : () => setCurrentStep(currentStep + 1)} disabled={!isStepValid()}>
                {currentStep === steps.length - 1 ? (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Complete Setup
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
