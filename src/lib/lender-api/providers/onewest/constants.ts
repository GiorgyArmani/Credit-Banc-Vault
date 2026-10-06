// src/lib/lender-api/providers/onewest/constants.ts
//
// Copied from https://1west.readme.io (Partner API 1.1.0). Their enums are
// validated server-side, so never "tidy" the spelling.

/** The lender_guidelines.lender_name UW assigns ("1 West", with a space). */
export const ONEWEST_LENDER_NAME = "1 West";
export const ONEWEST_DISPLAY_NAME = "1West";

/** Staging by default — production only when ONEWEST_API_BASE is set explicitly. */
export const ONEWEST_DEFAULT_API_BASE = "https://api-staging.1west.com/v1";
export const ONEWEST_PROD_API_BASE = "https://api.1west.com/v1";

/** Package.legal_entity_type — required. */
export const ONEWEST_ENTITY_TYPES = [
  "Sole Proprietor",
  "Limited Liability Company (LLC)",
  "Corporation",
  "Limited Partnership (LP)",
  "Limited Liability Partnership (LLP)",
  "General Partnership",
] as const;

/** Contact.credit_score — optional. "Below 619" is on their list too; we never pick it. */
export const ONEWEST_CREDIT_SCORES = [
  "Excellent (720+)",
  "Great (680 - 719)",
  "Average (650 - 679)",
  "Fair (600 - 649)",
  "Not so Great (599 or less)",
  "Below 619",
] as const;

export const ONEWEST_US_CITIZEN = ["Yes", "No"] as const;

/** Document.type for POST /documents/{uuid}. */
export const ONEWEST_DOCUMENT_TYPES: Array<{ type: string; docCodes: readonly string[] }> = [
  { type: "Application", docCodes: ["funding_application", "signed_application"] },
  { type: "Bank Statement", docCodes: ["business_bank_statements", "bank_statement"] },
  { type: "Tax Return", docCodes: ["tax_returns", "business_tax_returns", "tax_return", "personal_tax_returns"] },
  { type: "Voided Check", docCodes: ["voided_check"] },
  { type: "Driver's License", docCodes: ["drivers_license", "drivers_license_front", "drivers_license_back"] },
];

/** Bank statements go up as "Bank Statement 1" (newest), "2" and "3". Each slot is needed for a complete file. */
export const ONEWEST_BANK_STATEMENT_SLOTS = ["Bank Statement 1", "Bank Statement 2", "Bank Statement 3"] as const;

/** "Maximum decoded file size: 10MB", PDF/JPG/PNG only. */
export const ONEWEST_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ONEWEST_FILE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"] as const;

/**
 * Webhook `status` values (their "Status" table). OPEN statuses are live;
 * CLOSED ones end the deal.
 */
export const ONEWEST_APPROVED_STATUSES: readonly string[] = [
  "Approved",
  "Pitched",
  "Offer Accepted",
  "Contracts Out",
  "Contracts In",
  "Funded",
];
export const ONEWEST_DECLINED_STATUSES: readonly string[] = ["Declined Across the Board", "Unqualified"];
/** The deal closed without a lender decline (the customer walked, or it timed out) — a human looks. */
export const ONEWEST_CLOSED_STATUSES: readonly string[] = [
  "Client Cancelled Application",
  "Customer Declined Offer",
  "Submission Pending - Timed Out",
  "Submitted - Timed Out",
  "Approved - Timed Out",
  "Pitched - Timed Out",
  "Offer Accepted - Timed Out",
  "Contracts Out - Timed Out",
  "Contracts In - Timed Out",
];
