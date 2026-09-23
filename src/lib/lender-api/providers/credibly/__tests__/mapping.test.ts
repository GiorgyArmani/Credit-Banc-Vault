import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import {
  buildCrediblySubmission,
  formatFederalTaxId,
  formatSsn,
  interpretCrediblyStatus,
  mapCrediblyOwnershipType,
  matchStipForDocCode,
  redactCrediblySubmission,
  type CrediblySubmissionRequest,
} from "../mapping";
import { CREDIBLY_OWNERSHIP_TYPES } from "../constants";

const ctx = { referenceId: "CB-TEST-1" };
const picks: Record<string, string> = { ownership_type: "Limited Liability Company" };

function build(source = makeSource(), p: Record<string, string> = picks) {
  const built = buildCrediblySubmission(source, p, ctx);
  return { built, payload: built.payload as CrediblySubmissionRequest };
}

describe("credibly payload", () => {
  it("builds a complete submission with no gaps", () => {
    const { built, payload } = build();
    expect(built.gaps).toEqual([]);
    expect(payload.business_overview.legal_name).toBe("Doe Plumbing LLC");
    expect(payload.business_overview.ownership_type).toBe("Limited Liability Company");
    expect(payload.principals).toHaveLength(1);
    expect(payload.principals[0].first_name).toBe("Jane");
    expect(payload.principals[0].last_name).toBe("Doe");
  });

  it("formats the EIN and SSN to the patterns Credibly validates", () => {
    const { payload } = build();
    // ^\d{2}-\d{7}$ and ^\d{3}-\d{2}-\d{4}$
    expect(payload.business_overview.federal_tax_id).toMatch(/^\d{2}-\d{7}$/);
    expect(payload.principals[0].ssn).toMatch(/^\d{3}-\d{2}-\d{4}$/);
  });

  it("uses date-only ISO dates", () => {
    const { payload } = build();
    expect(payload.business_overview.business_start_date).toBe("2018-05-01");
    expect(payload.principals[0].date_of_birth).toBe("1980-02-03");
  });

  it("sends amount_requested and avg_monthly_deposits as integers", () => {
    const { payload } = build();
    expect(payload.amount_requested).toBe(50000);
    expect(Number.isInteger(payload.account_overview.avg_monthly_deposits)).toBe(true);
  });

  it("omits amount_requested when nothing was asked for", () => {
    const { payload } = build(makeSource({ vault: { capital_requested: null }, deal: { capital_requested: null } }));
    expect(payload.amount_requested).toBeUndefined();
  });

  it("reports a gap instead of sending a malformed EIN", () => {
    const { built, payload } = build(makeSource({ vault: { ein: "123" } }));
    expect(built.gaps).toContainEqual({ field: "ein", label: "EIN (9 digits)", kind: "invalid" });
    expect(payload.business_overview.federal_tax_id).toBe("");
  });

  it("reports every missing required principal field", () => {
    const { built } = build(
      makeSource({ vault: { ssn: null, owner_1_dob: null, client_email: null, home_address: null } })
    );
    const fields = built.gaps.map((g) => g.field);
    expect(fields).toContain("ssn");
    expect(fields).toContain("owner_1_dob");
    expect(fields).toContain("client_email");
    expect(fields).toContain("owner_1_street");
  });

  it("requires the entity type pick and rejects a value off their enum", () => {
    expect(build(makeSource(), {}).built.gaps.some((g) => g.field === "pick:ownership_type")).toBe(false);
    const { built } = build(makeSource({ vault: { legal_entity_type: null } }), { ownership_type: "LLC" });
    expect(built.gaps).toContainEqual({
      field: "pick:ownership_type",
      label: "Entity type",
      kind: "invalid",
    });
  });

  it("never sends the vault's EIN for a second business", () => {
    const { built, payload } = build(
      makeSource({ business: { id: "bp-2", is_primary: false, company_name: "Second Co" } })
    );
    expect(payload.business_overview.federal_tax_id).toBe("");
    expect(built.gaps.some((g) => g.field === "ein")).toBe(true);
    expect(payload.business_overview.legal_name).toBe("Second Co");
  });

  it("redacts the SSN in what gets stored", () => {
    const { built, payload } = build();
    const redacted = built.redacted as CrediblySubmissionRequest;
    expect(redacted.principals[0].ssn).toBe("***-**-6789");
    expect(payload.principals[0].ssn).toBe("123-45-6789");
    // The real payload is untouched by redaction.
    expect(redactCrediblySubmission(payload).principals[0].ssn).toBe("***-**-6789");
  });
});

