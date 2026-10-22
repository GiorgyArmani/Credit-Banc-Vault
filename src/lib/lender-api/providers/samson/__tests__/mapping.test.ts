import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import {
  buildSamsonApplication,
  interpretSamsonStatus,
  readSamsonOpportunityId,
  mapSamsonEntityType,
  samsonDocType,
  suggestSamsonIndustry,
  toSamsonPhone,
  type SamsonRecord,
} from "../mapping";
import { toStateName } from "@/lib/lender-api/normalize";

const ctx = { referenceId: "cb-assign-1-1" };
const rep = { firstName: "Rae", lastName: "Rep", email: "rae@creditbanc.io", phone: "(305) 555-0123" };

describe("buildSamsonApplication — complete source", () => {
  const built = buildSamsonApplication({ ...makeSource(), salesRep: rep }, {}, ctx);
  const p = built.payload as SamsonRecord;

  it("has no gaps; deal type defaults to New, entity and industry come from the vault", () => {
    expect(built.gaps).toEqual([]);
    expect(built.effectivePicks).toEqual({ deal_type: "New", entity_type: "LLC", industry: "Construction" });
  });

  it("maps the business in their formats", () => {
    expect(p.business).toMatchObject({
      taxID: "12-3456789",
      name: "Doe Plumbing LLC",
      phone: "305-555-0199",
      businessInceptionDate: "2018-05-01",
      stateOfIncorporation: "Florida",
      dba: "Doe Plumbing",
      email: "jane@example.com",
      entityType: "LLC",
      industry: "Construction",
      dealType: "New",
      address: { addressLine1: "10 Pipe St", city: "Miami", state: "FL", zipCode: "33101" },
    });
  });

  it("maps owner 1 with a hyphenated SSN, home phone falling back to cell", () => {
    expect(p.owners).toEqual([
      {
        ssn: "123-45-6789",
        name: "Jane Doe",
        homePhone: "305-555-0100",
        dateOfBirth: "1980-02-03",
        ownershipPercentage: "100",
        email: "jane@example.com",
        homeAddress: { addressLine1: "22 Palm Ave", city: "Miami", state: "FL", zipCode: "33130" },
      },
    ]);
  });

  it("sends the advisor as the sales rep", () => {
    expect(p.sales).toEqual({
      firstName: "Rae",
      lastName: "Rep",
      repEmail: "rae@creditbanc.io",
      repPhone: "305-555-0123",
      salesOffice: "Credit Banc",
    });
  });

  it("self-reports revenue, amount and use of funds as strings; ref leads the notes", () => {
    expect(p.selfReported).toEqual({ monthlyRevenue: "45000", desiredLoanAmount: "50000", useOfFunds: "working capital" });
    expect(p.submissionNotes.startsWith("Credit Banc ref: cb-assign-1-1")).toBe(true);
  });

  it("redacts every SSN in the snapshot, not the payload", () => {
    expect((built.redacted as SamsonRecord).owners[0].ssn).toBe("***-**-6789");
    expect(p.owners[0].ssn).toBe("123-45-6789");
  });
});

