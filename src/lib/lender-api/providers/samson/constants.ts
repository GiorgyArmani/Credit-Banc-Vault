// src/lib/lender-api/providers/samson/constants.ts
//
// Samson Funding takes deals through a Salesforce Apex REST endpoint.
// Docs: https://documenter.getpostman.com/view/29487822/2sBYHSz1cC — two
// requests only (Create Record, Document Upload), with no enum lists, no status
// endpoint and no webhook. Everything below marked UNCONFIRMED is our best
// reading of their single example and must be checked with Samson.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const SAMSON_LENDER_NAME = "Samson Funding";
export const SAMSON_DISPLAY_NAME = "Samson Funding";

/** Our sales office name on every submission (sales.salesOffice). */
export const SAMSON_SALES_OFFICE = "Credit Banc";

/** UNCONFIRMED: their example only shows "New". */
export const SAMSON_DEAL_TYPES = ["New", "Renewal"] as const;

/**
 * Document Upload `docType`. Only "Bank Statements" appears in their docs; the
 * rest are UNCONFIRMED guesses in the same style. A docType they reject shows
 * on that one file and can be retried, so nothing else is lost.
 */
export const SAMSON_DOC_TYPES: Array<{ docType: string; docCodes: readonly string[] }> = [
  { docType: "Bank Statements", docCodes: ["business_bank_statements", "bank_statement"] },
  { docType: "Application", docCodes: ["funding_application", "signed_application"] },
  { docType: "Processing Statements", docCodes: ["merchant_processing_statements", "processing_statements"] },
  { docType: "Driver's License", docCodes: ["drivers_license", "drivers_license_front", "drivers_license_back"] },
  { docType: "Voided Check", docCodes: ["voided_check"] },
  {
    docType: "Financials",
    docCodes: ["profit_loss", "balance_sheets", "tax_returns", "business_tax_returns", "tax_return", "personal_tax_returns"],
  },
];
