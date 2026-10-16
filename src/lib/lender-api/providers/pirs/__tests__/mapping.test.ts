import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import {
  buildPirsApplication,
  formatPirsPhone,
  formatPirsSsn,
  formatPirsTaxId,
  interpretPirsStatus,
  mapPirsCompanyType,
  pirsAttachmentDescription,
  sanitizePirsStatus,
  type PirsApplication,
} from "../mapping";
import { PIRS_COMPANY_TYPES } from "../constants";

const ctx = { referenceId: "ref-1" };

function build(o: Parameters<typeof makeSource>[0] = {}, picks = {}) {
  return buildPirsApplication(makeSource(o), picks, ctx);
}

function owner(position: number, extra: Record<string, unknown> = {}) {
  return {
    position,
    full_name: "John Partner",
    ownership_pct: 40,
    dob: "1975-01-02",
    ssn: "987654321",
    street: "5 Side St",
    city: "Miami",
    state: "FL",
    zip: "33102",
    email: "john@example.com",
    phone: "3055550111",
    ...extra,
  };
}

// Real sandbox GET /api/Application/Get/190841 (2026-10-15), SSN masked.
const SANDBOX_GET = {
  isWeeklyPaymentSelected: false,
  fundId: 190841,
  legalName: "CBV API Test LLC",
  owner1: { address: { zip: "10002", address: "45 Oak Ave" }, ownerInfo: { firstName: "Test", lastName: "Owner", ssn: "123-45-6789" } },
  status: "Submitted",
  rejectReasons: null,
  missingInfoDetails: null,
};

describe("formats the sandbox validator enforces", () => {
  it("SSN XXX-XX-XXXX, tax id XX-XXXXXXX, phone (XXX) XXX-XXXX", () => {
    expect(formatPirsSsn("123456789")).toBe("123-45-6789");
    expect(formatPirsSsn("12345")).toBeNull();
    expect(formatPirsTaxId("123456789")).toBe("12-3456789");
    expect(formatPirsTaxId("12-3456789")).toBe("12-3456789");
    expect(formatPirsPhone("+1 305 555 0100")).toBe("(305) 555-0100");
    expect(formatPirsPhone("555-0100")).toBeNull();
  });

  it("maps entity types onto PIRS's enum only", () => {
    expect(mapPirsCompanyType("LLC")).toBe("LLC");
    expect(mapPirsCompanyType("S-Corp")).toBe("Corp");
    expect(mapPirsCompanyType("Sole Proprietorship")).toBe("SoleProp");
    expect(mapPirsCompanyType("Limited Liability Partnership")).toBe("LLP");
    expect(mapPirsCompanyType("nonprofit")).toBeNull();
    for (const t of ["LLC", "Corp", "SoleProp", "LLP", "LP", "Partnership"]) {
      expect(PIRS_COMPANY_TYPES).toContain(t);
    }
  });
});

