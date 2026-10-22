// src/lib/lender-api/providers/samson/constants.ts
//
// Samson Funding takes deals through a Salesforce Apex REST endpoint.
// Docs: https://documenter.getpostman.com/view/29487822/2sBYHSz1cC — two
// requests only (Create Record, Document Upload), no status endpoint and no
// webhook. Required fields and picklists confirmed by Samson on 2026-10-22.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const SAMSON_LENDER_NAME = "Samson Funding";
export const SAMSON_DISPLAY_NAME = "Samson Funding";

/** Our sales office name on every submission (sales.salesOffice, max 50 chars). */
export const SAMSON_SALES_OFFICE = "Credit Banc";

// Picklists below are copied verbatim from Samson's reply. Their system rejects
// anything off-list, so never "tidy" the spelling.

export const SAMSON_DEAL_TYPES = ["New", "Renewal"] as const;

export const SAMSON_ENTITY_TYPES = [
  "C-Corp",
  "S-Corp",
  "Corporation",
  "Limited Liability Company (LLC)",
  "LLC",
  "LLP",
  "Limited Partnership",
  "Partnership",
  "Sole Proprietor",
  "Sole Proprietorship",
  "Sales Prop",
] as const;

export const SAMSON_INDUSTRIES = [
  "Agriculture and Landscaping", "Apparel and Accessories", "Automotive/Bicycle", "Banking",
  "Beauty Salon / Spa", "Biotechnology", "Building Materials", "Business Services", "Chemicals",
  "Communications", "Construction", "Consulting", "Education", "Electronics", "Energy", "Engineering",
  "Entertainment", "Environmental", "Finance", "Food & Beverage", "Garden Store / Retail Nursery",
  "General Merchandise", "Government", "Grocery and Baked Goods", "Healthcare", "Health Services",
  "Home Furnishing", "Hospitality", "Hotel, Motel, and Lodging", "Insurance", "Laundry and Garment Services",
  "Machinery", "Manufacturing", "Media", "Not For Profit", "Other", "Recreation", "Restaurant/Bar",
  "Retail Store", "Shipping", "Technology", "Telecommunications", "Travel and Transportation", "Utilities",
  "Veterinary Clinic", "Wholesale",
] as const;

/**
 * Document Upload `docType` — Samson's full list (it also has "Plaid JSON",
 * which we never hold). A file with no type here is reported as unsendable,
 * never sent under a wrong type.
 */
export const SAMSON_DOC_TYPES: Array<{ docType: string; docCodes: readonly string[] }> = [
  { docType: "Bank Statements", docCodes: ["business_bank_statements", "bank_statement"] },
  { docType: "Signed Application", docCodes: ["funding_application", "funding_application_lenders", "signed_application"] },
  { docType: "Tax Returns", docCodes: ["tax_returns", "business_tax_returns", "tax_return", "personal_tax_returns"] },
  { docType: "Credit Report", docCodes: ["myscoreiq", "credit_report"] },
  { docType: "VC", docCodes: ["voided_check"] },
  { docType: "DL", docCodes: ["drivers_license", "drivers_license_front", "drivers_license_back"] },
];
