// src/lib/lender-api/providers/credibly/constants.ts
//
// Vocabularies copied verbatim from Credibly's OpenAPI spec ("ISO API",
// https://api-uat.credibly.com/docs/openapi/openapi.json). Their enums are
// validated server-side, so never "tidy" the spelling.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const CREDIBLY_LENDER_NAME = "Credibly";

/** Sandbox by default — production only when CREDIBLY_API_BASE is set explicitly. */
export const CREDIBLY_DEFAULT_API_BASE = "https://api-uat.credibly.com";
export const CREDIBLY_PROD_API_BASE = "https://api.credibly.com";

/** BusinessOverview.ownership_type. */
export const CREDIBLY_OWNERSHIP_TYPES = [
  "Corporation",
  "Partnership",
  "Limited Partnership",
  "Limited Liability Company",
  "Limited Liability Partnership",
  "Sole Proprietorship",
  "Other",
] as const;

/**
 * SubmissionStatusNormal.status — all 20 values. Anything outside this list is
 * still handled (treated as in-progress), the list is what the reader keys on.
 */
export const CREDIBLY_STATUSES = [
  "Intake",
  "On Hold",
  "Offers Ready",
  "Offers Selected",
  "Contracts Out",
  "Final Diligence",
  "In Pricing",
  "Funded",
  "No Offer Selected",
  "Contracts Not Returned",
  "Contract Rcvd / Not Funded",
  "Withdrawn",
  "No PQ Offers Available",
  "Submitted",
  "On Hold Returned",
  "Online Checkout Review",
  "FastTrack Stip Review",
  "Instant Interview Out",
  "Ready for Funding",
  "Final Diligence, Additional Info Needed",
] as const;

/** An offer exists — underwriting has something to act on. */
export const CREDIBLY_APPROVED_STATUSES: readonly string[] = [
  "Offers Ready",
  "Offers Selected",
  "Contracts Out",
  "Ready for Funding",
  "Funded",
];

/** Credibly is waiting on US — stips, a portal step, an interview. */
export const CREDIBLY_NEEDS_INFO_STATUSES: readonly string[] = [
  "On Hold",
  "On Hold Returned",
  "FastTrack Stip Review",
  "Instant Interview Out",
  "Online Checkout Review",
  "Final Diligence, Additional Info Needed",
];

/** Dead ends that aren't a decline — surfaced as needs_info so a human looks. */
export const CREDIBLY_STALLED_STATUSES: readonly string[] = [
  "No Offer Selected",
  "No PQ Offers Available",
  "Contracts Not Returned",
  "Contract Rcvd / Not Funded",
  "Withdrawn",
];

/**
 * Stips are matched by their text, not by id: the spec enumerates no stip
 * catalogue at all (the only id anywhere is the example "O-2"), so the id is
 * opaque and per-submission. First rule that matches a stip's short/long text
 * claims the doc codes listed with it.
 */
export const CREDIBLY_STIP_RULES: Array<{ test: RegExp; docCodes: readonly string[] }> = [
  { test: /bank\s*statement/i, docCodes: ["business_bank_statements"] },
  {
    test: /signed\s*app|application/i,
    docCodes: ["funding_application", "signed_application"],
  },
  { test: /driver|licen[cs]e|\bid\b/i, docCodes: ["drivers_license", "drivers_license_front", "drivers_license_back"] },
  { test: /voided\s*check|bank\s*letter/i, docCodes: ["voided_check"] },
  { test: /tax\s*return/i, docCodes: ["tax_returns", "personal_tax_returns"] },
  { test: /p\s*&\s*l|profit|income\s*statement|balance\s*sheet/i, docCodes: ["profit_loss", "balance_sheets"] },
  { test: /lease|landlord/i, docCodes: ["lease_agreement"] },
  { test: /incorporat|operating\s*agreement|formation|ownership/i, docCodes: ["articles_of_incorporation", "operating_agreement_bylaws"] },
];
