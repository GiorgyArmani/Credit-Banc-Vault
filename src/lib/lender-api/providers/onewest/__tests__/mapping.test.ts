import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import {
  buildOneWestApplication,
  interpretOneWestStatus,
  mapOneWestEntityType,
  oneWestCreditBand,
  oneWestDocumentTypes,
  oneWestFilename,
  oneWestStatusFromWebhook,
  statementMonthFromFilename,
  type OneWestPackage,
} from "../mapping";

const ctx = { referenceId: "cb-assign-1-1" };
const PLUMBING = "Plumbing, Heating, and Air-Conditioning Contractors";
const NOW = new Date("2026-10-06T12:00:00Z");

function build(source = makeSource({ business: { industry: PLUMBING }, analysis: { fico: 702 } }), picks: Record<string, string> = {}) {
  const built = buildOneWestApplication(source, picks, ctx);
  return { built, pkg: built.payload as OneWestPackage };
}

describe("1west package", () => {
  it("builds a complete package with no gaps", () => {
    const { built, pkg } = build();
    expect(built.gaps).toEqual([]);
    expect(pkg).toEqual({
      company: "Doe Plumbing LLC",
      dba: "Doe Plumbing",
      phone: "305-555-0199",
      fein: "12-3456789",
      legal_entity_type: "Limited Liability Company (LLC)",
      annual_revenue: 540000,
      business_start_date: "05/01/2018",
      street: "10 Pipe St",
      city: "Miami",
      state: "FL",
      zip_code: "33101",
      naics: "238220",
      industry: PLUMBING,
      employees: 6,
      desired_funding: 50000,
      purpose: "working capital",
      partner_tracking_id: "cb-assign-1-1",
      contacts: [
        {
          first_name: "Jane",
          last_name: "Doe",
          phone: "305-555-0100",
          email: "jane@example.com",
          street: "22 Palm Ave",
          city: "Miami",
          state: "FL",
          zip_code: "33130",
          postal_code: "33130",
          ssn: "123-45-6789",
          ownership_percent: 100,
          birth_date: "02/03/1980",
          credit_score: "Great (680 - 719)",
        },
      ],
    });
  });

  it("stores the SSN as its last 4 only", () => {
    const { built } = build();
    expect((built.redacted as OneWestPackage).contacts[0].ssn).toBe("***-**-6789");
    expect(JSON.stringify(built.redacted)).not.toContain("123-45-6789");
  });

  it("sends the legal name as the DBA when there's no other trade name", () => {
    const { pkg } = build(makeSource({ business: { business_name: null } }));
    expect(pkg.dba).toBe("Doe Plumbing LLC");
  });

  it("falls back to 12x the vault's monthly deposits for revenue", () => {
    const { built, pkg } = build(
      makeSource({ business: { avg_annual_revenue: null, avg_monthly_deposits: null }, analysis: null, vault: { avg_monthly_deposits: 83000 } })
    );
    expect(built.gaps.map((g) => g.field)).not.toContain("annual_revenue");
    expect(pkg.annual_revenue).toBe(996000);
  });

  it("a second business never borrows the vault's EIN or deposits", () => {
    const { built } = build(
      makeSource({
        business: { is_primary: false, avg_annual_revenue: null, avg_monthly_deposits: null },
        analysis: null,
        vault: { avg_monthly_deposits: 83000 },
      })
    );
    const fields = built.gaps.map((g) => g.field);
    expect(fields).toContain("ein");
    expect(fields).toContain("annual_revenue");
  });

  it("flags a missing entity type and an unmappable one", () => {
    expect(build(makeSource({ business: { legal_entity_type: null }, vault: { legal_entity_type: null } })).built.gaps).toContainEqual({
      field: "pick:legal_entity_type",
      label: "Entity type",
      kind: "missing",
    });
    expect(mapOneWestEntityType("S-Corp")).toBe("Corporation");
    expect(mapOneWestEntityType("LLP")).toBe("Limited Liability Partnership (LLP)");
    expect(mapOneWestEntityType("Trust")).toBeNull();
  });

  it("never invents owner 1's share", () => {
    const { built } = build(makeSource({ vault: { owner_1_ownership_pct: null } }));
    expect(built.gaps).toContainEqual({ field: "owner:1", label: "Owner 1 ownership %", kind: "missing" });
  });

  it("sends complete co-owners and flags incomplete ones", () => {
    const BO = {
      position: 2, full_name: "Bo Roe", ownership_pct: 40, dob: "1979-07-08", ssn: "987654321",
      street: "5 Oak Rd", city: "Miami", state: "FL", zip: "33133", email: "bo@example.com", phone: "(305) 555-0111",
    };
    const ok = build(makeSource({ vault: { owner_1_ownership_pct: 60 }, owners: [BO] }));
    expect(ok.built.gaps).toEqual([]);
    expect(ok.pkg.contacts[1]).toMatchObject({ first_name: "Bo", last_name: "Roe", ssn: "987-65-4321", ownership_percent: 40, birth_date: "07/08/1979" });

    const bad = build(makeSource({ vault: { owner_1_ownership_pct: 60 }, owners: [{ ...BO, email: null }] }));
    expect(bad.built.gaps).toContainEqual({ field: "owner:2", label: "Owner 2 (Bo Roe, 40%): missing email", kind: "missing" });
  });

  it("bands FICO into their credit score list", () => {
    expect(oneWestCreditBand(720)).toBe("Excellent (720+)");
    expect(oneWestCreditBand(679)).toBe("Average (650 - 679)");
    expect(oneWestCreditBand(550)).toBe("Not so Great (599 or less)");
    expect(oneWestCreditBand(null)).toBeNull();
  });
});

