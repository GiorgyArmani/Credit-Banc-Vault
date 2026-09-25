import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import {
  buildLootApplication,
  interpretLootStatus,
  lootDealId,
  lootStatusFromWebhook,
  mapLootEntityType,
  suggestLootIndustry,
  toLootPhone,
  type LootApplicationForm,
} from "../mapping";

const ctx = { referenceId: "cb-assign-1-1" };

function build(source = makeSource(), picks: Record<string, string> = {}) {
  const built = buildLootApplication(source, picks, ctx);
  return { built, form: built.payload as LootApplicationForm };
}

describe("loot application form", () => {
  it("builds a complete form with no gaps from a normal file", () => {
    const { built, form } = build();
    expect(built.gaps).toEqual([]);
    expect(form).toMatchObject({
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      phone: "305-555-0100",
      requestingAmount: "50000",
      // Monthly revenue × 12.
      estimatedAnnualRevenue: "540000",
      businessDescription: "Plumbing and HVAC",
      businessName: "Doe Plumbing LLC",
      dba: "Doe Plumbing",
      entityType: "LLC",
      industry: "construction",
      ein: "123456789",
      website: "N/A",
      "address[addressLine1]": "10 Pipe St",
      "address[city]": "Miami",
      "address[state]": "FL",
      "address[zip]": "33101",
      incorporationDate: "2018-05-01",
      "owners[0][first_name]": "Jane",
      "owners[0][last_name]": "Doe",
      "owners[0][email]": "jane@example.com",
      "owners[0][phone]": "305-555-0100",
      "owners[0][dob]": "1980-02-03",
      "owners[0][ssn]": "123456789",
      "owners[0][address][addressLine1]": "22 Palm Ave",
      "owners[0][address][city]": "Miami",
      "owners[0][address][state]": "FL",
      "owners[0][address][zip]": "33130",
      "owners[0][ownership]": "100",
      purposeExplanation: "working capital",
    });
    // Every value is a string: this becomes multipart form data.
    expect(Object.values(form).every((v) => typeof v === "string")).toBe(true);
  });

  it("redacts the SSN in the stored snapshot only", () => {
    const { built, form } = build();
    expect(form["owners[0][ssn]"]).toBe("123456789");
    expect((built.redacted as LootApplicationForm)["owners[0][ssn]"]).toBe("*****6789");
  });

  it("enforces Loot's minimums", () => {
    const { built } = build(makeSource({ deal: { capital_requested: 4000 }, analysis: { avg_revenue: 1500 } }));
    const fields = built.gaps.map((g) => g.field);
    expect(fields).toContain("capital_requested");
    expect(fields).toContain("average_revenue");
  });

  it("flags missing owner and business essentials", () => {
    const { built } = build(
      makeSource({
        vault: { client_email: null, client_phone: "12", ssn: null, owner_1_dob: null, ein: null, industry: null },
        business: { industry: null },
      })
    );
    expect(built.gaps.map((g) => g.field)).toEqual(
      expect.arrayContaining(["client_email", "client_phone", "ssn", "owner_1_dob", "ein", "industry"])
    );
  });

  it("requires an entity type it can't guess", () => {
    const { built } = build(makeSource({ vault: { legal_entity_type: "Trust" }, business: { legal_entity_type: "Trust" } }));
    expect(built.gaps.map((g) => g.field)).toContain("pick:entityType");
    expect(build(makeSource(), { entityType: "Trust" }).built.gaps[0]).toMatchObject({ field: "pick:entityType", kind: "invalid" });
  });

  it("sends 'other' with the free-text industry", () => {
    const { form } = build(makeSource({ business: { industry: "Pet grooming" } }));
    expect(form.industry).toBe("other");
    expect(form.industryOther).toBe("Pet grooming");
  });

  it("lists open positions as debt balances", () => {
    const { form } = build(
      makeSource({
        openPositions: [
          { lender_name: "Funder A", current_balance: 9000, payment_amount: 250, payment_frequency: "Daily" },
          { lender_name: "Funder B", current_balance: null, payment_amount: 900, payment_frequency: "Weekly" },
        ],
      })
    );
    expect(form["debtBalanceDetails[0][lenderName]"]).toBe("Funder A");
    expect(form["debtBalanceDetails[0][balance]"]).toBe("9000");
    expect(form["debtBalanceDetails[1][lenderName]"]).toBe("Funder B");
    expect(form).not.toHaveProperty("debtBalanceDetails[1][balance]");
  });

  it("never sends the primary business's EIN for a second business", () => {
    const { built, form } = build(makeSource({ business: { is_primary: false, company_name: "Second Co" } }));
    expect(form.ein).toBe("");
    expect(built.gaps.map((g) => g.field)).toContain("ein");
  });
});

