// src/schema.ts
import { z } from "zod";

// Owner schema: Defines structure for business owners with ownership percentage
const Owner = z.object({
  first_name: z.string().min(1, "Owner first name is required"),
  last_name: z.string().min(1, "Owner last name is required"),
  ownership_pct: z.coerce.number().min(0).max(100),
});

// Loan schema: Defines structure for outstanding loans
const Loan = z.object({
  balance: z.coerce.number().optional(),
  lender_name: z.string().optional(),
  term: z.string().optional()
});

// Main client signup schema
export const ClientSignupSchema = z.object({
  // ============================================
  // CONTACT INFORMATION
  // Basic client contact details collected during initial call
  // ============================================
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(7, "Phone number must be at least 7 characters").optional(),

  // ============================================
  // COMPANY & LOCATION
  // Business entity and location information
  // ============================================
  company_legal_name: z.string().min(1, "Company legal name is required"),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),

  // ============================================
  // FUNDING GOALS & BUSINESS PROFILE
  // Information about funding needs and business characteristics
  // ============================================
  // amount_requested: Total funding amount the client is seeking
  amount_requested: z.coerce.number().int().positive("Amount must be positive"),
  
  // legal_entity_type: Business structure (LLC, Corporation, etc.)
  legal_entity_type: z.string().min(1, "Entity type is required"),
  
  // industry fields: Up to 3 industry categories for the business
  industry_1: z.string().optional(),
  industry_2: z.string().optional(),
  industry_3: z.string().optional(),
  
  // business_start_date: When the business was established (format: "YYYY-MM" or "YYYY-MM-DD")
  business_start_date: z.string().optional(),
  
  // avg_monthly_deposits: Average monthly revenue deposits
  avg_monthly_deposits: z.coerce.number().nonnegative().optional(),
  
  // annual_revenue: Total annual revenue
  annual_revenue: z.coerce.number().nonnegative().optional(),
  
  // credit_score: Personal credit score (kept as string for flexibility like "680-700")
  credit_score: z.string().optional(),
  
  // sbss_score: Small Business Scoring Service score
  sbss_score: z.coerce.number().optional(),
  
  // use_of_funds: Description of how funds will be used
  use_of_funds: z.string().optional(),

  // ============================================
  // BUSINESS OWNERS
  // Information about business ownership structure
  // ============================================
  // owners_count: Indicates if there's one owner or multiple
  owners_count: z.enum(["one", "more"]).optional(),
  
  // owners: Array of owner objects with details and ownership percentages
  owners: z.array(Owner).max(5).default([]),

  // ============================================
  // EXISTING DEBT
  // Information about current business debts and obligations
  // ============================================
  // has_previous_debt: Boolean flag indicating if business has existing debt
  has_previous_debt: z.coerce.boolean().optional(),
  
  // outstanding_loans: Up to 3 existing loans with details
  outstanding_loans: z.object({
    loan1: Loan.optional(),
    loan2: Loan.optional(),
    loan3: Loan.optional(),
  }).optional(),

  // ============================================
  // RISK FLAGS & FINANCIAL HISTORY
  // Yes/No questions about potential risk factors
  // ============================================
  // defaulted_on_mca: Has the business defaulted on a Merchant Cash Advance?
  defaulted_on_mca: z.coerce.boolean().optional(),
  
  // reduced_mca_payments: Has the business had MCA payments reduced/restructured?
  reduced_mca_payments: z.coerce.boolean().optional(),
  
  // owns_real_estate: Does the business or owner own real estate?
  owns_real_estate: z.coerce.boolean().optional(),
  
  // personal_cc_debt_over_75k: Personal credit card debt exceeds $75,000?
  personal_cc_debt_over_75k: z.coerce.boolean().optional(),
  
  // foreclosures_or_bankruptcies_3y: Any foreclosures or bankruptcies in last 3 years?
  foreclosures_or_bankruptcies_3y: z.coerce.boolean().optional(),
  
  // tax_liens: Any active tax liens against business or owner?
  tax_liens: z.coerce.boolean().optional(),
  
  // judgements: Any legal judgements against business or owner?
  judgements: z.coerce.boolean().optional(),

  // ============================================
  // CONDITIONAL RISK DETAILS
  // Additional details required when certain risk flags are true
  // ============================================
  // personal_cc_debt_amount: Exact amount if personal_cc_debt_over_75k is true
  personal_cc_debt_amount: z.coerce.number().optional(),
  
  // bk_fc_months_ago: How many months ago was the bankruptcy/foreclosure?
  bk_fc_months_ago: z.coerce.number().optional(),
  
  // bk_fc_type: Type of event (foreclosure | bankruptcy | both)
  bk_fc_type: z.string().optional(),
  
  // tax_liens_type: Whether lien is personal or business
  tax_liens_type: z.string().optional(),
  
  // tax_liens_amount: Total amount of tax liens
  tax_liens_amount: z.coerce.number().optional(),
  
  // tax_liens_on_plan: Is there a payment plan in place for tax liens?
  tax_liens_on_plan: z.coerce.boolean().optional(),
  
  // judgements_explain: Text explanation of any judgements
  judgements_explain: z.string().optional(),

  // ============================================
  // TIMING & ADDITIONAL INFO
  // Information about funding urgency and other details
  // ============================================
  // how_soon_funds: How quickly the client needs funding
  how_soon_funds: z.string().optional(),
  
  // employees_count: Number of employees in the business
  employees_count: z.coerce.number().int().nonnegative().optional(),
  
  // additional_info: Any other relevant information not captured above
  additional_info: z.string().optional(),

  // ============================================
  // DOCUMENT REQUESTS
  // Checkboxes for which documents need to be collected from client
  // ============================================
  documents_requested: z.array(z.enum([
    "Funding Application",
    "Business Bank Statements",
    "Business/Personal Tax Returns",
    "Profit & Loss Stament",
    "Balance Sheet",
    "Debt Schedule",
    "A/R Report",
    "Driver's License",
    "Voided Check",
  ])).default([]),

  // ============================================
  // ADVISOR ASSIGNMENT
  // Links this client to a specific advisor
  // ============================================
  // advisor_id: UUID of the advisor from the advisors table
  // This is now REQUIRED to ensure every client has an assigned advisor
  advisor_id: z.string().uuid("Please select an advisor"),
});

// Export the TypeScript type inferred from the schema
export type ClientSignupInput = z.infer<typeof ClientSignupSchema>;