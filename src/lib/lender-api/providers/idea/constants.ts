// src/lib/lender-api/providers/idea/constants.ts
//
// Idea Financial Universal Broker API. Idea publishes no schema we can read
// (their swagger is not served), so every vocabulary below was taken from
// their Postman collection and then CONFIRMED against the sandbox validator
// on 2026-10-07: a value not listed here fails with "The provided value is
// not valid." Never tidy the spelling.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const IDEA_LENDER_NAME = "IDEA";
export const IDEA_DISPLAY_NAME = "Idea Financial";

/** Sandbox. Production (.com) only by an explicit env change. */
export const IDEA_DEFAULT_API_BASE = "https://partner.api.ideafinancial.net";
export const IDEA_DEFAULT_TOKEN_URL = "https://oauth.ideafinancial.net/token";

/** business.entityType — the complete list the sandbox accepts. */
export const IDEA_ENTITY_TYPES = [
  "sole-proprietorship",
  "limited-liability-company",
  "corporation",
  "general-partnership",
  "limited-partnership",
  "not-for-profit",
  "other",
] as const;

/** business.timeInBusiness — the complete list the sandbox accepts. */
export const IDEA_TIME_IN_BUSINESS = ["zero-one-years", "one-two-years", "over-two-years"] as const;

/**
 * documentType on POST /v1/applications/{id}/files. Only these two exist at
 * submission; everything else goes up later as a checkout requirement.
 */
export const IDEA_DOCUMENT_TYPES: Array<{ type: string; docCodes: readonly string[] }> = [
  { type: "application", docCodes: ["funding_application", "signed_application"] },
  { type: "bank-statement", docCodes: ["business_bank_statements", "bank_statement"] },
];

/** Per-type file caps while the application is in Draft. */
export const IDEA_DRAFT_FILE_LIMITS: Record<string, number> = { "bank-statement": 6, application: 4 };

export const IDEA_MAX_FILE_BYTES = 20 * 1024 * 1024;

export const IDEA_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
};
