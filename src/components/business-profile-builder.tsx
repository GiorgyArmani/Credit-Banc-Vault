'use client'

import { useEffect, useMemo, useState } from 'react'
import type { BusinessProfileBuilderProps, BusinessProfile } from '@/types/business-profile'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, Save, User, Target, DollarSign } from 'lucide-react'

// ----- Cohesive options (same as onboarding) -----
const YEARS_IN_BUSINESS = [
  'Less than 1 year', '1-2 years', '3-5 years', '6-10 years', 'More than 10 years',
]

const INDUSTRIES = [
  'Accommodation and Food Services', 'Administrative and Support Services',
  'Agriculture, Forestry, Fishing and Hunting', 'Arts, Entertainment, and Recreation',
  'Construction', 'Educational Services', 'Finance and Insurance',
  'Health Care and Social Assistance', 'Information', 'Manufacturing',
  'Mining, Quarrying, and Oil and Gas Extraction', 'Other Services (except Public Administration)',
  'Professional, Scientific, and Technical Services', 'Real Estate and Rental and Leasing',
  'Retail Trade', 'Transportation and Warehousing', 'Utilities', 'Wholesale Trade'
]

const BUSINESS_MODELS = [
  'Service-based', 'Product-based', 'E-commerce', 'SaaS/Software', 'Consulting', 'Agency', 'Retail', 'Other',
]

const GOALS = [
  'Increase revenue', 'Scale operations', 'Improve efficiency', 'Expand market reach',
  'Launch new products', 'Build team', 'Improve Fundability', 'Other',
]

const MONTHLY_REVENUE = [
  'Less than $6K', '$6K - $10K', '$10K - $20K', '$30K - $50K',
  '$50K - $100K', '$100K - $250K', 'More than $500K',
]

const ANNUAL_REVENUE = [
  'Less than $60K', '$60K - $200K', '$200K - $500K', '$500K - $1M',
  '$1M - $5M', '$5M - $10M', 'More than $15M',
]

// ----- Defaults aligned to your type -----
const DEFAULT_PROFILE: BusinessProfile = {
  business_name: '',
  business_description: '',
  business_model: '',
  years_in_business: '',
  industry: '',
  primary_goal: '',
  secondary_goal: '',
  main_challenge: '',
  annual_revenue_last_year: '',
  monthly_revenue: '',
  completion_level: 0,
  completed_categories: [],
  updated_at: '',
}

