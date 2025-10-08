// src/schema.ts
import { z } from "zod";

// Owner schema - only validate if data is provided
const owner_schema = z.object({
  first_name: z.string().min(1, "Owner first name is required"),
  last_name: z.string().min(1, "Owner last name is required"),
  ownership_pct: z.number().min(0).max(100),
});

// Loan schema for outstanding loans
const loan_schema = z.object({
  balance: z.number().optional(),
  lender_name: z.string().optional(),
  term: z.string().optional(),
});

const outstanding_loans_schema = z.object({
  loan1: loan_schema.optional(),
  loan2: loan_schema.optional(),
  loan3: loan_schema.optional(),
}).optional();

export const ClientSignupSchema = z.object({
  // Contact Information
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(1, "Phone number is required"),
  
  // Business Information
  company_legal_name: z.string().min(1, "Company name is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  zip: z.string().min(1, "ZIP code is required"),
  
  // Financial Information
  amount_requested: z.number().min(1, "Funding amount is required"),
  legal_entity_type: z.string().min(1, "Entity type is required"),
  industry_1: z.string().optional(),
  industry_2: z.string().optional(),
  industry_3: z.string().optional(),
  use_of_funds: z.string().min(1, "Use of funds is required"),
  business_start_date: z.string().min(1, "Business start date is required"),
  avg_monthly_deposits: z.number().min(0),
  annual_revenue: z.number().min(0),
  credit_score: z.string().min(1, "Credit score is required"),
  sbss_score: z.number().optional().nullable(),
  
  // Owners - make it optional and filter empty ones
  owners: z.array(owner_schema).optional().default([]),
  
  // Outstanding Loans
  outstanding_loans: outstanding_loans_schema,
  has_previous_debt: z.boolean().optional().default(false),
  
  // Risk Flags
  defaulted_on_mca: z.boolean().optional().default(false),
  reduced_mca_payments: z.boolean().optional().default(false),
  owns_real_estate: z.boolean().optional().default(false),
  personal_cc_debt_over_75k: z.boolean().optional().default(false),
  personal_cc_debt_amount: z.number().optional().nullable(),
  foreclosures_or_bankruptcies_3y: z.boolean().optional().default(false),
  bk_fc_months_ago: z.number().optional().nullable(),
  bk_fc_type: z.string().optional().nullable(),
  tax_liens: z.boolean().optional().default(false),
  tax_liens_type: z.string().optional().nullable(),
  tax_liens_amount: z.number().optional().nullable(),
  tax_liens_on_plan: z.boolean().optional().default(false),
  judgements_explain: z.string().optional().nullable(),
  
  // Additional
  how_soon_funds: z.string().optional().nullable(),
  employees_count: z.number().optional().nullable(),
  additional_info: z.string().optional().nullable(),
  documents_requested: z.array(z.string()).default([]),
  
  // Advisor reference
  advisor_id: z.string().optional().nullable(),
});

export type ClientSignupPayload = z.infer<typeof ClientSignupSchema>;