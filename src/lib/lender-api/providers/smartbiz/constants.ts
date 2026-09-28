// src/lib/lender-api/providers/smartbiz/constants.ts
//
// From SmartBiz's partner API (https://partner-api-service.smartbizloans.com/redoc,
// spec at /openapi.json). Vocabularies are verbatim.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const SMARTBIZ_LENDER_NAME = "SmartBiz";

export const SMARTBIZ_DEFAULT_API_BASE = "https://partner-api-service.smartbizloans.com";

export const SMARTBIZ_MIN_AMOUNT = 50_000;
export const SMARTBIZ_MAX_AMOUNT = 350_000;
/** Submissions carry every owner at or above this share, and none below it. */
export const SMARTBIZ_MIN_OWNER_PCT = 20;

/** BusinessType */
export const SMARTBIZ_BUSINESS_TYPES = ["contractor", "llc", "sprop", "scorp", "ccorp", "llp", "gp", "lp", "np", "pg", "pl", "plp"] as const;

/** ProductType, plus our "any" = omit requested_products so every product is evaluated. */
export const SMARTBIZ_PRODUCTS = ["any", "sba7a", "conventional", "line_of_credit"] as const;

/** Answer */
export const SMARTBIZ_ANSWERS = ["yes", "no", "not_sure"] as const;

/** Our doc codes → ValidDocumentTypes. Tax returns are bucketed by year separately. */
export const SMARTBIZ_DOCUMENT_TYPES: Array<{ type: string; docCodes: readonly string[] }> = [
  { type: "bank_statement", docCodes: ["business_bank_statements", "bank_statement"] },
  { type: "profit_and_loss", docCodes: ["profit_loss"] },
  { type: "business_debt_schedule", docCodes: ["debt_schedule"] },
  { type: "drivers_license", docCodes: ["drivers_license", "drivers_license_front", "drivers_license_back"] },
  { type: "voided_check", docCodes: ["voided_check"] },
];
export const SMARTBIZ_BUSINESS_TAX_CODES = ["tax_returns", "business_tax_returns", "tax_return"] as const;
export const SMARTBIZ_PERSONAL_TAX_CODES = ["personal_tax_returns"] as const;
export const SMARTBIZ_OTHER_DOCUMENT_TYPE = "miscellaneous";

/** Webhook event we subscribe to. */
export const SMARTBIZ_WEBHOOK_EVENT = "loan.state_changed";
