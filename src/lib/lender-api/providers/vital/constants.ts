// src/lib/lender-api/providers/vital/constants.ts
//
// Vital Cap runs on LendTech / LendSaaS. Copied from their Partner API spec
// (https://vitalcapfund.lendtech.io/backend/api/docs/partners.yml, v1.0.0).
// Never "tidy" the spelling of a vocabulary below.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const VITAL_LENDER_NAME = "Vital Cap";
export const VITAL_DISPLAY_NAME = "Vital Cap";

/**
 * Document.category for POST /deal-submission/{id}/document. Their full list
 * also has Business Lease/ Business Mortgage, Business License, Balance Letter,
 * Trade Reference, Proof of majority ownership, Misc License, Signed Contract,
 * UCCs, External Signed Doc, External Unsigned Doc, Calculator and Other. We
 * only send what we can name with certainty; nothing goes up as "Other".
 */
export const VITAL_DOCUMENT_CATEGORIES: Array<{ category: string; docCodes: readonly string[] }> = [
  { category: "Signed Application", docCodes: ["funding_application", "signed_application"] },
  { category: "Bank Statements", docCodes: ["business_bank_statements", "bank_statement"] },
  { category: "Processing Statements", docCodes: ["merchant_processing_statements", "processing_statements"] },
  { category: "Drivers License", docCodes: ["drivers_license", "drivers_license_front", "drivers_license_back"] },
  { category: "Voided Check", docCodes: ["voided_check"] },
  {
    category: "Financials",
    docCodes: ["profit_loss", "balance_sheets", "tax_returns", "business_tax_returns", "tax_return", "personal_tax_returns"],
  },
];

/**
 * UNCONFIRMED: the spec documents no status field or vocabulary on a deal
 * submission (callbacks are `sub_status_update.<status>`, the list is theirs
 * to give us). Until Vital confirms it, a stage is read by keyword and
 * anything unrecognised stays in progress.
 */
export const VITAL_DECLINED_PATTERN = /declin|reject|dead|killed|not\s*interested|no\s*offer|withdrawn/i;
export const VITAL_APPROVED_PATTERN = /approv|offer|contract|funded/i;
export const VITAL_NEEDS_INFO_PATTERN = /pending\s*(docs|info|stip)|missing|stip|need|info\s*requested|hold|incomplete/i;
