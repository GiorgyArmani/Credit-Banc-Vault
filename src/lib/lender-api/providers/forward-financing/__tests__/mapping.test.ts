import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import {
  bucketMonthlyRevenue,
  buildFfLead,
  ffTagsForDocCode,
  interpretFfStatus,
  mapFfAttachmentResults,
  mapFfEntityType,
  suggestFfIndustry,
  suggestFfLoanUse,
  suggestFfPicks,
  type FfLeadRequest,
} from "../mapping";

const ctx = { referenceId: "cb-assign-1-1" };

describe("buildFfLead — complete source", () => {
  const built = buildFfLead(makeSource(), {}, ctx);
  const lead = (built.payload as FfLeadRequest).lead;

  it("has no gaps", () => {
    expect(built.gaps).toEqual([]);
  });

  it("maps the owner contact", () => {
    expect(lead.contacts_attributes[0]).toEqual({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      born_on: "1980-02-03",
      cell_phone: "3055550100",
      ssn: "123456789",
      current_address_attributes: { street1: "22 Palm Ave", city: "Miami", state: "FL", zip: "33130" },
    });
  });

  it("maps the business account", () => {
    expect(lead.account_attributes).toMatchObject({
      entity_type: "LLC",
      name: "Doe Plumbing LLC",
      legal_name: "Doe Plumbing LLC",
      started_on: "2018-05-01",
      phone: "3055550199",
      fein: "123456789",
      industry_name: "Electricians/Plumbing/HVAC",
      monthly_revenue: "$20,000-$50,000",
      current_address_attributes: { street1: "10 Pipe St", city: "Miami", state: "FL", zip: "33101" },
    });
  });

  it("maps the application", () => {
    expect(lead.application_attributes).toEqual({
      has_current_loan: false,
      applicant_is_owner: true,
      loan_use: "Working Capital",
      capital_needed: "50000",
      owner_1_percent_ownership: 100,
      reference_id: "cb-assign-1-1",
      notes: "working capital",
    });
    expect(lead.loan_attributes).toBeUndefined();
  });

  it("reports effective picks", () => {
    expect(built.effectivePicks).toEqual({
      entity_type: "LLC",
      industry_name: "Electricians/Plumbing/HVAC",
      loan_use: "Working Capital",
      monthly_revenue: "$20,000-$50,000",
    });
  });

  it("redacts the SSN in the snapshot without touching the payload", () => {
    const redacted = built.redacted as FfLeadRequest;
    expect(redacted.lead.contacts_attributes[0].ssn).toBe("***-**-6789");
    expect(lead.contacts_attributes[0].ssn).toBe("123456789");
  });
});

describe("buildFfLead — gaps", () => {
  it.each([
    ["no SSN", { vault: { ssn: null } }, { field: "ssn", kind: "missing" }],
    ["short SSN", { vault: { ssn: "1234" } }, { field: "ssn", kind: "invalid" }],
    ["single-word owner name", { vault: { owner_1_name: "Jane" } }, { field: "owner_1_name", kind: "missing" }],
    ["no owner address", { vault: { home_address: null } }, { field: "owner_1_street", kind: "missing" }],
    ["no phone", { vault: { client_phone: "" }, business: { phone: null } }, { field: "client_phone", kind: "missing" }],
    ["no start date", { vault: { business_start_date: null }, business: { business_start_date: null } }, { field: "business_start_date", kind: "missing" }],
    ["unmappable entity", { vault: { legal_entity_type: "Other" }, business: { legal_entity_type: "Other" } }, { field: "pick:entity_type", kind: "missing" }],
    ["unmatched industry", { vault: { industry: "media/tech" }, business: { industry: null } }, { field: "pick:industry_name", kind: "missing" }],
  ] as Array<[string, Record<string, unknown>, { field: string; kind: string }]>)("%s", (_name, overrides, gap) => {
    const built = buildFfLead(makeSource(overrides as Record<string, unknown>), {}, ctx);
    expect(built.gaps).toEqual(expect.arrayContaining([expect.objectContaining(gap)]));
  });

  it("UW picks override suggestions and clear the gap", () => {
    const src = makeSource({ vault: { industry: "media/tech" }, business: { industry: null } });
    const built = buildFfLead(src, { industry_name: "Consulting" }, ctx);
    expect(built.gaps).toEqual([]);
    expect((built.payload as FfLeadRequest).lead.account_attributes.industry_name).toBe("Consulting");
  });

  it("an out-of-list pick is invalid", () => {
    const built = buildFfLead(makeSource(), { loan_use: "Yachts" }, ctx);
    expect(built.gaps).toEqual([{ field: "pick:loan_use", label: "Use of funds", kind: "invalid" }]);
  });
});

