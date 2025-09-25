import { z } from "zod";

const Owner = z.object({ name: z.string().min(1), ownership_pct: z.coerce.number().min(0).max(100) });
const Loan  = z.object({ balance: z.coerce.number().optional(), lender_name: z.string().optional(), term: z.string().optional() });

export const ClientSignupSchema = z.object({
  // COMPANY / CONTACT
  client_full_name: z.string().min(1),
  company_legal_name: z.string().min(1),
  phone: z.string().min(7),
  email: z.string().email(),
  state: z.string().min(2), city: z.string().min(1), zip: z.string().min(3),
  // GOAL
  amount_requested: z.coerce.number().int().positive(),
  proposed_loan_type: z.string().min(1),
  use_of_funds: z.string().min(2),
  // OWNERS
  owners_count: z.enum(["one","more"]),
  owners: z.array(Owner).max(5).default([]),
  // LEGAL + INDUSTRY
  legal_entity_type: z.string().min(1), home_based: z.coerce.boolean().optional(),
  industry_1: z.string().optional(), industry_2: z.string().optional(), industry_3: z.string().optional(),
  // DATES / MONEY
  business_start_date: z.string(), avg_monthly_deposits: z.coerce.number().nonnegative(),
  annual_revenue: z.coerce.number().nonnegative(),
  // SCORES
  credit_score: z.enum(["700","680","650","600","400"]),
  sbss_score: z.coerce.number().optional(),
  // DEBT
  has_previous_debt: z.coerce.boolean().optional(),
  outstanding_loans: z.object({ loan1: Loan.optional(), loan2: Loan.optional(), loan3: Loan.optional() }).optional(),
  // RISKS
  defaulted_on_mca: z.coerce.boolean().optional(),
  reduced_mca_payments: z.coerce.boolean().optional(),
  owns_real_estate: z.coerce.boolean().optional(),
  personal_cc_debt_over_75k: z.coerce.boolean().optional(),
  foreclosures_or_bankruptcies_3y: z.coerce.boolean().optional(),
  tax_liens: z.coerce.boolean().optional(),
  judgements: z.coerce.boolean().optional(),
  // Logic details
  personal_cc_debt_amount: z.coerce.number().optional(),
  bk_fc_months_ago: z.coerce.number().optional(),
  bk_fc_type: z.string().optional(), // foreclosure|bankruptcy|both
  tax_liens_type: z.string().optional(), // personal|business
  tax_liens_amount: z.coerce.number().optional(),
  tax_liens_on_plan: z.coerce.boolean().optional(),
  judgements_explain: z.string().optional(),
  // TIMING
  how_soon_funds: z.string().optional(),
  employees_count: z.coerce.number().int().nonnegative().optional(),
  additional_info: z.string().optional(),
  // DOCS REQUESTED (última pantalla: checkboxes)
  documents_requested: z.array(z.enum([
    "Funding Application","Business Bank Statements","Business/Personal Tax Returns",
    "Profit & Loss Stament","Balance Sheet","Debt Schedule","A/R Report","Driver's License","Voided Check"
  ])).default([]),

  advisor_id: z.string().optional()
});
export type ClientSignupInput = z.infer<typeof ClientSignupSchema>;
