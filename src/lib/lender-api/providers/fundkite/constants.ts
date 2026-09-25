// src/lib/lender-api/providers/fundkite/constants.ts
//
// From Fundkite's developer portal (developers.fundkite.com, login-only — no
// public spec). Verify anything marked UNCONFIRMED against the sandbox.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const FUNDKITE_LENDER_NAME = "Fundkite";

/**
 * One host for sandbox and production: the credentials decide which adapter
 * a deal is routed through ("Simulator requests … route through the
 * development adapter").
 */
export const FUNDKITE_DEFAULT_API_BASE = "https://developers.fundkite.com";

/**
 * type_of_entity — "Legal structure of the business". UNCONFIRMED: the doc
 * gives no value list, so this is the common vocabulary; a sandbox 422 names
 * the accepted ones.
 */
export const FUNDKITE_ENTITY_TYPES = [
  "LLC",
  "Corporation",
  "Sole Proprietorship",
  "Partnership",
  "Limited Liability Partnership",
  "Non-Profit",
] as const;

/** POST /api/v1/deals/{id}/documents `type` values, verbatim. */
export const FUNDKITE_DOCUMENT_TYPES: Array<{ type: string; docCodes: readonly string[] }> = [
  { type: "application", docCodes: ["funding_application", "signed_application"] },
  { type: "bank_statement", docCodes: ["business_bank_statements"] },
  { type: "identification", docCodes: ["drivers_license", "drivers_license_front", "drivers_license_back"] },
  { type: "voided_check", docCodes: ["voided_check"] },
  { type: "processing_statement", docCodes: ["merchant_processing_statements", "processing_statements"] },
  { type: "tax_return", docCodes: ["tax_returns", "personal_tax_returns", "business_tax_returns"] },
];
/** Anything we can't place goes to the deal's general submission documents. */
export const FUNDKITE_OTHER_DOCUMENT_TYPE = "other";

/** Portal `status`: our intake pipeline, not the underwriting decision. */
export const FUNDKITE_INTAKE_FAILED = "failed";