describe("buildPirsApplication", () => {
  it("builds a complete payload with no gaps from the shared fixture", () => {
    const { payload, gaps, effectivePicks } = build();
    const p = payload as PirsApplication;
    expect(gaps).toEqual([]);
    expect(effectivePicks.company_type).toBe("LLC");
    expect(p.legalName).toBe("Doe Plumbing LLC");
    expect(p.dba).toBe("Doe Plumbing");
    expect(p.taxID).toBe("12-3456789");
    expect(p.type).toBe("LLC");
    expect(p.cell).toBe("(305) 555-0100");
    expect(p.phone).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);
    expect(p.address).toEqual({ address: "10 Pipe St", zip: "33101" });
    expect(p.owner1.ownerInfo).toMatchObject({ firstName: "Jane", lastName: "Doe", dateOfBirth: "1980-02-03", ssn: "123-45-6789" });
    expect(p.owner1.address).toEqual({ address: "22 Palm Ave", zip: "33130" });
    expect(p.timeInBusiness).toBe("2018-05-01");
    expect(p.email).toBe("jane@example.com");
    expect(p.comments).toContain("Requested amount: $50,000");
    expect(p.comments).toContain("Reference: ref-1");
    // Never set by mapping: the client adds it from env.
    expect(p.callbackUrl).toBeUndefined();
  });

  it("falls back to the legal name for the required DBA", () => {
    const { payload } = build({ vault: { dba: null }, business: { business_name: null } });
    expect((payload as PirsApplication).dba).toBe("Doe Plumbing LLC");
  });

  it("redacts every SSN to its last 4", () => {
    const { redacted } = build({ owners: [owner(2)] });
    const r = redacted as PirsApplication;
    expect(r.owner1.ownerInfo.ssn).toBe("***-**-6789");
    expect(r.owner2?.ownerInfo.ssn).toBe("***-**-4321");
    expect(JSON.stringify(redacted)).not.toContain("123-45-6789");
  });

  it("gaps every required field it can't fill", () => {
    const { gaps } = build({
      vault: { ssn: "123", ein: null, owner_1_dob: null, client_email: null, client_phone: null, company_zip_code: null, business_address: null, home_address: null },
    });
    const fields = gaps.map((g) => g.field);
    for (const f of ["ssn", "ein", "owner_1_dob", "client_email", "client_phone", "owner_1_street", "owner_1_zip", "business_street", "company_zip_code"]) {
      expect(fields).toContain(f);
    }
    expect(gaps.find((g) => g.field === "ssn")?.kind).toBe("invalid");
  });

  it("asks UW for the company type when the entity has no PIRS equivalent", () => {
    const { gaps } = build({ vault: { legal_entity_type: "Nonprofit" }, business: { legal_entity_type: "Nonprofit" } });
    expect(gaps).toContainEqual({ field: "pick:company_type", label: "Company type", kind: "missing" });
    expect(build({ vault: { legal_entity_type: "Nonprofit" }, business: { legal_entity_type: "Nonprofit" } }, { company_type: "Other" }).gaps).toEqual([]);
  });

  it("gaps a missing business start date", () => {
    const { gaps } = build({ vault: { business_start_date: null }, business: { business_start_date: null } });
    expect(gaps.map((g) => g.field)).toContain("business:start_date");
  });

  it("sends complete co-owners, largest share first, in owner2..owner4", () => {
    const { payload, gaps } = build({
      owners: [owner(2, { ownership_pct: 10, full_name: "Small Holder" }), owner(3, { ownership_pct: 30, full_name: "Big Holder" })],
    });
    const p = payload as PirsApplication;
    expect(gaps).toEqual([]);
    expect(p.owner2?.ownerInfo.firstName).toBe("Big");
    expect(p.owner3?.ownerInfo.firstName).toBe("Small");
    expect(p.owner2?.ownerInfo.ssn).toBe("987-65-4321");
  });

  it("gaps an incomplete 20%+ co-owner but drops a small one quietly", () => {
    const big = build({ owners: [owner(2, { ssn: null })] });
    expect(big.gaps.map((g) => g.field)).toContain("owner:2");
    const small = build({ owners: [owner(2, { ssn: null, ownership_pct: 5 })] });
    expect(small.gaps).toEqual([]);
    expect((small.payload as PirsApplication).owner2).toBeUndefined();
  });

  it("gaps a fifth 20%+ owner: PIRS has four slots", () => {
    const { gaps, payload } = build({
      owners: [2, 3, 4, 5].map((n) => owner(n, { ownership_pct: 20, full_name: `Owner Number${n}` })),
    });
    expect((payload as PirsApplication).owner4).toBeDefined();
    expect(gaps.some((g) => g.label.includes("at most 4 owners"))).toBe(true);
  });

  it("never sends a single-owner file when co-owners can't be loaded", () => {
    const { gaps } = build({ ownersAvailable: false, vault: { owner_2_name: "Pat Partner", owner_2_ownership_pct: 40 } as never });
    expect(gaps.map((g) => g.field)).toContain("owner:2");
  });
});

