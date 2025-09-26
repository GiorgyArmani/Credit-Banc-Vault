import { z } from "zod";

const Owner = z.object({
  first_name: z.string().min(1, "Owner first name is required"),
  last_name:  z.string().min(1, "Owner last name is required"),
  ownership_pct: z.coerce.number().min(0).max(100),
});
const Loan  = z.object({
  balance: z.coerce.number().optional(),
  lender_name: z.string().optional(),
  term: z.string().optional()
});

export const ClientSignupSchema = z.object({
  // CONTACT (advisor collects this on the call)
  first_name: z.string().min(1),
  last_name:  z.string().min(1),
  email:      z.string().email(),
  phone:      z.string().min(7).optional(),

  // COMPANY / LOCATION (lo que realmente uses)
  company_legal_name: z.string().min(1),
  city:  z.string().optional(),
  state: z.string().optional(),
  zip:   z.string().optional(),

  // GOAL / PROFILE
  amount_requested: z.coerce.number().int().positive(),
  legal_entity_type: z.string().min(1),
  industry_1: z.string().optional(),
  industry_2: z.string().optional(),
  industry_3: z.string().optional(),
  business_start_date: z.string().optional(), // "YYYY-MM" or "YYYY-MM-DD"
  avg_monthly_deposits: z.coerce.number().nonnegative().optional(),
  annual_revenue:       z.coerce.number().nonnegative().optional(),
  credit_score: z.string().optional(), // keep string for flexibility ("680-700", etc.)
  sbss_score:   z.coerce.number().optional(),
  use_of_funds: z.string().optional(),

  // OWNERS
  owners_count: z.enum(["one", "more"]).optional(),
  owners: z.array(Owner).max(5).default([]),

  // DEBT
  has_previous_debt: z.coerce.boolean().optional(),
  outstanding_loans: z.object({
    loan1: Loan.optional(),
    loan2: Loan.optional(),
    loan3: Loan.optional(),
  }).optional(),

  // RISK FLAGS
  defaulted_on_mca: z.coerce.boolean().optional(),
  reduced_mca_payments: z.coerce.boolean().optional(),
  owns_real_estate: z.coerce.boolean().optional(),
  personal_cc_debt_over_75k: z.coerce.boolean().optional(),
  foreclosures_or_bankruptcies_3y: z.coerce.boolean().optional(),
  tax_liens: z.coerce.boolean().optional(),
  judgements: z.coerce.boolean().optional(),

  // Conditional details (when toggles above are true)
  personal_cc_debt_amount: z.coerce.number().optional(),
  bk_fc_months_ago: z.coerce.number().optional(),
  bk_fc_type: z.string().optional(), // foreclosure | bankruptcy | both
  tax_liens_type: z.string().optional(), // personal | business
  tax_liens_amount: z.coerce.number().optional(),
  tax_liens_on_plan: z.coerce.boolean().optional(),
  judgements_explain: z.string().optional(),

  // TIMING
  how_soon_funds: z.string().optional(),
  employees_count: z.coerce.number().int().nonnegative().optional(),
  additional_info: z.string().optional(),

  // DOCS (checkboxes at the end)
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

  advisor_id: z.string().optional(),
});

export type ClientSignupInput = z.infer<typeof ClientSignupSchema>;
