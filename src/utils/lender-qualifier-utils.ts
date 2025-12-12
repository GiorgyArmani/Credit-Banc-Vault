import type {
  ClientProfile,
  LenderCriteria,
  QualificationResult,
  EvaluationContext,
} from '../types/lender-qualifier-types';

/**
 * Converts credit score range to numeric value for comparison
 * Maps the credit_score enum to a minimum FICO score
 */
export function creditScoreToNumeric(credit_score: string): number {
  const score_map: Record<string, number> = {
    '700+': 700,
    '650-700': 650,
    '600-650': 600,
    '550-600': 550,
    'Below 550': 500,
  };
  return score_map[credit_score] || 500;
}

/**
 * Calculates business age in months from start date
 * Takes the business_start_date and returns months of operation
 */
export function calculateBusinessAgeMonths(start_date: string): number {
  const start = new Date(start_date);
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  return Math.max(0, months);
}

/**
 * Checks if a state is in the restricted states list
 * Handles comma-separated state codes
 */
function isStateRestricted(
  client_state: string,
  restricted_states: string | null
): boolean {
  if (!restricted_states) return false;

  // Parse comma-separated states and trim whitespace
  const restricted_list = restricted_states
    .split(',')
    .map(s => s.trim().toUpperCase());

  return restricted_list.includes(client_state.trim().toUpperCase());
}

/**
 * Checks if loan purpose or business type is in restricted industries
 * Searches for keywords in the restricted industries list
 */
function isIndustryRestricted(
  loan_purpose: string,
  legal_entity_type: string,
  industry: string | undefined,
  restricted_industries: string | null
): boolean {
  if (!restricted_industries) return false;

  const restrictions = restricted_industries.toLowerCase();
  const purpose_lower = loan_purpose.toLowerCase();
  const entity_lower = legal_entity_type.toLowerCase();
  const industry_lower = (industry || '').toLowerCase();

  // Check if any keywords match
  return restrictions.includes(purpose_lower) ||
    restrictions.includes(entity_lower) ||
    (industry_lower !== '' && restrictions.includes(industry_lower));
}

/**
 * Evaluates FICO score requirement
 * Returns true if client meets minimum FICO requirement
 */
function evaluateFicoRequirement(
  context: EvaluationContext,
  results: { passed: string[], failed: string[] }
): boolean {
  const { lender_criteria, numeric_credit_score } = context;

  if (lender_criteria.min_fico === null || lender_criteria.min_fico <= 0) {
    // STRICTER CHECK: If no FICO specified, we don't automatically pass very low scores (< 500)
    // Most legitimate business lenders require at least 500, even for MCA
    const SAFE_FICO_BASELINE = 500;
    if (numeric_credit_score < SAFE_FICO_BASELINE) {
      results.failed.push(`Score ${numeric_credit_score} too low for undefined lender requirement (assumed baseline ${SAFE_FICO_BASELINE})`);
      return false;
    }
    results.passed.push('No specific FICO requirement (Score above baseline)');
    return true;
  }

  if (numeric_credit_score >= lender_criteria.min_fico) {
    results.passed.push(
      `FICO ${numeric_credit_score} meets minimum ${lender_criteria.min_fico}`
    );
    return true;
  } else {
    results.failed.push(
      `FICO ${numeric_credit_score} below minimum ${lender_criteria.min_fico}`
    );
    return false;
  }
}

/**
 * Evaluates time in business requirement
 * Checks if the business has been operating long enough
 */
function evaluateTimeInBusiness(
  context: EvaluationContext,
  results: { passed: string[], failed: string[] }
): boolean {
  const { lender_criteria, business_age_months } = context;

  if (lender_criteria.time_in_business_months === null) {
    results.passed.push('No time in business requirement');
    return true;
  }

  if (business_age_months >= lender_criteria.time_in_business_months) {
    results.passed.push(
      `Business age ${business_age_months} months meets minimum ${lender_criteria.time_in_business_months} months`
    );
    return true;
  } else {
    results.failed.push(
      `Business age ${business_age_months} months below minimum ${lender_criteria.time_in_business_months} months`
    );
    return false;
  }
}

/**
 * Evaluates monthly revenue requirement
 * Compares average monthly revenue against lender minimum
 */
function evaluateMonthlyRevenue(
  context: EvaluationContext,
  results: { passed: string[], failed: string[] }
): boolean {
  const { client_profile, lender_criteria } = context;

  if (lender_criteria.average_monthly_revenue === null) {
    // STRICTER CHECK: If no Revenue specified, we enforce a sane minimum ($10k)
    // This prevents $1 revenue profiles from matching "no-requirement" lenders
    const SAFE_REVENUE_BASELINE = 10000;
    if (client_profile.avg_monthly_deposits < SAFE_REVENUE_BASELINE) {
      results.failed.push(`Revenue $${client_profile.avg_monthly_deposits.toLocaleString()} low for undefined req (baseline $10k)`);
      return false;
    }

    results.passed.push('No monthly revenue requirement');
    return true;
  }

  const monthly_revenue = client_profile.avg_monthly_deposits;

  if (monthly_revenue >= lender_criteria.average_monthly_revenue) {
    results.passed.push(
      `Monthly revenue $${monthly_revenue.toLocaleString()} meets minimum $${lender_criteria.average_monthly_revenue.toLocaleString()}`
    );
    return true;
  } else {
    results.failed.push(
      `Monthly revenue $${monthly_revenue.toLocaleString()} below minimum $${lender_criteria.average_monthly_revenue.toLocaleString()}`
    );
    return false;
  }
}