export function BusinessProfileBuilder({
  initialProfile,
  onSave,
  onClose,
}: BusinessProfileBuilderProps) {
  const [profile, setProfile] = useState<BusinessProfile>(initialProfile ?? DEFAULT_PROFILE)
  const [activeTab, setActiveTab] = useState<'basic' | 'goals' | 'financial'>('basic')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (initialProfile) setProfile(prev => ({ ...DEFAULT_PROFILE, ...initialProfile }))
  }, [initialProfile])

  const updateProfile = (key: keyof BusinessProfile, value: string) => {
    setProfile(prev => ({ ...prev, [key]: value }))
  }

  // Only use fields that actually exist on BusinessProfile
  const completionKeys: (keyof BusinessProfile)[] = useMemo(() => ([
    'business_name',
    'business_description',
    'years_in_business',
    'industry',
    'business_model',
    'primary_goal',
    'main_challenge',
    'monthly_revenue',
    'annual_revenue_last_year',
  ]), [])

  const calculateCompletionLevel = () => {
    const completed = completionKeys.filter((k) => {
      const v = profile[k]
      return typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : !!v
    }).length
    return Math.round((completed / completionKeys.length) * 100)
  }

  const completionLevel = calculateCompletionLevel()

  const handleSave = () => {
    const updated: BusinessProfile = {
      ...profile,
      completion_level: completionLevel,
      completed_categories: [
        ...(profile.business_name || profile.business_description || profile.industry || profile.business_model ? ['basic'] : []),
        ...(profile.primary_goal || profile.secondary_goal || profile.main_challenge ? ['goals'] : []),
        ...(profile.monthly_revenue || profile.annual_revenue_last_year ? ['financial'] : []),
      ],
      updated_at: new Date().toISOString(),
    }
    onSave(updated)
  }

  if (!mounted) {
    return (
      <div className="min-h-[200px] flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold">Business Profile</h1>
              <p className="text-sm text-gray-600">Keep your details up to date for better coaching</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium">{completionLevel}% Complete</div>
              <Progress value={completionLevel} className="w-28 h-2" />
            </div>
            <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Save className="h-4 w-4 mr-2" /> Save
            </Button>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-4xl mx-auto p-6">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="basic"><User className="h-4 w-4 mr-2" /> Basic</TabsTrigger>
            <TabsTrigger value="goals"><Target className="h-4 w-4 mr-2" /> Goals</TabsTrigger>
            <TabsTrigger value="financial"><DollarSign className="h-4 w-4 mr-2" /> Financial</TabsTrigger>
          </TabsList>

          {/* BASIC */}
          <TabsContent value="basic" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Tell us about your business</CardTitle>
                <CardDescription>Help us understand what you do</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="business_name">Business Name</Label>
                  <Input
                    id="business_name"
                    placeholder="e.g., Great Business LLC"
                    value={profile.business_name || ''}
                    onChange={(e) => updateProfile('business_name', e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="business_description">Business Description</Label>
                  <Textarea
                    id="business_description"
                    placeholder="Describe your business..."
                    rows={3}
                    value={profile.business_description || ''}
                    onChange={(e) => updateProfile('business_description', e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="years_in_business">How many years in business?</Label>
                    <Select
                      value={profile.years_in_business || ''}
                      onValueChange={(v) => updateProfile('years_in_business', v)}
                    >
                      <SelectTrigger id="years_in_business">
                        <SelectValue placeholder="Select an option" />
                      </SelectTrigger>
                      <SelectContent>
                        {YEARS_IN_BUSINESS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="industry">Industry</Label>
                    <Select
                      value={profile.industry || ''}
                      onValueChange={(v) => updateProfile('industry', v)}
                    >
                      <SelectTrigger id="industry">
                        <SelectValue placeholder="Select an option" />
                      </SelectTrigger>
                      <SelectContent>
                        {INDUSTRIES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="business_model">Business Model</Label>
                  <Select
                    value={profile.business_model || ''}
                    onValueChange={(v) => updateProfile('business_model', v)}
                  >
                    <SelectTrigger id="business_model">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {BUSINESS_MODELS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* GOALS */}
          <TabsContent value="goals" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>What are your goals?</CardTitle>
                <CardDescription>Let’s understand what you want to achieve</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="primary_goal">Primary Goal</Label>
                    <Select
                      value={profile.primary_goal || ''}
                      onValueChange={(v) => updateProfile('primary_goal', v)}
                    >
                      <SelectTrigger id="primary_goal">
                        <SelectValue placeholder="Select an option" />
                      </SelectTrigger>
                      <SelectContent>
                        {GOALS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="secondary_goal">Secondary Goal (optional)</Label>
                    <Select
                      value={profile.secondary_goal || ''}
                      onValueChange={(v) => updateProfile('secondary_goal', v)}
                    >
                      <SelectTrigger id="secondary_goal">
                        <SelectValue placeholder="Select an option" />
                      </SelectTrigger>
                      <SelectContent>
                        {GOALS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="main_challenge">Biggest Challenge</Label>
                  <Textarea
                    id="main_challenge"
                    placeholder="What's your biggest business challenge right now?"
                    rows={3}
                    value={profile.main_challenge || ''}
                    onChange={(e) => updateProfile('main_challenge', e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* FINANCIAL */}
          <TabsContent value="financial" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Financial overview</CardTitle>
                <CardDescription>Help us understand your business size</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="monthly_revenue">Average Monthly Revenue</Label>
                  <Select
                    value={profile.monthly_revenue || ''}
                    onValueChange={(v) => updateProfile('monthly_revenue', v)}
                  >
                    <SelectTrigger id="monthly_revenue">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHLY_REVENUE.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="annual_revenue_last_year">Annual Revenue Last Year</Label>
                  <Select
                    value={profile.annual_revenue_last_year || ''}
                    onValueChange={(v) => updateProfile('annual_revenue_last_year', v)}
                  >
                    <SelectTrigger id="annual_revenue_last_year">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {ANNUAL_REVENUE.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

export default BusinessProfileBuilder
