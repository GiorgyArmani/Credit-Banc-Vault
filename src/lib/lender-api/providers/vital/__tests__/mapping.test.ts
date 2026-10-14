import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import {
  buildVitalApplication,
  interpretVitalStatus,
  sanitizeVitalStatus,
  toVitalPhone,
  vitalDocumentCategory,
  vitalDocumentName,
  vitalSubmissionId,
  vitalTagsForDocCode,
  type VitalSubmission,
} from "../mapping";

const ctx = { referenceId: "cb-assign-1-1" };
const PLUMBING = "Plumbing, Heating, and Air-Conditioning Contractors";

function build(source = makeSource({ business: { industry: PLUMBING } })) {
  const built = buildVitalApplication(source, {}, ctx);
  return { built, biz: (built.payload as VitalSubmission).business };
}

describe("vital submission", () => {
  it("builds a complete submission with no gaps", () => {
    const { built, biz } = build();
    expect(built.gaps).toEqual([]);
    expect(built.effectivePicks).toEqual({});
    expect(biz).toEqual({
      name: "Doe Plumbing LLC",
      dba: "Doe Plumbing",
      address: "10 Pipe St",
      city: "Miami",
      state: "FL",
      zip: "33101",
      telephone: "3055550199",
      email: "jane@example.com",
      fein: "123456789",
      amountRequested: 50000,
      avgMonthlyRevenue: 45000,
      getUseOfFunds: "working capital",
      entityType: "LLC",
      startDate: "2018-05-01",
      naicsCode: "238220",
      industryTypeMoreInfo: PLUMBING,
      refNumber: "cb-assign-1-1",
      owners: [
        {
          firstName: "Jane",
          lastName: "Doe",
          socialSecurityNumber: "123456789",
          dateOfBirth: "1980-02-03",
          address: "22 Palm Ave",
          city: "Miami",
          state: "FL",
          zip: "33130",
          emailAddress: "jane@example.com",
          mobilePhone: "3055550100",
          ownershipPercentage: 100,
        },
      ],
    });
  });

  it("stores the SSN as last 4 only", () => {
    const { built } = build();
    const redacted = built.redacted as VitalSubmission;
    expect(redacted.business.owners[0].socialSecurityNumber).toBe("*****6789");
    expect(JSON.stringify(redacted)).not.toContain("123456789\",\"dateOfBirth");
    expect((built.payload as VitalSubmission).business.owners[0].socialSecurityNumber).toBe("123456789");
  });

  it("flags only what Vital requires", () => {
    const { built } = build(
      makeSource({
        vault: { owner_1_name: "Jane", company_name: null, business_address: null, company_city: null, client_phone: null },
        business: { company_name: null, phone: null },
      })
    );
    expect(built.gaps.map((g) => g.field).sort()).toEqual(
      ["business_name", "business_street", "client_phone", "company_city", "owner_1_name"].sort()
    );
  });

  it("sends without SSN, EIN, DOB or amount when they are not on file", () => {
    const { built, biz } = build(
      makeSource({ vault: { ssn: null, ein: null, owner_1_dob: null, capital_requested: null }, deal: { capital_requested: null } })
    );
    expect(built.gaps).toEqual([]);
    expect(biz.fein).toBeUndefined();
    expect(biz.amountRequested).toBeUndefined();
    expect(biz.owners[0].socialSecurityNumber).toBeUndefined();
    expect(biz.owners[0].dateOfBirth).toBeUndefined();
  });

  it("flags a malformed SSN or EIN instead of sending it", () => {
    const { built, biz } = build(makeSource({ vault: { ssn: "123-45", ein: "12-34" } }));
    expect(built.gaps).toEqual([
      { field: "ssn", label: "Owner SSN (9 digits)", kind: "invalid" },
      { field: "ein", label: "EIN (9 digits)", kind: "invalid" },
    ]);
    expect(biz.fein).toBeUndefined();
    expect(biz.owners[0].socialSecurityNumber).toBeUndefined();
  });

  it("sends the position count only when there are known positions", () => {
    expect(build().biz.numPositions).toBeUndefined();
    const { biz } = build(
      makeSource({
        openPositions: [
          { lender_name: "A", current_balance: 1, payment_amount: 1, payment_frequency: "Daily" },
          { lender_name: "B", current_balance: 1, payment_amount: 1, payment_frequency: "Weekly" },
        ],
      })
    );
    expect(biz.numPositions).toBe(2);
  });

  it("adds co-owners and flags one with no usable name", () => {
    const owner = (position: number, full_name: string, ownership_pct: number) => ({
      position,
      full_name,
      ownership_pct,
      dob: "1975-06-07",
      ssn: "987-65-4321",
      street: "5 Oak Rd",
      city: "Tampa",
      state: "Florida",
      zip: "33602-1234",
      email: "sam@example.com",
      phone: "(813) 555-0142",
    });
    const { built, biz } = build(
      makeSource({ vault: { owner_1_ownership_pct: 50 }, owners: [owner(2, "Sam Roe", 30), owner(3, "Cher", 20), owner(4, "Old Partner", 0)] })
    );
    expect(biz.owners).toHaveLength(2);
    expect(biz.owners[1]).toEqual({
      firstName: "Sam",
      lastName: "Roe",
      socialSecurityNumber: "987654321",
      dateOfBirth: "1975-06-07",
      address: "5 Oak Rd",
      city: "Tampa",
      state: "FL",
      zip: "33602",
      emailAddress: "sam@example.com",
      mobilePhone: "8135550142",
      ownershipPercentage: 30,
    });
    expect(built.gaps).toEqual([{ field: "owner:3", label: "Owner 3 (Cher, 20%): missing full name", kind: "missing" }]);
    expect((built.redacted as VitalSubmission).business.owners[1].socialSecurityNumber).toBe("*****4321");
  });

  it("flags co-owners it cannot load and shares over 100%", () => {
    const unavailable = build(makeSource({ vault: { owner_2_name: "Sam Roe", owner_2_ownership_pct: 40 }, ownersAvailable: false }));
    expect(unavailable.built.gaps.map((g) => g.field)).toEqual(["owner:2"]);

    const over = build(
      makeSource({
        owners: [
          { position: 2, full_name: "Sam Roe", ownership_pct: 30, dob: null, ssn: null, street: null, city: null, state: null, zip: null, email: null, phone: null },
        ],
      })
    );
    expect(over.built.gaps.map((g) => g.field)).toEqual(["owner:shares"]);
  });

  it("a second business never borrows the primary's EIN, DBA or deposits", () => {
    const { biz } = build(
      makeSource({
        business: { is_primary: false, business_name: "Doe Roofing", company_name: "Doe Roofing Inc", avg_monthly_deposits: null },
        analysis: null,
      })
    );
    expect(biz.name).toBe("Doe Roofing Inc");
    expect(biz.dba).toBe("Doe Roofing");
    expect(biz.fein).toBeUndefined();
    expect(biz.avgMonthlyRevenue).toBeUndefined();
  });

  it("normalizes phones to ten digits", () => {
    expect(toVitalPhone("+1 (305) 555-0100")).toBe("3055550100");
    expect(toVitalPhone("555-0100")).toBeNull();
  });
});