/**
 * Evaluates monthly deposit count requirement
 * Checks if the number of deposits meets lender minimum
 */
function evaluateDepositCount(
  context: EvaluationContext,
  results: { passed: string[], failed: string[] }
): boolean {
  const { client_profile, lender_criteria } = context;

  if (lender_criteria.monthly_deposits_required === null) {
    results.passed.push('No deposit count requirement');
    return true;
  }

  // If we don't have deposit count data for the client, we skip this check (pass)
  // This ensures backward compatibility with existing profiles that lack this data
  if (client_profile.avg_monthly_deposit_count === undefined ||
    client_profile.avg_monthly_deposit_count === null) {
    results.passed.push('Deposit count data not available - skipping check');
    return true;
  }

  if (client_profile.avg_monthly_deposit_count >= lender_criteria.monthly_deposits_required) {
    results.passed.push(
      `Deposit count ${client_profile.avg_monthly_deposit_count} meets minimum ${lender_criteria.monthly_deposits_required}`
    );
    return true;
  } else {
    results.failed.push(
      `Deposit count ${client_profile.avg_monthly_deposit_count} below minimum ${lender_criteria.monthly_deposits_required}`
    );
    return false;
  }
}

/**
 * Evaluates funding amount requirements
 * Checks if requested capital falls within lender's funding range
 */
function evaluateFundingAmount(
  context: EvaluationContext,
  results: { passed: string[], failed: string[], warnings: string[] }
): boolean {
  const { client_profile, lender_criteria } = context;
  const requested = client_profile.capital_requested;

  let passes = true;

  // Check minimum funding
  if (lender_criteria.min_funding_size !== null) {
    if (requested >= lender_criteria.min_funding_size) {
      results.passed.push(
        `Requested $${requested.toLocaleString()} meets minimum $${lender_criteria.min_funding_size.toLocaleString()}`
      );
    } else {
      results.failed.push(
        `Requested $${requested.toLocaleString()} below minimum $${lender_criteria.min_funding_size.toLocaleString()}`
      );
      passes = false;
    }
  }

  // Check maximum funding
  if (lender_criteria.max_funding_size !== null) {
    if (requested <= lender_criteria.max_funding_size) {
      results.passed.push(
        `Requested $${requested.toLocaleString()} within maximum $${lender_criteria.max_funding_size.toLocaleString()}`
      );
    } else {
      results.warnings.push(
        `Requested $${requested.toLocaleString()} exceeds maximum $${lender_criteria.max_funding_size.toLocaleString()}`
      );
    }
  }

  if (lender_criteria.min_funding_size === null &&
    lender_criteria.max_funding_size === null) {
    results.passed.push('No funding amount restrictions');
  }

  return passes;
}

/**
 * Evaluates state restrictions
 * Checks if the client's business location is in a restricted state
 */
function evaluateStateRestrictions(
  context: EvaluationContext,
  results: { passed: string[], failed: string[] }
): boolean {
  const { client_profile, lender_criteria } = context;

  if (!lender_criteria.restricted_states) {
    results.passed.push('No state restrictions');
    return true;
  }

  if (isStateRestricted(
    client_profile.company_state,
    lender_criteria.restricted_states
  )) {
    results.failed.push(
      `State ${client_profile.company_state} is restricted`
    );
    return false;
  } else {
    results.passed.push(
      `State ${client_profile.company_state} is allowed`
    );
    return true;
  }
}

/**
 * Evaluates industry restrictions
 * Checks if the client's business type is in a restricted industry
 */
function evaluateIndustryRestrictions(
  context: EvaluationContext,
  results: { passed: string[], failed: string[] }
): boolean {
  const { client_profile, lender_criteria } = context;

  if (!lender_criteria.restricted_industries) {
    results.passed.push('No industry restrictions');
    return true;
  }

  if (isIndustryRestricted(
    client_profile.loan_purpose,
    client_profile.legal_entity_type,
    client_profile.industry,
    lender_criteria.restricted_industries
  )) {
    results.failed.push(
      `Industry/Purpose may be restricted: ${client_profile.loan_purpose}`
    );
    return false;
  } else {
    results.passed.push('Industry is allowed');
    return true;
  }
}

/**
 * Evaluates bankruptcy and financial history requirements
 * Checks various negative financial indicators
 */
