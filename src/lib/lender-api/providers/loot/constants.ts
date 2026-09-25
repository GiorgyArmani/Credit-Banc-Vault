// src/lib/lender-api/providers/loot/constants.ts
//
// Copied from https://loot-us.readme.io (Loot External APIs v1). Their enums
// are validated server-side, so never "tidy" the spelling.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const LOOT_LENDER_NAME = "Loot";

/** Staging by default — production only when LOOT_API_BASE is set explicitly. */
export const LOOT_DEFAULT_API_BASE = "https://api-dev.getloot.com";
export const LOOT_PROD_API_BASE = "https://api-prod.getloot.com";

/** entityType — required. */
export const LOOT_ENTITY_TYPES = ["SOLE PROPRIETORSHIP", "CORPORATION", "LLC", "NON-PROFIT", "PARTNERSHIP"] as const;

/** industry — optional. "other" pairs with industryOther (free text). */
export const LOOT_INDUSTRIES = [
  "agriculture",
  "construction",
  "manufacturing",
  "wholesale",
  "retail-store",
  "online-store",
  "transportation-trucking",
  "finance-insurance",
  "real-estate",
  "professional-services",
  "healthcare",
  "arts-entertainment",
  "hotels",
  "restaurants-bars",
  "other",
] as const;

/** "requestingAmount: required number (should be > 5000)". */
export const LOOT_MIN_REQUEST = 5000;
/** "estimatedAnnualRevenue: required number (should be > 25000)". */
export const LOOT_MIN_ANNUAL_REVENUE = 25000;

/**
 * DEAL_DECISION `deal_stage` values, from their webhook payload examples.
 * The lender approved — or the customer took the offer, which implies it.
 */
export const LOOT_APPROVED_STAGES: readonly string[] = ["approved", "approvedOffer", "LocOfferApproved", "acceptedByCustomer"];
/** Loot declined the deal ("when RBF / LOC is declined"). */
export const LOOT_DECLINED_STAGES: readonly string[] = ["approvedOfferDeclined"];
/** The customer turned the offer down — not a lender decline, so a human looks. */
export const LOOT_CUSTOMER_DECLINED_STAGES: readonly string[] = ["declineByCustomer", "LocOfferDeclined"];

export const LOOT_DEAL_DECISION = "DEAL_DECISION";
