import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import {
  buildSmartBizApplication,
  clientReferenceUuid,
  interpretSmartBizStatus,
  mapSmartBizBusinessType,
  smartBizDocumentUpload,
  type SmartBizApplication,
} from "../mapping";

const ctx = { referenceId: "cb-assign-1-1" };
// Plumbing and HVAC is not a NAICS title; use a real one for the happy path.
const PLUMBING = "Plumbing, Heating, and Air-Conditioning Contractors";
const ANSWERS = { has_defaulted_on_government_guaranteed_loan: "no", has_past_bankruptcy: "no" };

function build(source = makeSource({ business: { industry: PLUMBING } }), picks: Record<string, string> = ANSWERS) {
  const built = buildSmartBizApplication(source, picks, ctx);
  return { built, app: built.payload as SmartBizApplication };
}

describe("smartbiz application", () => {
  it("builds a complete business + submission with no gaps", () => {
    const { built, app } = build();
    expect(built.gaps).toEqual([]);
    expect(app.clientReferenceId).toBe(clientReferenceUuid("cb-assign-1-1"));
    expect(app.business).toEqual({
      tin: { type: "ein", value: "123456789" },
      name: "Doe Plumbing LLC",
      inception_date: "2018-05-01",
      type: "llc",
      addresses: [{ tags: ["primary"], address_1: "10 Pipe St", city: "Miami", state: "FL", zip: "33101" }],
      industry: "238220",
      profile: { number_of_employees: 6, annual_revenue: 540000 },
      phone_numbers: [{ number: "3055550199", name: "business" }],
      email: "jane@example.com",
      client_reference_id: app.clientReferenceId,
      owners: [
        {
          percent_owned: 100,
          type: "person",
          owner: {
            first_name: "Jane",
            last_name: "Doe",
            ssn: "123456789",
            birthday: "1980-02-03",
            email: "jane@example.com",
            phone_numbers: [{ number: "3055550100", name: "mobile" }],
            addresses: [{ tags: ["primary"], address_1: "22 Palm Ave", city: "Miami", state: "FL", zip: "33130" }],
          },
        },
      ],
    });
    expect(app.submission).toEqual({
      loan_application: { amount_requested: 50000 },
      client_reference_id: app.clientReferenceId,
      business_history: {
        business_operating_at_least_two_years: "yes",
        has_past_bankruptcy: "no",
        has_defaulted_on_government_guaranteed_loan: "no",
      },
    });
  });

  it("client reference id is a deterministic UUID4", () => {
    const a = clientReferenceUuid("cb-x-1");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(clientReferenceUuid("cb-x-1")).toBe(a);
    expect(clientReferenceUuid("cb-x-2")).not.toBe(a);
  });

  it("redacts the SSN in the stored snapshot only", () => {
    const { built, app } = build();
    expect(app.business.owners[0].owner.ssn).toBe("123456789");
    expect((built.redacted as SmartBizApplication).business.owners[0].owner.ssn).toBe("*****6789");
  });

  it("legacy free-text industry is a gap that names the value", () => {
    const { built } = build(makeSource({ business: { industry: "Restaurant" } }));
    expect(built.gaps).toContainEqual({
      field: "business:industry",
      label: "Industry needs a NAICS code (currently \"Restaurant\")",
      kind: "invalid",
    });
  });

  it("blank industry is a missing gap", () => {
    const { built } = build(makeSource({ business: { industry: null }, vault: { industry: null } }));
    expect(built.gaps).toContainEqual({ field: "business:industry", label: "Industry (NAICS)", kind: "missing" });
  });

  it("accepts a stored 6-digit code as the industry", () => {
    expect(build(makeSource({ business: { industry: "238220" } })).app.business.industry).toBe("238220");
  });

  it("zero employees is a gap", () => {
    const { built } = build(makeSource({ business: { industry: PLUMBING, employees_count: 0 } }));
    expect(built.gaps).toContainEqual({ field: "business:employees_count", label: "Employee count is 0 — confirm it", kind: "invalid" });
  });

  it("missing employees is a gap", () => {
    const { built } = build(makeSource({ business: { industry: PLUMBING, employees_count: null } }));
    expect(built.gaps).toContainEqual({ field: "business:employees_count", label: "Employee count", kind: "missing" });
  });

  it.each([49_999, 350_001])("amount %d outside 50k–350k is a gap", (amount) => {
    const { built } = build(makeSource({ business: { industry: PLUMBING }, deal: { capital_requested: amount } }));
    expect(built.gaps).toContainEqual({
      field: "capital_requested",
      label: "SmartBiz takes $50,000–$350,000 (edit the funding deal)",
      kind: "invalid",
    });
  });

  it("falls back to 12x the analysis monthly revenue when annual revenue is unset", () => {
    const { app } = build(makeSource({ business: { industry: PLUMBING, avg_annual_revenue: null } }));
    expect(app.business.profile.annual_revenue).toBe(540000); // 45,000 × 12
  });

  it("falls back to 12x the vault's monthly deposits when the business and analysis have none", () => {
    const { built, app } = build(
      makeSource({
        business: { industry: PLUMBING, avg_annual_revenue: null, avg_monthly_deposits: null },
        analysis: null,
        vault: { avg_monthly_deposits: 83000 },
      })
    );
    expect(built.gaps.map((g) => g.field)).not.toContain("annual_revenue");
    expect(app.business.profile.annual_revenue).toBe(996000);
  });

  it("a second business never borrows the vault's deposits", () => {
    const { built } = build(
      makeSource({
        business: { industry: PLUMBING, is_primary: false, avg_annual_revenue: null, avg_monthly_deposits: null },
        analysis: null,
        vault: { avg_monthly_deposits: 83000 },
      })
    );
    expect(built.gaps.map((g) => g.field)).toContain("annual_revenue");
  });

  const BO = {
    position: 2, full_name: "Bo Roe", ownership_pct: 40, dob: "1979-07-08", ssn: "987654321",
    street: "5 Oak Rd", city: "Miami", state: "FL", zip: "33133", email: "bo@example.com", phone: "(305) 555-0111",
  };

  it("a complete 20%+ co-owner is sent as a second person", () => {
    const { built, app } = build(makeSource({ business: { industry: PLUMBING }, vault: { owner_1_ownership_pct: 60 }, owners: [BO] }));
    expect(built.gaps).toEqual([]);
    expect(app.business.owners).toHaveLength(2);
    expect(app.business.owners[1]).toEqual({
      percent_owned: 40,
      type: "person",
      owner: {
        first_name: "Bo",
        last_name: "Roe",
        ssn: "987654321",
        birthday: "1979-07-08",
        email: "bo@example.com",
        phone_numbers: [{ number: "3055550111", name: "mobile" }],
        addresses: [{ tags: ["primary"], address_1: "5 Oak Rd", city: "Miami", state: "FL", zip: "33133" }],
      },
    });
    expect((built.redacted as SmartBizApplication).business.owners[1].owner.ssn).toBe("*****4321");
  });

  it("a 20%+ co-owner missing details is a gap that names them and what is missing", () => {
    const { built } = build(makeSource({ business: { industry: PLUMBING }, vault: { owner_1_ownership_pct: 60 }, owners: [{ ...BO, dob: null, ssn: null }] }));
    expect(built.gaps).toContainEqual({ field: "owner:2", label: "Owner 2 (Bo Roe, 40%): missing DOB, SSN", kind: "missing" });
  });

  it("a co-owner under 20% is left out", () => {
    const { built, app } = build(makeSource({ business: { industry: PLUMBING }, vault: { owner_1_ownership_pct: 85 }, owners: [{ ...BO, ownership_pct: 15, dob: null }] }));
    expect(built.gaps).toEqual([]);
    expect(app.business.owners).toHaveLength(1);
    expect(app.business.owners[0].percent_owned).toBe(85);
  });

  it("a missing or 0% owner-1 share is a gap, never an invented 100% (M1)", () => {
    for (const pct of [null, 0]) {
      const { built } = build(makeSource({ business: { industry: PLUMBING }, vault: { owner_1_ownership_pct: pct } }));
      expect(built.gaps).toContainEqual({ field: "owner:1", label: "Owner 1 ownership %", kind: "missing" });
    }
  });

  it("an owner-1 share over 100 is an invalid gap (M1)", () => {
    const { built } = build(makeSource({ business: { industry: PLUMBING }, vault: { owner_1_ownership_pct: 120 } }));
    expect(built.gaps).toContainEqual({ field: "owner:1", label: "Owner 1 ownership % (120%)", kind: "invalid" });
  });

  it("owner 1 + sent co-owners over 100% is an invalid gap (M1)", () => {
    const { built } = build(makeSource({ business: { industry: PLUMBING }, vault: { owner_1_ownership_pct: 70 }, owners: [BO] }));
    expect(built.gaps).toContainEqual({
      field: "owner:shares",
      label: "Ownership adds up to 110% — it can't pass 100%",
      kind: "invalid",
    });
  });

  it("a NAMED co-owner at 0% is a gap asking to confirm the share (M2)", () => {
    const { built, app } = build(makeSource({ business: { industry: PLUMBING }, vault: { owner_1_ownership_pct: 100 }, owners: [{ ...BO, ownership_pct: 0 }] }));
    expect(built.gaps).toContainEqual({ field: "owner:2", label: "Owner 2 (Bo Roe, 0%): confirm the ownership %", kind: "invalid" });
    expect(app.business.owners).toHaveLength(1);
  });

  it("owners unreadable (migration not applied) + a 20%+ co-owner on the vault = blocking gap", () => {
    const { built } = build(makeSource({
      business: { industry: PLUMBING },
      vault: { owner_1_ownership_pct: 60, owner_2_name: "Bo Roe", owner_2_ownership_pct: 40 },
      ownersAvailable: false,
    }));
    expect(built.gaps).toContainEqual({
      field: "owner:2",
      label: "Owner 2 (Bo Roe, 40%): owner details can't be loaded yet",
      kind: "missing",
    });
  });

  it("the three history answers are required picks; two-years is prefilled from the start date", () => {
    const { built } = build(undefined, {});
    expect(built.effectivePicks.business_operating_at_least_two_years).toBe("yes");
    expect(built.gaps.map((g) => g.field)).toEqual(
      expect.arrayContaining(["pick:has_past_bankruptcy", "pick:has_defaulted_on_government_guaranteed_loan"])
    );
    const young = build(makeSource({ business: { industry: PLUMBING, business_start_date: new Date().toISOString().slice(0, 10) } }));
    expect(young.built.effectivePicks.business_operating_at_least_two_years).toBe("no");
  });

  it("prefills bankruptcy from the bank analysis", () => {
    const { built } = build(makeSource({ business: { industry: PLUMBING }, analysis: { has_bankruptcy: true } }), {});
    expect(built.effectivePicks.has_past_bankruptcy).toBe("yes");
  });

  it("a specific product is sent; 'any' sends none", () => {
    expect(build(undefined, { ...ANSWERS, requested_product: "sba7a" }).app.submission.requested_products).toEqual(["sba7a"]);
    expect(build(undefined, { ...ANSWERS, requested_product: "any" }).app.submission.requested_products).toBeUndefined();
  });

  it("a non-primary business sends no EIN and uses its own address", () => {
    const { app } = build(makeSource({ business: { is_primary: false, industry: PLUMBING, company_city: "Tampa", company_zip_code: "33602" } }));
    expect(app.business.tin).toBeUndefined();
    expect(app.business.addresses[0]).toMatchObject({ city: "Tampa", zip: "33602" });
  });

  it("owner DOB and home address are required", () => {
    const { built } = build(makeSource({ business: { industry: PLUMBING }, vault: { owner_1_dob: null, home_address: null } }));
    expect(built.gaps.map((g) => g.field)).toEqual(expect.arrayContaining(["owner_1_dob", "owner_1_street", "owner_1_zip"]));
  });
});