describe("buildSamsonApplication — gaps and edges", () => {
  it.each([
    ["no SSN", { vault: { ssn: null } }, { field: "ssn", kind: "missing" }],
    ["short SSN", { vault: { ssn: "1234" } }, { field: "ssn", kind: "invalid" }],
    ["single-word owner name", { vault: { owner_1_name: "Jane" } }, { field: "owner_1_name", kind: "missing" }],
    ["no owner address", { vault: { home_address: null } }, { field: "owner_1_street", kind: "missing" }],
    ["no business address", { vault: { business_address: null, company_city: null } }, { field: "business_street", kind: "missing" }],
    ["no phone", { vault: { client_phone: "" }, business: { phone: null } }, { field: "client_phone", kind: "missing" }],
    ["no start date", { vault: { business_start_date: null }, business: { business_start_date: null } }, { field: "business_start_date", kind: "missing" }],
    ["bad EIN", { vault: { ein: "123" } }, { field: "ein", kind: "invalid" }],
    ["no EIN", { vault: { ein: null } }, { field: "ein", kind: "missing" }],
    ["no owner DOB", { vault: { owner_1_dob: null } }, { field: "owner_1_dob", kind: "missing" }],
    ["no owner share", { vault: { owner_1_ownership_pct: null } }, { field: "owner:1", kind: "missing" }],
    ["no requested amount", { vault: { capital_requested: null }, deal: { capital_requested: null } }, { field: "capital_requested", kind: "missing" }],
  ] as Array<[string, Record<string, unknown>, { field: string; kind: string }]>)("%s", (_n, overrides, gap) => {
    const built = buildSamsonApplication(makeSource(overrides as Record<string, unknown>), {}, ctx);
    expect(built.gaps).toEqual(expect.arrayContaining([expect.objectContaining(gap)]));
  });

  it("an off-list deal type is invalid; Renewal is accepted", () => {
    expect(buildSamsonApplication(makeSource(), { deal_type: "Refi" }, ctx).gaps).toEqual([
      { field: "pick:deal_type", label: "Deal type", kind: "invalid" },
    ]);
    const renewal = buildSamsonApplication(makeSource(), { deal_type: "Renewal" }, ctx);
    expect((renewal.payload as SamsonRecord).business.dealType).toBe("Renewal");
  });

  it("omits the sales rep fields when the file has no advisor", () => {
    const p = buildSamsonApplication(makeSource(), {}, ctx).payload as SamsonRecord;
    expect(p.sales).toEqual({ salesOffice: "Credit Banc" });
  });

  it("sends co-owners with an SSN, flags those without", () => {
    const owner = (position: number, ssn: string | null) => ({
      position, full_name: `Co Owner${position}`, ownership_pct: 20, dob: "1990-01-01", ssn,
      street: "5 Side St", city: "Miami", state: "FL", zip: "33130", email: null, phone: "3055550111",
    });
    const built = buildSamsonApplication(
      makeSource({ vault: { owner_1_ownership_pct: 60 }, owners: [owner(2, "987654321"), owner(3, null)] }),
      {},
      ctx
    );
    const p = built.payload as SamsonRecord;
    expect(p.owners.map((o) => o.name)).toEqual(["Jane Doe", "Co Owner2"]);
    expect(p.owners[1]).toMatchObject({ ssn: "987-65-4321", ownershipPercentage: "20", homePhone: "305-555-0111" });
    expect(built.gaps).toEqual([expect.objectContaining({ field: "owner:3", kind: "missing" })]);
  });

  it("flags a co-owner missing DOB or home address instead of sending them", () => {
    const built = buildSamsonApplication(
      makeSource({
        vault: { owner_1_ownership_pct: 60 },
        owners: [{ position: 2, full_name: "Co Owner2", ownership_pct: 40, dob: null, ssn: "987654321", street: null, city: null, state: null, zip: null, email: null, phone: null }],
      }),
      {},
      ctx
    );
    expect((built.payload as SamsonRecord).owners).toHaveLength(1);
    expect(built.gaps).toEqual([
      expect.objectContaining({ field: "owner:2", label: expect.stringContaining("date of birth, home address"), kind: "missing" }),
    ]);
  });

  it("only sends picklist values for entity type and industry", () => {
    const off = buildSamsonApplication(makeSource({ vault: { legal_entity_type: "Other", industry: "zzz" }, business: { legal_entity_type: "Other", industry: "zzz" } }), {}, ctx);
    expect((off.payload as SamsonRecord).business.entityType).toBeUndefined();
    expect((off.payload as SamsonRecord).business.industry).toBeUndefined();
    expect(buildSamsonApplication(makeSource(), { industry: "Plumbing" }, ctx).gaps).toEqual([
      { field: "pick:industry", label: "Industry", kind: "invalid" },
    ]);
    const picked = buildSamsonApplication(makeSource(), { entity_type: "S-Corp", industry: "Healthcare" }, ctx).payload as SamsonRecord;
    expect(picked.business).toMatchObject({ entityType: "S-Corp", industry: "Healthcare" });
  });

  it("a non-primary business never carries the vault's EIN", () => {
    const built = buildSamsonApplication(
      makeSource({ business: { is_primary: false, company_name: "Second Biz LLC" } }),
      {},
      ctx
    );
    expect((built.payload as SamsonRecord).business.taxID).toBeUndefined();
    expect((built.payload as SamsonRecord).business.name).toBe("Second Biz LLC");
  });
});

