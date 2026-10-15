// src/lib/lender-api/providers/pirs/constants.ts
//
// PIRS Capital — Pirs Portal Web API (Swashbuckle "PIRS API" v1, help page
// https://pirsportal.com/help). Every format below was CONFIRMED against the
// sandbox validator on 2026-10-15. Never tidy the spelling.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const PIRS_LENDER_NAME = "PIRS";
export const PIRS_DISPLAY_NAME = "PIRS Capital";

/** Sandbox. Production (https://pirsportal.com) only by an explicit env change. */
export const PIRS_DEFAULT_API_BASE = "https://pirsportalcom-pirstest.azurewebsites.net";
export const PIRS_PROD_API_BASE = "https://pirsportal.com";

/** Application.type — the swagger enum. */
export const PIRS_COMPANY_TYPES = [
  "Corp",
  "LLC",
  "LP",
  "LLP",
  "SoleProp",
  "Partnership",
  "Other",
  "Individual",
  "Estates_And_Trusts",
] as const;

/** owner1–owner4: the API has four owner slots. */
export const PIRS_MAX_OWNERS = 4;

/**
 * Statuses, as the portal's own deal-list filters group them (sandbox,
 * 2026-10-15). The API returned "Submitted" for a new deal — the same enum
 * name the filters use — so the API is read with these names. Anything not
 * listed reads as in progress.
 */
export const PIRS_APPROVED_STATUSES: readonly string[] = [
  "Offer",
  "ContractSent",
  "SignedContractUploaded",
  "FinalReview",
  "ContractProcessing",
  "MissingStips",
  "Funded",
];
export const PIRS_DECLINED_STATUSES: readonly string[] = ["Rejected"];
export const PIRS_MISSING_INFO_STATUSES: readonly string[] = [
  "MissingInfo_Submitted",
  "MissingInfo_Underwriting",
  "MissingInfo_Verification",
];
/** The merchant turned PIRS's offer down — not a lender decision. */
export const PIRS_MERCHANT_REJECTED_STATUS = "MerchantRejected";

/** Display names the portal dashboard uses for the in-progress groups. */
export const PIRS_STAGE_LABELS: Record<string, string> = {
  Saved: "Saved (not submitted)",
  PreSubmitted: "Submitted",
  Submitted: "Submitted",
  MissingInfoSubmitted_Submitted: "Submitted (missing info sent)",
  ReadyForUnderwriting: "Underwriting",
  ReadyForUnderwriting_Verification: "Underwriting",
  Verification: "Pre-underwriting",
  MissingInfoSubmitted_Verification: "Pre-underwriting (missing info sent)",
  MissingInfoSubmitted_Underwriting: "Underwriting (missing info sent)",
  MissingStipsSubmitted: "Pre-underwriting (stips sent)",
};