describe("entity type mapping", () => {
  it("maps our vocabulary onto theirs", () => {
    expect(mapCrediblyOwnershipType("LLC")).toBe("Limited Liability Company");
    expect(mapCrediblyOwnershipType("S-Corp")).toBe("Corporation");
    expect(mapCrediblyOwnershipType("Sole Proprietorship")).toBe("Sole Proprietorship");
    expect(mapCrediblyOwnershipType("Limited Partnership")).toBe("Limited Partnership");
    expect(mapCrediblyOwnershipType("something else")).toBeNull();
    expect(mapCrediblyOwnershipType(null)).toBeNull();
  });

  it("only ever returns values on their enum", () => {
    for (const input of ["llc", "LLP", "gp", "inc", "sole prop", "corporation"]) {
      const mapped = mapCrediblyOwnershipType(input);
      if (mapped) expect(CREDIBLY_OWNERSHIP_TYPES).toContain(mapped as any);
    }
  });
});

describe("id formatting", () => {
  it("formats or refuses", () => {
    expect(formatFederalTaxId("12-3456789")).toBe("12-3456789");
    expect(formatFederalTaxId("123456789")).toBe("12-3456789");
    expect(formatFederalTaxId("1234")).toBeNull();
    expect(formatSsn("123456789")).toBe("123-45-6789");
    expect(formatSsn("12-345-6789")).toBe("123-45-6789");
    expect(formatSsn(null)).toBeNull();
  });
});

describe("stip matching", () => {
  const stips = [
    { stip_id: "O-2", stip_status: "Pending", short_text: "Bank Statements", long_text: "Last 3 months" },
    { stip_id: "O-5", stip_status: "Pending", short_text: "Signed Application", long_text: "Signed app" },
  ];

  it("sends each document to the stip whose text matches it", () => {
    expect(matchStipForDocCode("business_bank_statements", stips)?.stip_id).toBe("O-2");
    expect(matchStipForDocCode("funding_application", stips)?.stip_id).toBe("O-5");
  });

  it("returns null rather than guessing a slot", () => {
    expect(matchStipForDocCode("voided_check", stips)).toBeNull();
    expect(matchStipForDocCode("business_bank_statements", [])).toBeNull();
    expect(matchStipForDocCode(null, stips)).toBeNull();
  });
});

describe("status reading", () => {
  it("reads a decline with its reasons", () => {
    const s = interpretCrediblyStatus({ status: "Declined", decline_reasons: ["Time in business", "Revenue"] });
    expect(s.kind).toBe("declined");
    expect(s.kind === "declined" && s.note).toContain("Time in business");
  });

  it("treats an offer as approved", () => {
    const s = interpretCrediblyStatus({
      status: "Offers Ready",
      action_links: { offer_calc: [{ link: "https://credibly.example/offer/1" }] },
    });
    expect(s.kind).toBe("approved");
    expect(s.kind === "approved" && s.note).toContain("https://credibly.example/offer/1");
  });

  it("asks for information when stips are outstanding", () => {
    const s = interpretCrediblyStatus({
      status: "On Hold",
      stips: [{ stip_id: "O-2", stip_status: "Pending", short_text: "Bank Statements", long_text: "" }],
    });
    expect(s.kind).toBe("needs_info");
    expect(s.kind === "needs_info" && s.note).toContain("Bank Statements");
  });

  it("does not call a stalled deal declined", () => {
    expect(interpretCrediblyStatus({ status: "Withdrawn" }).kind).toBe("needs_info");
    expect(interpretCrediblyStatus({ status: "No PQ Offers Available" }).kind).toBe("needs_info");
  });

  it("leaves everything else in progress, including values not in the spec", () => {
    expect(interpretCrediblyStatus({ status: "Intake" }).kind).toBe("in_progress");
    expect(interpretCrediblyStatus({ status: "Some New Status" }).kind).toBe("in_progress");
    expect(interpretCrediblyStatus(null).kind).toBe("in_progress");
  });
});