describe("samson helpers", () => {
  it("formats phones like their example", () => {
    expect(toSamsonPhone("+1 (777) 123-4567")).toBe("777-123-4567");
    expect(toSamsonPhone("12345")).toBeNull();
  });

  it("names states in full", () => {
    expect(toStateName("AL")).toBe("Alabama");
    expect(toStateName("dc")).toBe("District of Columbia");
    expect(toStateName("west virginia")).toBe("West Virginia");
    expect(toStateName("ZZ")).toBeNull();
  });

  it("maps doc codes to Samson document types, nothing for codes they have no type for", () => {
    expect(samsonDocType("business_bank_statements")).toBe("Bank Statements");
    expect(samsonDocType("funding_application")).toBe("Signed Application");
    expect(samsonDocType("funding_application_lenders")).toBe("Signed Application");
    expect(samsonDocType("tax_returns")).toBe("Tax Returns");
    expect(samsonDocType("personal_tax_returns")).toBe("Tax Returns");
    expect(samsonDocType("myscoreiq")).toBe("Credit Report");
    expect(samsonDocType("voided_check")).toBe("VC");
    expect(samsonDocType("drivers_license")).toBe("DL");
    expect(samsonDocType("profit_loss")).toBeNull();
    expect(samsonDocType("articles_of_incorporation")).toBeNull();
    expect(samsonDocType(null)).toBeNull();
  });

  it("maps our entity spellings onto their picklist", () => {
    expect(mapSamsonEntityType("LLC")).toBe("LLC");
    expect(mapSamsonEntityType("S-Corp")).toBe("S-Corp");
    expect(mapSamsonEntityType("C-Corp")).toBe("C-Corp");
    expect(mapSamsonEntityType("Sole Prop")).toBe("Sole Proprietor");
    expect(mapSamsonEntityType("Other")).toBeNull();
  });

  it("suggests an industry from free text", () => {
    expect(suggestSamsonIndustry("Restaurant & Catering Business")).toBe("Restaurant/Bar");
    expect(suggestSamsonIndustry("Electrical Contractors and Other Wiring Installation Contractors")).toBe("Construction");
    expect(suggestSamsonIndustry("General Freight Trucking, Long-Distance, Truckload")).toBe("Travel and Transportation");
    expect(suggestSamsonIndustry("Home Healthcare")).toBe("Health Services");
    expect(suggestSamsonIndustry("MECHANIC SHOP")).toBe("Automotive/Bicycle");
    expect(suggestSamsonIndustry(null)).toBeNull();
  });

  it("reads the opportunity id only on Status Success", () => {
    expect(readSamsonOpportunityId({ Status: "Success", OpportunityId: "006cX00000Q0CyHQAV" })).toBe("006cX00000Q0CyHQAV");
    expect(readSamsonOpportunityId({ Status: "Error", Message: "x" })).toBeNull();
    expect(readSamsonOpportunityId(null)).toBeNull();
  });

  it("status is always in progress (no status API)", () => {
    expect(interpretSamsonStatus(null)).toEqual({ kind: "in_progress", stage: "Submitted" });
  });
});