function evaluateFinancialHistory(
  context: EvaluationContext,
  results: { passed: string[], failed: string[], warnings: string[] }
): boolean {
  const { client_profile, lender_criteria } = context;
  let passes = true;

  // Check bankruptcy restrictions
  // STRICTER: If lender criteria is NULL (unspecified), we default to FALSE (reject) if client has BK.
  const allowsBk = lender_criteria.allows_bankruptcies === true; // Treat null as false

  if (!allowsBk && client_profile.has_bankruptcy_foreclosure_3y) {
    results.failed.push('Recent bankruptcy/foreclosure not allowed');
    passes = false;
  } else if (client_profile.has_bankruptcy_foreclosure_3y) {
    if (lender_criteria.allows_bankruptcies === true) {
      results.warnings.push('Client has recent bankruptcy/foreclosure (Lender allows)');
    } else {
      // Should not reach here due to strict check above, but for safety
      results.failed.push('Recent bankruptcy/foreclosure not allowed');
      passes = false;
    }
  } else {
    results.passed.push('No recent bankruptcy/foreclosure');
  }

  // Check tax liens
  if (client_profile.has_tax_liens) {
    results.warnings.push('Client has tax liens');
  } else {
    results.passed.push('No tax liens');
  }

  // Check active judgements
  if (client_profile.has_active_judgements) {
    results.warnings.push('Client has active judgements');
  } else {
    results.passed.push('No active judgements');
  }

  // Check defaulted MCA
  if (client_profile.has_defaulted_mca && !client_profile.mca_was_satisfied) {
    results.warnings.push('Unsatisfied MCA default');
  }

  // Check home-based business
  if (client_profile.is_home_based) {
    results.warnings.push('Home-based business');
  }

  return passes;
}

/**
 * Evaluates existing loan positions
 * Checks the number of existing positions against lender requirements
 */
function evaluateExistingPositions(
  context: EvaluationContext,
  results: { passed: string[], failed: string[], warnings: string[] }
): boolean {
  const { client_profile, lender_criteria } = context;

  if (lender_criteria.number_of_positions === null) {
    results.passed.push('No position limit');
    return true;
  }

  // This would need to be calculated from actual position data
  // For now, we'll use has_existing_loans as a proxy
  if (client_profile.has_existing_loans) {
    results.warnings.push(
      `Client has existing loans - verify position count does not exceed ${lender_criteria.number_of_positions}`
    );
  } else {
    results.passed.push('No existing positions');
  }

  return true;
}

/**
 * Main function to evaluate a client against a specific lender's criteria
 * Returns a comprehensive qualification result
 */
export function evaluateLenderQualification(
  client_profile: ClientProfile,
  lender_criteria: LenderCriteria
): QualificationResult {
  // Prepare evaluation context
  const context: EvaluationContext = {
    client_profile,
    lender_criteria,
    business_age_months: calculateBusinessAgeMonths(
      client_profile.business_start_date
    ),
    numeric_credit_score: client_profile.exact_credit_score ?? creditScoreToNumeric(
      client_profile.credit_score
    ),
  };

  // Track evaluation results
  const passed_criteria: string[] = [];
  const failed_criteria: string[] = [];
  const warnings: string[] = [];

  const results = {
    passed: passed_criteria,
    failed: failed_criteria,
    warnings: warnings,
  };

  // Run all evaluations
  const evaluations = [
    evaluateFicoRequirement(context, results),
    evaluateTimeInBusiness(context, results),
    evaluateMonthlyRevenue(context, results),
    evaluateDepositCount(context, results),
    evaluateFundingAmount(context, results),
    evaluateStateRestrictions(context, results),
    evaluateIndustryRestrictions(context, results),
    evaluateFinancialHistory(context, results),
    evaluateExistingPositions(context, results),
  ];

  // Determine if qualified (all critical evaluations passed)
  const is_qualified = evaluations.every(result => result === true);

  // Calculate match score
  const total_criteria = passed_criteria.length + failed_criteria.length;
  const match_score = total_criteria > 0
    ? Math.round((passed_criteria.length / total_criteria) * 100)
    : 0;

  return {
    lender_name: lender_criteria.lender_name,
    specialty: lender_criteria.specialty,
    is_qualified,
    match_score,
    matched_criteria: passed_criteria,
    failed_criteria,
    warnings,
    min_funding: lender_criteria.min_funding_size,
    max_funding: lender_criteria.max_funding_size,
    payment_type: lender_criteria.payment_type,
  };
}

/**
 * Evaluates a client against all lenders and returns sorted results
 * Returns qualified lenders first, sorted by match score
 */
export function evaluateAllLenders(
  client_profile: ClientProfile,
  all_lenders: LenderCriteria[]
): QualificationResult[] {
  // Evaluate against each lender
  const results = all_lenders.map(lender =>
    evaluateLenderQualification(client_profile, lender)
  );

  // Sort by qualification status and match score
  return results.sort((a, b) => {
    // Qualified lenders first
    if (a.is_qualified !== b.is_qualified) {
      return a.is_qualified ? -1 : 1;
    }
    // Then by match score (descending)
    return b.match_score - a.match_score;
  });
}