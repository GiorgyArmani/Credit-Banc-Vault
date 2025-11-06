/**
 * Lender Qualifier Component
 * Main React component for displaying qualified lenders based on client profile
 * This component evaluates a client from the client_data_vault against all lender criteria
 */

import React, { useState, useMemo } from 'react';
import type { 
  ClientProfile, 
  LenderCriteria, 
  QualificationResult 
} from '@/types/lender-qualifier-types';
import { 
  evaluateAllLenders,
  creditScoreToNumeric,
  calculateBusinessAgeMonths 
} from '@/utils/lender-qualifier-utils';

interface LenderQualifierProps {
  // Client profile data from client_data_vault table
  client_profile: ClientProfile;
  // All lender criteria loaded from the spreadsheet
  lender_criteria: LenderCriteria[];
  // Optional callback when user selects a lender
  on_lender_select?: (lender: QualificationResult) => void;
  // Optional custom styling
  class_name?: string;
}

/**
 * Individual lender card component
 * Displays qualification result with detailed breakdown
 */
const LenderCard: React.FC<{
  result: QualificationResult;
  on_select?: () => void;
}> = ({ result, on_select }) => {
  const [is_expanded, set_is_expanded] = useState(false);
  
  return (
    <div 
      className={`
        lender-card 
        ${result.is_qualified ? 'qualified' : 'not-qualified'}
        ${is_expanded ? 'expanded' : ''}
      `}
    >
      {/* Header section with lender name and status */}
      <div className="lender-card-header">
        <div className="lender-info">
          <h3 className="lender-name">{result.lender_name}</h3>
          {result.specialty && (
            <span className="lender-specialty">{result.specialty}</span>
          )}
        </div>
        
        <div className="lender-status">
          <div className={`status-badge ${result.is_qualified ? 'qualified' : 'not-qualified'}`}>
            {result.is_qualified ? '✓ Qualified' : '✗ Not Qualified'}
          </div>
          <div className="match-score">
            <span className="score-value">{result.match_score}%</span>
            <span className="score-label">Match</span>
          </div>
        </div>
      </div>
      
      {/* Funding information */}
      <div className="lender-funding-info">
        {result.min_funding && (
          <div className="funding-detail">
            <span className="label">Min:</span>
            <span className="value">${result.min_funding.toLocaleString()}</span>
          </div>
        )}
        {result.max_funding && (
          <div className="funding-detail">
            <span className="label">Max:</span>
            <span className="value">${result.max_funding.toLocaleString()}</span>
          </div>
        )}
        {result.payment_type && (
          <div className="funding-detail">
            <span className="label">Type:</span>
            <span className="value">{result.payment_type}</span>
          </div>
        )}
      </div>
      
      {/* Expand/collapse button */}
      <button 
        className="expand-button"
        onClick={() => set_is_expanded(!is_expanded)}
      >
        {is_expanded ? 'Hide Details' : 'Show Details'}
      </button>
      
      {/* Expanded details section */}
      {is_expanded && (
        <div className="lender-details">
          {/* Matched criteria */}
          {result.matched_criteria.length > 0 && (
            <div className="criteria-section">
              <h4 className="section-title">✓ Matched Criteria</h4>
              <ul className="criteria-list matched">
                {result.matched_criteria.map((criterion: string, index: number) => (
                  <li key={index}>{criterion}</li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Failed criteria */}
          {result.failed_criteria.length > 0 && (
            <div className="criteria-section">
              <h4 className="section-title">✗ Failed Criteria</h4>
              <ul className="criteria-list failed">
                {result.failed_criteria.map((criterion: string, index: number) => (
                  <li key={index}>{criterion}</li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="criteria-section">
              <h4 className="section-title">⚠ Warnings</h4>
              <ul className="criteria-list warnings">
                {result.warnings.map((warning: string, index: number) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      
      {/* Action button */}
      {result.is_qualified && on_select && (
        <button 
          className="select-lender-button"
          onClick={on_select}
        >
          Select This Lender
        </button>
      )}
    </div>
  );
};

/**
 * Main Lender Qualifier Component
 * Evaluates client and displays all lender options
 */
export const LenderQualifier: React.FC<LenderQualifierProps> = ({
  client_profile,
  lender_criteria,
  on_lender_select,
  class_name = '',
}) => {
  // State for filter and sort options
  const [filter_specialty, set_filter_specialty] = useState<string>('all');
  const [show_only_qualified, set_show_only_qualified] = useState<boolean>(false);
  const [sort_by, set_sort_by] = useState<'match' | 'name' | 'funding'>('match');
  
  // Evaluate all lenders against the client profile
  const evaluation_results = useMemo(() => {
    return evaluateAllLenders(client_profile, lender_criteria);
  }, [client_profile, lender_criteria]);
  
  // Get unique specialties for filter dropdown
  const specialties = useMemo(() => {
    const unique = new Set(
      lender_criteria
        .map(l => l.specialty)
        .filter((s): s is string => s !== null)
    );
    return Array.from(unique).sort();
  }, [lender_criteria]);
  
  // Apply filters and sorting
  const filtered_results = useMemo(() => {
    let results = [...evaluation_results];
    
    // Filter by specialty
    if (filter_specialty !== 'all') {
      results = results.filter(r => r.specialty === filter_specialty);
    }
    
    // Filter by qualification status
    if (show_only_qualified) {
      results = results.filter(r => r.is_qualified);
    }
    
    // Apply sorting
    results.sort((a, b) => {
      switch (sort_by) {
        case 'match':
          return b.match_score - a.match_score;
        case 'name':
          return a.lender_name.localeCompare(b.lender_name);
        case 'funding':
          const a_min = a.min_funding || 0;
          const b_min = b.min_funding || 0;
          return a_min - b_min;
        default:
          return 0;
      }
    });
    
    return results;
  }, [evaluation_results, filter_specialty, show_only_qualified, sort_by]);
  
  // Calculate summary statistics
  const summary = useMemo(() => {
    const total = evaluation_results.length;
    const qualified = evaluation_results.filter((r: QualificationResult) => r.is_qualified).length;
    const avg_match = Math.round(
      evaluation_results.reduce((sum: number, r: QualificationResult) => sum + r.match_score, 0) / total
    );
    
    return { total, qualified, avg_match };
  }, [evaluation_results]);
  
  return (
    <div className={`lender-qualifier ${class_name}`}>
      {/* Header with client info */}
      <div className="qualifier-header">
        <h2 className="qualifier-title">Lender Qualification Results</h2>
        <div className="client-summary">
          <div className="client-info">
            <span className="client-name">{client_profile.client_name}</span>
            <span className="company-name">{client_profile.company_name}</span>
          </div>
          <div className="request-summary">
            <span className="requested-amount">
              ${client_profile.capital_requested.toLocaleString()} requested
            </span>
            <span className="loan-type">{client_profile.proposed_loan_type}</span>
          </div>
        </div>
      </div>
      
      {/* Summary statistics */}
      <div className="qualification-summary">
        <div className="summary-card">
          <div className="summary-value">{summary.qualified}</div>
          <div className="summary-label">Qualified Lenders</div>
        </div>
        <div className="summary-card">
          <div className="summary-value">{summary.total}</div>
          <div className="summary-label">Total Lenders</div>
        </div>
        <div className="summary-card">
          <div className="summary-value">{summary.avg_match}%</div>
          <div className="summary-label">Avg Match Score</div>
        </div>
      </div>
      
      {/* Filters and sorting controls */}
      <div className="qualifier-controls">
        <div className="filter-group">
          <label htmlFor="specialty-filter">Specialty:</label>
          <select
            id="specialty-filter"
            value={filter_specialty}
            onChange={(e) => set_filter_specialty(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Specialties</option>
            {specialties.map(specialty => (
              <option key={specialty} value={specialty}>
                {specialty}
              </option>
            ))}
          </select>
        </div>
        
        <div className="filter-group">
          <label htmlFor="sort-by">Sort By:</label>
          <select
            id="sort-by"
            value={sort_by}
            onChange={(e) => set_sort_by(e.target.value as any)}
            className="filter-select"
          >
            <option value="match">Match Score</option>
            <option value="name">Lender Name</option>
            <option value="funding">Funding Amount</option>
          </select>
        </div>
        
        <div className="filter-group checkbox-group">
          <label>
            <input
              type="checkbox"
              checked={show_only_qualified}
              onChange={(e) => set_show_only_qualified(e.target.checked)}
            />
            <span>Show Only Qualified</span>
          </label>
        </div>
      </div>
      
      {/* Results count */}
      <div className="results-count">
        Showing {filtered_results.length} of {evaluation_results.length} lenders
      </div>
      
      {/* Lender results grid */}
      <div className="lender-results-grid">
        {filtered_results.length > 0 ? (
          filtered_results.map((result) => (
            <LenderCard
              key={result.lender_name}
              result={result}
              on_select={
                on_lender_select 
                  ? () => on_lender_select(result)
                  : undefined
              }
            />
          ))
        ) : (
          <div className="no-results">
            <p>No lenders match the current filters.</p>
            <button onClick={() => {
              set_filter_specialty('all');
              set_show_only_qualified(false);
            }}>
              Reset Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LenderQualifier;