// src/lib/lender-api/providers/forward-financing/constants.ts
//
// Vocabularies copied verbatim from https://apidocs.forwardfinancing.com.
// FF rejects (422) any value not in these lists, so never "tidy" the spelling.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const FF_LENDER_NAME = "Forward Financing";

/** FF's documented webhook source IPs. */
export const FF_WEBHOOK_IPS = ["18.213.237.69", "44.199.142.45", "44.199.142.90"] as const;

export const FF_ATTACHMENT_BATCH_SIZE = 25;

export const FF_ENTITY_TYPES = [
  "Sole Proprietor",
  "LLC",
  "Corporation",
  "Limited Partnership",
  "Limited Liability Partnership",
  "General Partnership",
] as const;

export const FF_REVENUE_BUCKETS = [
  "Less than $5,000",
  "$5,000-$10,000",
  "$10,000-$20,000",
  "$20,000-$50,000",
  "$50,000-$100,000",
  "Greater than $100,000",
] as const;

export const FF_INDUSTRIES = [
  "Accounting & Tax Services", "Automotive", "Consulting", "Convenience Stores", "Education",
  "Electricians/Plumbing/HVAC", "Farming", "Furniture", "Gas Stations", "General Contractor",
  "Gyms", "Home Healthcare", "Hotels/Hospitality", "Janitorial", "Jewelry", "Landscaping",
  "Law Firms", "Manufacturing", "Medical", "Other Business Services", "Other Consumer",
  "Pharmacies", "Real Estate/Insurance", "Recycling", "Restaurants & Bars", "Retail",
  "Salons & Spas", "Security Guard", "Staffing", "Subcontractor", "Ticket/Concert Venues",
  "Travel", "Trucking & Transportation", "Wholesale & Distribution", "Wine & Liquor",
] as const;

export const FF_LOAN_USES = [
  "Inventory", "Marketing", "Taxes", "Payroll", "Debt Refinancing", "Business Expansion",
  "New Location", "Renovation", "Equipment Purchase", "Equipment Repair", "Hiring Employees",
  "Other", "Misc. Business Expenses", "Materials", "Working Capital",
] as const;
