/**
 * Single canonical list of funding products this app deals in. Used for:
 *   - Proposed loan type pickers when the advisor creates / edits a client
 *     vault or adds a business (the advisor's selection on the client's behalf)
 *   - Loan Type dropdown on a client's existing Open Positions (prior debt
 *     the client carries)
 *   - Specialty picker in the in-app Lender Database
 *
 * The external lender marketplace's own specialty taxonomy is out of scope —
 * we record whatever the lender uses verbatim in DB, but the in-app pickers
 * stick to this list.
 *
 * `LOAN_TYPES` is kept as an alias so existing imports (bank-analysis,
 * lender-guidelines-manager) keep working without churn.
 */

export const FUNDING_OPTIONS: readonly string[] = [
    "SBA Loan",
    "Term Loan",
    "Revenue Based Loan",
    "Factor",
    "Equipment",
    "Project Financing",
    "Line of Credit",
    "E-commerce",
    "Purchase Order Financing",
    "Real Estate Loan",
    "Inventory Financing",
    "Acquisition",
    "Personal Term Loan",
    "MCA",
    "AR Loan",
    "Other",
];

export const LOAN_TYPES = FUNDING_OPTIONS;