describe("buildFfLead — existing debt and second owner", () => {
  it("sends the largest open position, daily payment only when daily", () => {
    const built = buildFfLead(
      makeSource({
        vault: { owner_2_name: "Bob Doe", owner_2_ownership_pct: 40, owner_1_ownership_pct: 60 },
        openPositions: [
          { lender_name: "Small Co", current_balance: 5000, payment_amount: 100, payment_frequency: "Weekly" },
          { lender_name: "Big Co", current_balance: 20000, payment_amount: 350.4, payment_frequency: "Daily" },
        ],
      }),
      {},
      ctx
    );
    const lead = (built.payload as FfLeadRequest).lead;
    expect(lead.loan_attributes).toEqual({ company_name: "Big Co", balance: 20000, daily_payment_amount: 350 });
    expect(lead.application_attributes).toMatchObject({
      has_current_loan: true,
      owner_1_percent_ownership: 60,
      owner_2_percent_ownership: 40,
    });
  });
});

describe("suggestions", () => {
  it.each([
    ["LLC", "LLC"], ["S-Corp", "Corporation"], ["C-Corp", "Corporation"], ["Sole Prop", "Sole Proprietor"],
    ["Other", null], ["", null], [null, null],
  ])("entity %s → %s", (input, expected) => {
    expect(mapFfEntityType(input)).toBe(expected);
  });

  it.each([
    [null, null], [0, null], [4999, "Less than $5,000"], [5000, "$5,000-$10,000"], [19999, "$10,000-$20,000"],
    [20000, "$20,000-$50,000"], [100000, "$50,000-$100,000"], [100001, "Greater than $100,000"],
  ])("revenue %s → %s", (amount, bucket) => {
    expect(bucketMonthlyRevenue(amount as number | null)).toBe(bucket);
  });

  it.each([
    ["Offices of Certified Public Accountants", "Accounting & Tax Services"],
    ["Electrical Contractors and Other Wiring Installation Contractors", "Electricians/Plumbing/HVAC"],
    ["MECHANIC SHOP", "Automotive"],
    ["General Freight Trucking, Long-Distance, Truckload", "Trucking & Transportation"],
    ["Restaurant & Catering Business", "Restaurants & Bars"],
    ["Soybean Farming", "Farming"],
    ["Residential Remodelers", "General Contractor"],
    ["Insurance Restoration ", "General Contractor"],
    ["Healthcarea", "Medical"],
    ["Retail eccomerce", "Retail"],
    ["Marketing Consulting Services", "Consulting"],
    ["media/tech", null],
    [null, null],
  ])("industry %s → %s", (text, expected) => {
    expect(suggestFfIndustry(text)).toBe(expected);
  });

  it.each([
    ["consolidation of Mca's and working capital", "Debt Refinancing"],
    ["inventory + new equipment", "Equipment Purchase"],
    ["Looking for a line of credit to purchase inventory", "Inventory"],
    ["Opening of 3rd location", "New Location"],
    ["new hiring and working capital", "Hiring Employees"],
    ["Expanding property ", "Business Expansion"],
    ["", "Working Capital"],
    [null, "Working Capital"],
    ["something unrelated", "Working Capital"],
  ])("loan use %s → %s", (text, expected) => {
    expect(suggestFfLoanUse(text)).toBe(expected);
  });

  it("revenue suggestion prefers bank analysis over self-reported", () => {
    const picks = suggestFfPicks(makeSource({ analysis: { avg_revenue: 120000 }, vault: { avg_monthly_deposits: 3000 } }));
    expect(picks.monthly_revenue).toBe("Greater than $100,000");
  });
});

describe("ffTagsForDocCode", () => {
  it.each([
    ["business_bank_statements", ["bank_statement"]],
    ["drivers_license_front", ["drivers_license"]],
    ["voided_check", ["voided_check"]],
    ["personal_tax_returns", ["tax_return"]],
    ["profit_loss", ["balance_sheet_income_statement"]],
    ["ar_report", ["accounts_receivable_report_invoices"]],
    ["operating_agreement_bylaws", ["proof_of_ownership"]],
    ["misc_files", []],
    [null, []],
  ])("%s → %j", (code, tags) => {
    expect(ffTagsForDocCode(code)).toEqual(tags);
  });
});

