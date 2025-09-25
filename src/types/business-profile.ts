export interface BusinessProfile {
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

export interface BusinessProfileBuilderProps {
  initialProfile?: BusinessProfile
  onSave: (profile: BusinessProfile) => void
  onClose: () => void
}