describe("1west documents", () => {
  it("reads the statement month from common filename shapes", () => {
    expect(statementMonthFromFilename("Chase 2026-08.pdf", NOW)).toBe(2026 * 12 + 7);
    expect(statementMonthFromFilename("stmt_08-2026.pdf", NOW)).toBe(2026 * 12 + 7);
    expect(statementMonthFromFilename("August 2026 statement.pdf", NOW)).toBe(2026 * 12 + 7);
    expect(statementMonthFromFilename("aug_26.pdf", NOW)).toBe(2026 * 12 + 7);
    expect(statementMonthFromFilename("November.pdf", NOW)).toBe(2025 * 12 + 10);
    expect(statementMonthFromFilename("statement.pdf", NOW)).toBeNull();
  });

  it("ranks bank statements newest first into slots 1, 2, 3", () => {
    const types = oneWestDocumentTypes(
      [
        { docCode: "business_bank_statements", filename: "Chase June 2026.pdf" },
        { docCode: "business_bank_statements", filename: "Chase Aug 2026.pdf" },
        { docCode: "drivers_license", filename: "dl.jpg" },
        { docCode: "business_bank_statements", filename: "Chase July 2026.pdf" },
        { docCode: "business_bank_statements", filename: "Chase May 2026.pdf" },
        { docCode: "business_bank_statements", filename: "Wells Aug 2026.pdf" },
        { docCode: "profit_loss", filename: "pl.pdf" },
      ],
      NOW
    );
    expect(types).toEqual([
      "Bank Statement 3",
      "Bank Statement 1",
      "Driver's License",
      "Bank Statement 2",
      "Bank Statement 3",
      "Bank Statement 1",
      null,
    ]);
  });

  it("fills empty slots in order when the month can't be read", () => {
    const types = oneWestDocumentTypes(
      [
        { docCode: "business_bank_statements", filename: "a.pdf" },
        { docCode: "business_bank_statements", filename: "b.pdf" },
        { docCode: "business_bank_statements", filename: "c.pdf" },
        { docCode: "business_bank_statements", filename: "d.pdf" },
      ],
      NOW
    );
    expect(types).toEqual(["Bank Statement 1", "Bank Statement 2", "Bank Statement 3", "Bank Statement 3"]);
  });

  it("makes filenames pass their pattern and refuses other formats", () => {
    expect(oneWestFilename("Chase (Aug) 2026.v2.pdf")).toBe("Chase -Aug- 2026-v2.pdf");
    expect(oneWestFilename("O'Brien & Co.PNG")).toBe("O-Brien - Co.png");
    expect(oneWestFilename("financials.xlsx")).toBeNull();
    expect(oneWestFilename("noextension")).toBeNull();
  });
});

describe("1west status", () => {
  it("reads a webhook body as the status", () => {
    expect(oneWestStatusFromWebhook({ uuid: "u-1", status: "Approved" })).toEqual({ uuid: "u-1", status: "Approved" });
    expect(oneWestStatusFromWebhook({ uuid: "u-1" })).toBeNull();
  });

  it("maps their statuses to verdicts", () => {
    expect(interpretOneWestStatus({ status: "Submitted" })).toEqual({ kind: "in_progress", stage: "Submitted" });
    expect(interpretOneWestStatus({ status: "Declined Across the Board" }).kind).toBe("declined");
    expect(interpretOneWestStatus({ status: "Unqualified" }).kind).toBe("declined");
    expect(interpretOneWestStatus({ status: "Customer Declined Offer" }).kind).toBe("needs_info");
    expect(interpretOneWestStatus({ status: "Submitted - Timed Out" }).kind).toBe("needs_info");
    const approved = interpretOneWestStatus({
      status: "Approved",
      funding_details: { amount: 100000, number_of_payments: 120, payment_frequency: "Daily", factor: 1.35 },
    });
    expect(approved).toEqual({
      kind: "approved",
      stage: "Approved",
      note: "1West: Approved\nOffer: $100,000, factor 1.35, 120 daily payments",
    });
  });
});