describe("smartbiz entity type", () => {
  it.each([
    ["LLC", "llc"],
    ["Sole Proprietorship", "sprop"],
    ["S-Corp", "scorp"],
    ["C Corp", "ccorp"],
    ["LLP", "llp"],
    ["Partnership", "gp"],
    ["Non-Profit", "np"],
    ["Corporation", null],
    ["", null],
  ])("%s → %s", (input, expected) => {
    expect(mapSmartBizBusinessType(input)).toBe(expected);
  });
});

describe("smartbiz documents", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  it.each([
    ["business_bank_statements", "Aug.pdf", { document_type: "bank_statement" }],
    ["profit_loss", "pl.pdf", { document_type: "profit_and_loss" }],
    ["debt_schedule", "ds.xlsx", { document_type: "business_debt_schedule" }],
    ["drivers_license_front", "dl.jpg", { document_type: "drivers_license" }],
    ["tax_returns", "2025 1120S.pdf", { document_type: "last_years_business_tax_return", tax_year: 2025 }],
    ["tax_returns", "2024 return.pdf", { document_type: "two_years_ago_business_tax_return", tax_year: 2024 }],
    ["personal_tax_returns", "1040 2023.pdf", { document_type: "three_years_ago_personal_tax_return", tax_year: 2023 }],
    ["tax_returns", "return.pdf", { document_type: "last_years_business_tax_return" }],
    ["tax_returns", "2019 return.pdf", { document_type: "last_years_business_tax_return" }],
    ["articles", "x.pdf", { document_type: "miscellaneous" }],
    [null, "x.pdf", { document_type: "miscellaneous" }],
  ])("%s / %s", (code, filename, expected) => {
    expect(smartBizDocumentUpload(code, filename, now)).toEqual(expected);
  });
});

