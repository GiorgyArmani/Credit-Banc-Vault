/**
 * Canonical list of loan/product types used across the app.
 *
 * Keep this single source of truth — it powers:
 *   - the Specialty picker in the Lender Database (lender-guidelines-manager.tsx)
 *   - the Loan Type dropdown for each client Open Position (bank-analysis.tsx)
 *
 * Anywhere else that needs to render or validate a loan type should import
 * from here so the vocabulary stays in sync across advisor/UW tools.
 */
export const LOAN_TYPES: readonly string[] = [
    "MCA",
    "SBA",
    "LOC",
    "Equipment",
    "Amortizing",
    "Term Loan",
    "Real Estate",
    "Trucking",
    "Invoice Factoring",
    "Consolidation",
    "Reverse consolidation",
    "Contract Financing",
    "Acquisition",
    "General",
];