describe("vital documents", () => {
  it("maps doc codes to Vital's categories verbatim", () => {
    expect(vitalDocumentCategory("signed_application")).toBe("Signed Application");
    expect(vitalDocumentCategory("business_bank_statements")).toBe("Bank Statements");
    expect(vitalDocumentCategory("drivers_license_back")).toBe("Drivers License");
    expect(vitalDocumentCategory("voided_check")).toBe("Voided Check");
    expect(vitalDocumentCategory("profit_loss")).toBe("Financials");
    expect(vitalTagsForDocCode("merchant_processing_statements")).toEqual(["Processing Statements"]);
  });

  it("never guesses a category", () => {
    expect(vitalDocumentCategory("lease_agreement")).toBeNull();
    expect(vitalDocumentCategory(null)).toBeNull();
    expect(vitalTagsForDocCode("something_new")).toEqual([]);
  });

  it("names a document after its file", () => {
    expect(vitalDocumentName("Chase Aug 2026.pdf")).toBe("Chase Aug 2026");
    expect(vitalDocumentName("noextension")).toBe("noextension");
  });
});

describe("vital status", () => {
  const echoed = {
    id: 9001,
    subStatus: "Approved - Offer Sent",
    business: {
      id: 4455,
      name: "Doe Plumbing LLC",
      status: "Underwriting",
      owners: [{ firstName: "Jane", lastName: "Doe", socialSecurityNumber: "123456789", dateOfBirth: "1980-02-03" }],
    },
  };

  it("keeps ids and status fields only, never owners or SSNs", () => {
    const s = sanitizeVitalStatus(echoed);
    expect(s).toEqual({ id: "9001", dealId: "4455", statuses: { status: "Underwriting", subStatus: "Approved - Offer Sent" } });
    expect(JSON.stringify(s)).not.toContain("123456789");
    expect(sanitizeVitalStatus(null)).toEqual({ statuses: {} });
  });

  it("prefers the sub-status and reads it by keyword", () => {
    expect(interpretVitalStatus(sanitizeVitalStatus(echoed))).toEqual({
      kind: "approved",
      stage: "Approved - Offer Sent",
      note: "Vital Cap: Approved - Offer Sent\nVital deal id: 4455",
    });
  });

  it("reads declines with their reason, and needs-info", () => {
    expect(interpretVitalStatus({ statuses: { status: "Declined", declineReason: "Too many positions" } })).toEqual({
      kind: "declined",
      stage: "Declined",
      note: "Vital Cap: Declined\nReason: Too many positions",
    });
    expect(interpretVitalStatus({ statuses: { status: "Pending Stips" } }).kind).toBe("needs_info");
  });

  it("stays in progress on an unknown or absent status", () => {
    expect(interpretVitalStatus({ statuses: { status: "Underwriting" } })).toEqual({ kind: "in_progress", stage: "Underwriting" });
    expect(interpretVitalStatus({ id: "9001", statuses: {} })).toEqual({ kind: "in_progress", stage: "Submitted" });
    expect(interpretVitalStatus(null)).toEqual({ kind: "in_progress", stage: "Submitted" });
  });
});

describe("vital callback id", () => {
  it("reads an explicit submission id", () => {
    expect(vitalSubmissionId({ submissionId: 9001 })).toBe("9001");
    expect(vitalSubmissionId({ dealSubmissionId: "9002" })).toBe("9002");
    expect(vitalSubmissionId({ submission: { id: 9003 } })).toBe("9003");
  });

  it("never mistakes a bare deal id for a submission id", () => {
    expect(vitalSubmissionId({ id: 4455 })).toBeNull();
    expect(vitalSubmissionId({ dealId: 4455, leadId: 4455 })).toBeNull();
    expect(vitalSubmissionId(null)).toBeNull();
  });
});
