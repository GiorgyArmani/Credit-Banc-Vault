// src/lib/lender-api/providers/forward-financing/constants.ts
//
// Vocabularies copied verbatim from https://apidocs.forwardfinancing.com (re-checked 2026-10-20).
// FF rejects (422) any value not in these lists, so never "tidy" the spelling.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const FF_LENDER_NAME = "Forward Financing";

/** FF's documented webhook source IPs. */
export const FF_WEBHOOK_IPS = ["18.213.237.69", "44.199.142.45", "44.199.142.90"] as const;

export const FF_ATTACHMENT_BATCH_SIZE = 25;

export const FF_ENTITY_TYPES = [
  "Sole Proprietor",
  "Limited Liability Company (LLC)",
  "Corporation",
  "Limited Partnership (LP)",
  "Limited Liability Partnership (LLP)",
  "General Partnership",
] as const;

export const FF_REVENUE_BUCKETS = [
  "Less than $5,000",
  "$5,000 - $10,000",
  "$10,000 - $20,000",
  "$20,000 - $50,000",
  "$50,000 - $100,000",
  "Greater than $100,000",
] as const;

export const FF_INDUSTRIES = [
  "Accounting & Tax Services", "Automotive Services", "Consulting",
  "Convenience Stores, Markets & Delis/Bakeries", "Education / Schools / Daycare",
  "Electricians, Plumbing & HVAC", "Farming & Agriculture", "Furniture & Home Furnishings",
  "Gas Stations & Fuel Services", "General Contractor", "Gyms/Fitness", "Home-healthcare / Senior Care",
  "Hotels / Motels / Hospitality", "Janitorial & Cleaning Services", "Jewelry", "Landscaping & Lawn Services",
  "Law firms", "Manufacturing", "Medical Professionals", "Other Business Services", "Other Consumer",
  "Pharmacies", "Real Estate / Insurance Brokers", "Recycling", "Restaurants & Bars", "Retail Businesses",
  "Salons & Spas", "Security Guard Services", "Staffing agencies", "Subcontractor", "Ticket / Concert Venues",
  "Travel Agencies", "Trucking & Transportation", "Wholesale & Distribution", "Wine & Liquor Stores",
] as const;

/**
 * Spellings FF used before they renamed their vocabularies (Oct 2026). Picks
 * saved on older submission rows are translated, never shown as invalid.
 * An old industry value was silently dropped by FF (seen as "missing").
 */
export const FF_LEGACY_PICK_VALUES: Record<string, Record<string, string>> = {
  entity_type: {
    LLC: "Limited Liability Company (LLC)",
    "Limited Partnership": "Limited Partnership (LP)",
    "Limited Liability Partnership": "Limited Liability Partnership (LLP)",
  },
  monthly_revenue: {
    "$5,000-$10,000": "$5,000 - $10,000",
    "$10,000-$20,000": "$10,000 - $20,000",
    "$20,000-$50,000": "$20,000 - $50,000",
    "$50,000-$100,000": "$50,000 - $100,000",
  },
  industry_name: {
    Automotive: "Automotive Services",
    "Convenience Stores": "Convenience Stores, Markets & Delis/Bakeries",
    Education: "Education / Schools / Daycare",
    "Electricians/Plumbing/HVAC": "Electricians, Plumbing & HVAC",
    Farming: "Farming & Agriculture",
    Furniture: "Furniture & Home Furnishings",
    "Gas Stations": "Gas Stations & Fuel Services",
    Gyms: "Gyms/Fitness",
    "Home Healthcare": "Home-healthcare / Senior Care",
    "Hotels/Hospitality": "Hotels / Motels / Hospitality",
    Janitorial: "Janitorial & Cleaning Services",
    Landscaping: "Landscaping & Lawn Services",
    "Law Firms": "Law firms",
    Medical: "Medical Professionals",
    "Real Estate/Insurance": "Real Estate / Insurance Brokers",
    Retail: "Retail Businesses",
    "Security Guard": "Security Guard Services",
    Staffing: "Staffing agencies",
    "Ticket/Concert Venues": "Ticket / Concert Venues",
    Travel: "Travel Agencies",
    "Wine & Liquor": "Wine & Liquor Stores",
  },
};

export const FF_LOAN_USES = [
  "Inventory", "Marketing", "Taxes", "Payroll", "Debt Refinancing", "Business Expansion",
  "New Location", "Renovation", "Equipment Purchase", "Equipment Repair", "Hiring Employees",
  "Other", "Misc. Business Expenses", "Materials", "Working Capital",
] as const;
