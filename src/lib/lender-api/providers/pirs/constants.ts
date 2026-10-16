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

/** owner1–owner4: the API has four owner slots. PIRS stores 3 and 4 but echoes only 1–2 (confirmed 2026-10-16). */
export const PIRS_MAX_OWNERS = 4;

/**
 * Statuses. PIRS's complete list (their email, 2026-10-16): PreSubmitted,
 * Submitted, PreUnderwriting, ReadyForUnderwriting,
 * ReadyForUnderwriting_Verification, Verification, Rejected, Offer,
 * MerchantRejected, RequestContract, ContractSent, ContractOut,
 * SignedContractUploaded, ContractProcessing, MissingStips,
 * MissingStipsSubmitted, FinalReview, Funded. Approved = Offer or anything
 * after it (stips are post-offer conditions). Anything not listed reads as in
 * progress.
 */
export const PIRS_APPROVED_STATUSES: readonly string[] = [
  "Offer",
  "RequestContract",
  "ContractSent",
  "ContractOut",
  "SignedContractUploaded",
  "FinalReview",
  "ContractProcessing",
  "MissingStips",
  "MissingStipsSubmitted",
  "Funded",
];
export const PIRS_DECLINED_STATUSES: readonly string[] = ["Rejected"];
/** Portal deal-list filter names, absent from PIRS's API list; kept in case they surface. */
export const PIRS_MISSING_INFO_STATUSES: readonly string[] = [
  "MissingInfo_Submitted",
  "MissingInfo_Underwriting",
  "MissingInfo_Verification",
];
/** The merchant turned PIRS's offer down — not a lender decision. */
export const PIRS_MERCHANT_REJECTED_STATUS = "MerchantRejected";

/** PIRS's per-file limit (their email, 2026-10-16). No file-type or file-count limit. */
export const PIRS_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Display names the portal dashboard uses for the in-progress groups. */
export const PIRS_STAGE_LABELS: Record<string, string> = {
  Saved: "Saved (not submitted)",
  PreSubmitted: "Submitted",
  Submitted: "Submitted",
  MissingInfoSubmitted_Submitted: "Submitted (missing info sent)",
  PreUnderwriting: "Pre-underwriting",
  ReadyForUnderwriting: "Underwriting",
  ReadyForUnderwriting_Verification: "Underwriting",
  Verification: "Pre-underwriting",
  MissingInfoSubmitted_Verification: "Pre-underwriting (missing info sent)",
  MissingInfoSubmitted_Underwriting: "Underwriting (missing info sent)",
};