describe("loot helpers", () => {
  it("formats phones as NNN-NNN-NNNN", () => {
    expect(toLootPhone("+1 (443) 323-2323")).toBe("443-323-2323");
    expect(toLootPhone("4433232323")).toBe("443-323-2323");
    expect(toLootPhone("323-2323")).toBeNull();
  });

  it("maps entity types and industries onto their enums", () => {
    expect(mapLootEntityType("S-Corp")).toBe("CORPORATION");
    expect(mapLootEntityType("Sole Proprietor")).toBe("SOLE PROPRIETORSHIP");
    expect(mapLootEntityType("LP")).toBe("PARTNERSHIP");
    expect(mapLootEntityType("Non-profit")).toBe("NON-PROFIT");
    expect(suggestLootIndustry("Freight trucking")).toBe("transportation-trucking");
    expect(suggestLootIndustry("Italian restaurant")).toBe("restaurants-bars");
    expect(suggestLootIndustry(null)).toBeNull();
  });
});

describe("loot webhooks + status", () => {
  const rbf = {
    apiVersion: "v1",
    nonce: "nOGtnBr670ym",
    eventType: "DEAL_DECISION",
    createdAt: "2024-12-20T11:08:33.711Z",
    data: {
      deal: {
        deal_id: "P1PeHLSwU3OxI9RTlKXGc9xI",
        offer_type: "MCA",
        factor_rate: 1.4,
        processing_fee: 300,
        repayment_frequency: "Weekly",
        advance_amount: 8700,
        deal_stage: "acceptedByCustomer",
        description: "",
      },
    },
  };

  it("reads the deal id and the deal out of a DEAL_DECISION", () => {
    expect(lootDealId(rbf)).toBe("P1PeHLSwU3OxI9RTlKXGc9xI");
    expect(lootDealId({ data: { deal: { deal_id: 1 } } })).toBe("1");
    expect(lootDealId({})).toBeNull();
    expect(lootStatusFromWebhook(rbf)).toEqual(rbf.data.deal);
    expect(lootStatusFromWebhook({ ...rbf, eventType: "DRAW_INFORMATION" })).toBeNull();
  });

  it("treats approvals as approved, with the offer in the note", () => {
    const s = interpretLootStatus(rbf.data.deal);
    expect(s.kind).toBe("approved");
    expect(s.kind === "approved" ? s.note : "").toMatch(/MCA, \$8,700 advance, factor 1\.4, Weekly payments, processing fee \$300/);

    const loc = interpretLootStatus({
      deal_id: "Q",
      offer_type: "LOCAP",
      buy_rate: 1.33,
      factor_rate: 1.33,
      repayment_term: 20,
      deal_stage: "approvedOffer",
      term_options: [{ plan: "SHORTEST", factor_rate: 1.27, repayment_term: 12, repayment_frequency: "Weekly" }],
      accept_link: "https://dev.os.getloot.com/partner-offer-calculator?token=x",
    });
    expect(loc.kind).toBe("approved");
    const note = loc.kind === "approved" ? loc.note : "";
    expect(note).toMatch(/Term options: SHORTEST 12 Weekly @ 1\.27/);
    expect(note).toMatch(/Offer link: https:\/\/dev\.os\.getloot\.com/);
  });

  it("treats a Loot decline as declined, with the reason", () => {
    expect(interpretLootStatus({ deal_id: "C", deal_stage: "approvedOfferDeclined", decline_reason: "Test reason" })).toEqual({
      kind: "declined",
      stage: "approvedOfferDeclined",
      note: "Decline reason: Test reason",
    });
  });

  it("treats a customer turning the offer down as needs-info, not a lender decline", () => {
    for (const stage of ["declineByCustomer", "LocOfferDeclined"]) {
      expect(interpretLootStatus({ deal_stage: stage }).kind).toBe("needs_info");
    }
  });

  it("treats anything else as in progress", () => {
    expect(interpretLootStatus({ deal_stage: "underReview" })).toEqual({ kind: "in_progress", stage: "underReview" });
    expect(interpretLootStatus(null)).toEqual({ kind: "in_progress", stage: "Submitted" });
  });
});