describe("smartbiz status", () => {
  const sub = (status: string | null, reasons?: Array<{ description: string }> | null) => ({
    data: { id: "s-1", type: "submission", attributes: { loan_application: { amount_requested: 1, status, status_reasons: reasons } } },
  });
  it.each(["OFFER_GENERATED", "CLOSING", "FUNDED"])("%s is approved", (s) => {
    expect(interpretSmartBizStatus(sub(s)).kind).toBe("approved");
  });
  it("DECLINED carries SmartBiz's reasons", () => {
    expect(interpretSmartBizStatus(sub("DECLINED", [{ description: "Credit score is below the minimum requirement" }]))).toEqual({
      kind: "declined",
      stage: "DECLINED",
      note: "SmartBiz declined: Credit score is below the minimum requirement",
    });
  });
  it("DECLINED without reasons is a pre-qualification decline", () => {
    expect(interpretSmartBizStatus(sub("DECLINED", null))).toMatchObject({ kind: "declined", note: "SmartBiz declined at pre-qualification (no reasons given)" });
  });
  it.each(["WITHDRAWN", "EXPIRED"])("%s needs a human", (s) => {
    expect(interpretSmartBizStatus(sub(s)).kind).toBe("needs_info");
  });
  it.each(["STARTED", "SUBMITTED", "PREQUALIFIED", "PACKAGING", "UNDER_REVIEW", "SOMETHING_NEW", null])("%s is in progress", (s) => {
    expect(interpretSmartBizStatus(sub(s as string | null)).kind).toBe("in_progress");
  });
});