describe("interpretFfStatus", () => {
  it("approval with variants", () => {
    const s = interpretFfStatus({
      stage: "Approval Sent",
      max_approval: 30000,
      max_payments: 7,
      offer_link: "https://offer.example",
      required_stipulations: [{ type: "Voided Check" }],
      notes: "Strong application",
      offer_variants: [
        { position: 1, variant_type: "base", max_approval_amount: 30000, max_term: 7, max_term_buy_rate: 1.34, net_funded_amount: 28500 },
      ],
    });
    expect(s).toEqual({
      kind: "approved",
      stage: "Approval Sent",
      note:
        "Offer 1 (base): max $30,000 · 7 payments · buy rate 1.34 · net funded $28,500\n" +
        "Stips: Voided Check\nOffer: https://offer.example\nNotes: Strong application",
    });
  });

  it("approval without variants falls back to top-level terms", () => {
    expect(interpretFfStatus({ stage: "Approval Sent", max_approval: 10000, max_payments: 5 })).toEqual({
      kind: "approved",
      stage: "Approval Sent",
      note: "Max approval $10,000 · 5 payments",
    });
  });

  it("declined", () => {
    expect(interpretFfStatus({ stage: "Declined", decline_drivers: "Excessive liens", decline_notes: "Credibility" })).toEqual({
      kind: "declined",
      stage: "Declined",
      note: "Decline drivers: Excessive liens\nNotes: Credibility",
    });
  });

  it("missing info", () => {
    expect(interpretFfStatus({ stage: "File Missing Info", missing_info: "More recent statements" })).toEqual({
      kind: "needs_info",
      stage: "File Missing Info",
      note: "More recent statements",
    });
  });

  it("working / unknown", () => {
    expect(interpretFfStatus({ stage: "Working" })).toEqual({ kind: "in_progress", stage: "Working" });
    expect(interpretFfStatus(null)).toEqual({ kind: "in_progress", stage: "Unknown" });
  });
});

describe("buildFfLead — second (non-primary) business", () => {
  const second = { is_primary: false, company_name: "Second Biz LLC", company_city: "Tampa", company_state: "FL", company_zip_code: "33601" };

  it("sends the second business's own name and legal name, never the vault DBA or FEIN", () => {
    const built = buildFfLead(makeSource({ vault: { dba: "Vault DBA" }, business: second }), {}, ctx);
    const account = (built.payload as FfLeadRequest).lead.account_attributes;
    expect(account.name).toBe("Second Biz LLC");
    expect(account.legal_name).toBe("Second Biz LLC");
    expect(account).not.toHaveProperty("fein");
    // The primary business's street is never sent for another business.
    expect(account).not.toHaveProperty("current_address_attributes");
    expect(built.gaps).toEqual([]);
  });

  it("falls back to the business name when the second business has no company name", () => {
    const built = buildFfLead(makeSource({ vault: { dba: "Vault DBA" }, business: { ...second, company_name: null } }), {}, ctx);
    const account = (built.payload as FfLeadRequest).lead.account_attributes;
    expect(account.name).toBe("Doe Plumbing");
    expect(account).not.toHaveProperty("legal_name");
  });

  it("the primary business still prefers the DBA", () => {
    const built = buildFfLead(makeSource({ vault: { dba: "Vault DBA" } }), {}, ctx);
    const account = (built.payload as FfLeadRequest).lead.account_attributes;
    expect(account.name).toBe("Vault DBA");
    expect(account.legal_name).toBe("Doe Plumbing LLC");
    expect(account.fein).toBe("123456789");
  });
});

describe("mapFfAttachmentResults", () => {
  const docs = [
    { documentId: "d1", filename: "a.pdf", url: "u1", docCode: null, stamped: true },
    { documentId: "d2", filename: "b.xlsx", url: "u2", docCode: null, stamped: false },
  ];

  it("202 accepts all", () => {
    expect(mapFfAttachmentResults(docs, { status: 202, data: {}, error: null }).every((r) => r.accepted)).toBe(true);
  });

  it("207 maps per index", () => {
    expect(
      mapFfAttachmentResults(docs, {
        status: 207,
        data: { results: [{ filename: "a.pdf", status: "accepted" }, { filename: "b.xlsx", status: "rejected", error: "bad url" }] },
        error: null,
      })
    ).toEqual([
      { documentId: "d1", filename: "a.pdf", stamped: true, accepted: true },
      { documentId: "d2", filename: "b.xlsx", stamped: false, accepted: false, error: "bad url" },
    ]);
  });

  it("other statuses fail every file with the error", () => {
    const r = mapFfAttachmentResults(docs, { status: 400, data: null, error: "HTTP 400" });
    expect(r.map((x) => [x.accepted, x.error])).toEqual([[false, "HTTP 400"], [false, "HTTP 400"]]);
  });
});
