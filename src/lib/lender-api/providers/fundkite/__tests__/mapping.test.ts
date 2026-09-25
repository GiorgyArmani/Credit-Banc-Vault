import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import {
  buildFundkiteDeal,
  fundkiteDocumentType,
  interpretFundkiteStatus,
  mapFundkiteEntityType,
  type FundkiteDealRequest,
} from "../mapping";

const ctx = { referenceId: "cb-assign-1-1" };

function build(source = makeSource(), picks: Record<string, string> = {}) {
  const built = buildFundkiteDeal(source, picks, ctx);
  return { built, payload: built.payload as FundkiteDealRequest };
}

describe("fundkite deal", () => {
  it("builds a complete deal with no gaps", () => {
    const { built, payload } = build();
    expect(built.gaps).toEqual([]);
    expect(payload).toEqual({
      external_id: "cb-assign-1-1",
      legal_name: "Doe Plumbing LLC",
      dba: "Doe Plumbing",
      requested_amount: 50000,
      primary_email: "jane@example.com",
      primary_phone: "3055550199",
      federal_tax_id: "123456789",
      type_of_entity: "LLC",
      state_of_incorporation: "FL",
      date_business_started: "2018-05-01",
      street: "10 Pipe St",
      city: "Miami",
      state: "FL",
      postal_code: "33101",
      owner_1_first_name: "Jane",
      owner_1_last_name: "Doe",
      owner_1_ownership_percentage: 100,
      owner_1_email: "jane@example.com",
      owner_1_cell_phone: "3055550100",
      owner_1_ssn: "123456789",
      owner_1_date_of_birth: "1980-02-03",
      owner_1_street: "22 Palm Ave",
      owner_1_city: "Miami",
      owner_1_state: "FL",
      owner_1_zip: "33130",
    });
  });

  it("redacts the SSN in the stored snapshot only", () => {
    const { built, payload } = build();
    expect(payload.owner_1_ssn).toBe("123456789");
    expect((built.redacted as FundkiteDealRequest).owner_1_ssn).toBe("*****6789");
  });

  it("prefills incorporation state from the business, but UW can override it", () => {
    expect(build().built.effectivePicks.state_of_incorporation).toBe("FL");
    expect(build(makeSource(), { state_of_incorporation: "DE" }).payload.state_of_incorporation).toBe("DE");
    expect(build(makeSource(), { state_of_incorporation: "XX" }).built.gaps[0]).toMatchObject({
      field: "pick:state_of_incorporation",
      kind: "invalid",
    });
  });

  it("sends the FICO from the bank analysis when there is one", () => {
    expect(build(makeSource({ analysis: { fico: 702 } })).payload.owner_1_fico).toBe(702);
    expect(build().payload).not.toHaveProperty("owner_1_fico");
  });

  it("flags every required field it can't fill", () => {
    const { built } = build(
      makeSource({
        vault: { ssn: null, owner_1_dob: null, ein: null, client_email: null, client_phone: "1", capital_requested: null, legal_entity_type: "Trust" },
        business: { phone: null, legal_entity_type: "Trust" },
        deal: null,
      })
    );
    expect(built.gaps.map((g) => g.field)).toEqual(
      expect.arrayContaining(["ssn", "owner_1_dob", "ein", "client_email", "client_phone", "capital_requested", "pick:type_of_entity"])
    );
  });

  it("never sends the primary business's EIN for a second business", () => {
    const { built, payload } = build(makeSource({ business: { is_primary: false, company_name: "Second Co" } }));
    expect(payload.federal_tax_id).toBe("");
    expect(built.gaps.map((g) => g.field)).toContain("ein");
  });
});

describe("fundkite helpers", () => {
  it("maps entity types", () => {
    expect(mapFundkiteEntityType("S Corp")).toBe("Corporation");
    expect(mapFundkiteEntityType("sole prop")).toBe("Sole Proprietorship");
    expect(mapFundkiteEntityType("LLP")).toBe("Limited Liability Partnership");
    expect(mapFundkiteEntityType("Trust")).toBeNull();
  });

  it("types documents, falling back to other", () => {
    expect(fundkiteDocumentType("business_bank_statements")).toBe("bank_statement");
    expect(fundkiteDocumentType("drivers_license_front")).toBe("identification");
    expect(fundkiteDocumentType("voided_check")).toBe("voided_check");
    expect(fundkiteDocumentType("lease_agreement")).toBe("other");
    expect(fundkiteDocumentType(null)).toBe("other");
  });
});

describe("fundkite status", () => {
  it("keeps intake states in progress", () => {
    expect(interpretFundkiteStatus({ id: "u", status: "processing", deal_status: null })).toEqual({ kind: "in_progress", stage: "Processing" });
    expect(interpretFundkiteStatus({ data: { id: "u", status: "received", submission_number: "S-1" } })).toEqual({
      kind: "in_progress",
      stage: "Received (submission S-1)",
    });
  });

  it("surfaces a failed intake for a human", () => {
    expect(interpretFundkiteStatus({ status: "failed" }).kind).toBe("needs_info");
  });

  it("reads the CRM deal status by keyword, never guessing on unknowns", () => {
    expect(interpretFundkiteStatus({ status: "received", deal_status: "Declined" }).kind).toBe("declined");
    expect(interpretFundkiteStatus({ status: "received", deal_status: "Approved" }).kind).toBe("approved");
    expect(interpretFundkiteStatus({ status: "received", deal_status: "Offer Sent" }).kind).toBe("approved");
    expect(interpretFundkiteStatus({ status: "received", deal_status: "Pending Docs" }).kind).toBe("needs_info");
    expect(interpretFundkiteStatus({ status: "received", deal_status: "In Underwriting" })).toEqual({
      kind: "in_progress",
      stage: "In Underwriting",
    });
  });
});
