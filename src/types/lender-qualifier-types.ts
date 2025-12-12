/**
 * Type definitions for the Lender Qualifier Component
 * These types map to both the client_data_vault database schema
 * and the lender criteria spreadsheet
 */

// Client profile from the database
export interface ClientProfile {
  id: string;
  client_name: string;
  company_name: string;
  company_state: string;
  company_city: string | null;
  capital_requested: number;
  loan_purpose: string;
  proposed_loan_type: string;
  avg_monthly_deposits: number; // This is the $ amount
  avg_monthly_deposit_count?: number; // This is the count (number of deposits)
  avg_annual_revenue: number;
  legal_entity_type: string;
  business_start_date: string; // ISO date string
  is_home_based: boolean;
  employees_count: number;
  credit_score: '700+' | '650-700' | '600-650' | '550-600' | 'Below 550';
  exact_credit_score?: number; // For more precise calculation
  industry?: string; // For restricted industry checks
  has_existing_loans: boolean;
  has_defaulted_mca: boolean;
  mca_was_satisfied: boolean | null;
  owns_real_estate: boolean;
  has_reduced_mca_payments: boolean;
  has_personal_debt_over_75k: boolean | null;
  has_bankruptcy_foreclosure_3y: boolean;
  has_tax_liens: boolean;
  has_active_judgements: boolean;
  has_zbl: boolean | null;
  funding_eta: string;
  additional_notes: string;
}

// Lender criteria from the spreadsheet
export interface LenderCriteria {
  lender_name: string;
  specialty: string | null;
  min_fico: number | null;
  min_sbss: number | null;
  time_in_business_months: number | null;
  negative_days: number | null;
  monthly_deposits_required: number | null;
  average_monthly_revenue: number | null;
  average_daily_balances: number | null;
  preferred_industries: string | null;
  restricted_industries: string | null;
  restricted_industry_exceptions: string | null;
  restricted_states: string | null;
  ownership_requirement_pct: number | null;
  number_of_positions: number | null;
  allows_bankruptcies: boolean | null;
  tax_liens_limit: number | null;
  min_funding_size: number | null;
  max_funding_size: number | null;
  auto_decline_reasons: string | null;
  holdback_percentage: string | null;
  payment_type: string | null;
  consolidation_positions: number | null;
  additional_information: string | null;
}

// Result of lender qualification evaluation
export interface QualificationResult {
  lender_name: string;
  specialty: string | null;
  is_qualified: boolean;
  match_score: number; // 0-100, percentage of criteria matched
  matched_criteria: string[];
  failed_criteria: string[];
  warnings: string[];
  min_funding: number | null;
  max_funding: number | null;
  payment_type: string | null;
}

// Evaluation context for detailed analysis
export interface EvaluationContext {
  client_profile: ClientProfile;
  lender_criteria: LenderCriteria;
  business_age_months: number;
  numeric_credit_score: number;
}