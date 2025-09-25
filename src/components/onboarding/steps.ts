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

export interface Field {
  key: keyof BusinessProfile
  label: string
  type: "input" | "textarea" | "select"
  placeholder?: string
  options?: string[]
  required?: boolean
}

export interface Step {
  title: string
  description: string
  fields: Field[]
}

export const steps: Step[] = [
  {
    title: "Tell us about your business",
    description: "Help us understand what you do",
    fields: [
      { key: "business_name", label: "Business Name", type: "input", placeholder: "e.g., Great Business LLC", required: true },
      { key: "business_description", label: "Business Description", type: "textarea", placeholder: "Describe your business...", required: true },
      {
        key: "years_in_business",
        label: "How many years in business?",
        type: "select",
        required: true,
        options: ["Less than 1 year", "1-2 years", "3-5 years", "6-10 years", "More than 10 years"]
      },
      {
        key: "industry",
        label: "Industry",
        type: "select",
        required: true,
        options: [
          "Accommodation and Food Services", "Administrative and Support Services",
          "Agriculture, Forestry, Fishing and Hunting", "Arts, Entertainment, and Recreation",
          "Construction", "Educational Services", "Finance and Insurance",
          "Health Care and Social Assistance", "Information", "Manufacturing",
          "Mining, Quarrying, and Oil and Gas Extraction", "Other Services (except Public Administration)",
          "Professional, Scientific, and Technical Services", "Real Estate and Rental and Leasing",
          "Retail Trade", "Transportation and Warehousing", "Utilities", "Wholesale Trade"
        ]
      },
      {
        key: "business_model",
        label: "Business Model",
        type: "select",
        required: true,
        options: ["Service-based","Product-based","E-commerce","SaaS/Software","Consulting","Agency","Retail","Other"]
      },
    ],
  },
  {
    title: "What are your goals?",
    description: "Let's understand what you want to achieve",
    fields: [
      {
        key: "primary_goal",
        label: "Primary Goal",
        type: "select",
        required: true,
        options: ["Increase revenue","Scale operations","Improve efficiency","Expand market reach","Launch new products","Build team","Improve Fundability","Other"]
      },
      {
        key: "secondary_goal",
        label: "Secondary Goal",
        type: "select",
        options: ["Increase revenue","Scale operations","Improve efficiency","Expand market reach","Launch new products","Build team","Improve Fundability","Other"]
      },
      {
        key: "main_challenge",
        label: "Biggest Challenge",
        type: "textarea",
        required: true,
        placeholder: "What's your biggest business challenge right now?"
      },
    ],
  },
  {
    title: "Financial overview",
    description: "Help us understand your business size",
    fields: [
      {
        key: "monthly_revenue",
        label: "Average Monthly Revenue",
        type: "select",
        options: ["Less than $6K","$6K - $10K","$10K - $20K","$30K - $50K","$50K - $100K","$100K - $250K","More than $500K"]
      },
      {
        key: "annual_revenue_last_year",
        label: "Annual Revenue Last Year",
        type: "select",
        options: ["Less than $60K","$60K - $200K","$200K - $500K","$500K - $1M","$1M - $5M","$5M - $10M","More than $15M"]
      },
    ],
  },
]