describe("documents", () => {
  it("describes attachments from the doc code", () => {
    expect(pirsAttachmentDescription("business_bank_statements")).toBe("Business bank statements");
    expect(pirsAttachmentDescription(null)).toBe("Document");
  });
});

describe("status", () => {
  it("stores no SSN, owner or business data", () => {
    const s = sanitizePirsStatus(SANDBOX_GET);
    expect(s).toEqual({ fundId: 190841, status: "Submitted", rejectReasons: null, missingInfoDetails: null, isWeeklyPaymentSelected: false });
    expect(JSON.stringify(s)).not.toContain("123-45-6789");
  });

  it("reads the sandbox's Submitted as in progress", () => {
    expect(interpretPirsStatus(sanitizePirsStatus(SANDBOX_GET))).toEqual({ kind: "in_progress", stage: "Submitted" });
    expect(interpretPirsStatus({ status: "ReadyForUnderwriting" })).toEqual({ kind: "in_progress", stage: "Underwriting" });
  });

  it("reads Rejected as declined with PIRS's reasons", () => {
    expect(interpretPirsStatus({ status: "Rejected", rejectReasons: "Too many positions" })).toEqual({
      kind: "declined",
      stage: "Rejected",
      note: "Too many positions",
    });
  });

  it("reads every status from PIRS's official list (2026-10-16)", () => {
    for (const status of ["PreSubmitted", "Submitted", "PreUnderwriting", "ReadyForUnderwriting", "ReadyForUnderwriting_Verification", "Verification"]) {
      expect(interpretPirsStatus({ status }).kind).toBe("in_progress");
    }
    for (const status of [
      "Offer",
      "RequestContract",
      "ContractSent",
      "ContractOut",
      "SignedContractUploaded",
      "ContractProcessing",
      "MissingStips",
      "MissingStipsSubmitted",
      "FinalReview",
      "Funded",
    ]) {
      expect(interpretPirsStatus({ status }).kind).toBe("approved");
    }
    expect(interpretPirsStatus({ status: "PreUnderwriting" })).toEqual({ kind: "in_progress", stage: "Pre-underwriting" });
  });

  it("never reads a merchant walking away as a lender decline", () => {
    expect(interpretPirsStatus({ status: "MerchantRejected" }).kind).toBe("in_progress");
  });

  it("reads every MissingInfo_* as needs-info", () => {
    for (const status of ["MissingInfo_Submitted", "MissingInfo_Underwriting", "MissingInfo_Verification"]) {
      expect(interpretPirsStatus({ status, missingInfoDetails: "Need 4th month" })).toEqual({ kind: "needs_info", stage: status, note: "Need 4th month" });
    }
  });

  it("reads Offer as approved and writes the options into the note", () => {
    const raw = sanitizePirsStatus(
      { fundId: 1, status: "Offer" },
      {
        options: [{ tier: "A", factor: 1.35, maxAdvanceAmount: 40000, maxDailyPayment: 450, estTerm: 6, estTermUnit: "Months", position: "1" }],
        originationFee: 10,
        applicationFee: 0,
        professionalFee: 0,
      }
    );
    const st = interpretPirsStatus(raw);
    expect(st.kind).toBe("approved");
    expect(st.kind === "approved" && st.note).toContain("Tier A · up to $40,000 · factor 1.35 · ~6 months · max daily payment $450 · position 1");
    expect(st.kind === "approved" && st.note).toContain("Fees: origination 10%");
  });

  it("still approves when the options came back empty (sandbox shape)", () => {
    const st = interpretPirsStatus(sanitizePirsStatus({ status: "ContractSent" }, { options: [], originationFee: 10, applicationFee: 0, professionalFee: 0 }));
    expect(st).toEqual({ kind: "approved", stage: "ContractSent", note: "PIRS Capital: ContractSent (terms in the Pirs Portal)" });
  });
});
