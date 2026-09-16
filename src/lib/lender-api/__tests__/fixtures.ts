// src/lib/lender-api/__tests__/fixtures.ts
//
// A complete, valid LenderApiSource. Every provider's mapping tests start from
// this and override the one thing under test.
import type { LenderApiSource } from "@/lib/lender-api/types";
import { resolveVaultFields, scopeResolvedToBusiness, type SourceVault } from "@/lib/lender-api/vault-fields";

type Overrides = {
  assignment?: Partial<LenderApiSource["assignment"]>;
  vault?: Partial<SourceVault>;
  business?: Partial<NonNullable<LenderApiSource["business"]>> | null;
  deal?: Partial<NonNullable<LenderApiSource["deal"]>> | null;
  analysis?: Partial<NonNullable<LenderApiSource["analysis"]>> | null;
  openPositions?: LenderApiSource["openPositions"];
};

export function makeSource(o: Overrides = {}): LenderApiSource {
  const vault: SourceVault = {
    id: "vault-1",
    user_id: "user-1",
    client_name: "Jane Doe",
    client_email: "jane@example.com",
    client_phone: "(305) 555-0100",
    company_name: "Doe Plumbing LLC",
    dba: null,
    ein: "12-3456789",
    ssn: "123-45-6789",
    legal_entity_type: "LLC",
    industry: "Plumbing and HVAC",
    business_start_date: "2018-05-01",
    business_address: "10 Pipe St, Miami, FL 33101",
    business_street: null,
    company_city: "Miami",
    company_state: "FL",
    company_zip_code: "33101",
    owner_1_name: "Jane Doe",
    owner_1_ownership_pct: 100,
    owner_1_dob: "1980-02-03",
    owner_1_home_phone: null,
    home_address: "22 Palm Ave, Miami, FL 33130",
    owner_1_street: null,
    owner_1_city: null,
    owner_1_state: null,
    owner_1_zip: null,
    owner_2_name: null,
    owner_2_ownership_pct: null,
    avg_monthly_deposits: 42000,
    capital_requested: 50000,
    loan_purpose: "working capital",
    ...o.vault,
  };
  const business: LenderApiSource["business"] =
    o.business === null
      ? null
      : {
          id: "bp-1",
          is_primary: true,
          business_name: "Doe Plumbing",
          company_name: "Doe Plumbing LLC",
          legal_entity_type: "LLC",
          industry: "Plumbing and HVAC",
          business_start_date: "2018-05-01",
          phone: "3055550199",
          company_city: "Miami",
          company_state: "FL",
          company_zip_code: "33101",
          avg_monthly_deposits: 42000,
          ...o.business,
        };
  return {
    assignment: {
      id: "assign-1",
      client_id: vault.id,
      business_profile_id: "bp-1",
      funding_deal_id: "deal-1",
      lender_name: "Forward Financing",
      specialty: null,
      decision: "approved",
      admin_review: "approved",
      status: "pending",
      ...o.assignment,
    },
    vault,
    // Same scoping loadLenderApiSource applies, so a non-primary fixture is realistic.
    resolved: scopeResolvedToBusiness(resolveVaultFields(vault), business),
    business,
    deal:
      o.deal === null
        ? null
        : { id: "deal-1", capital_requested: 50000, loan_purpose: "working capital", file_synopsis: null, ...o.deal },
    analysis: o.analysis === null ? null : { avg_revenue: 45000, avg_monthly_deposits: 42000, ...o.analysis },
    openPositions: o.openPositions ?? [],
  };
}
