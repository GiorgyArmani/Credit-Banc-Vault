import { describe, expect, it } from "vitest";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";
import type { OutboundDocument } from "@/lib/lender-api/types";
import {
  buildIdeaApplication,
  ideaTagsForDocCode,
  ideaTimeInBusiness,
  interpretIdeaStatus,
  mapIdeaEntityType,
  planIdeaUploads,
  sanitizeIdeaStatus,
  type IdeaApplication,
} from "../mapping";
import { IDEA_ENTITY_TYPES, IDEA_TIME_IN_BUSINESS } from "../constants";

const ctx = { referenceId: "ref-1" };

function build(o: Parameters<typeof makeSource>[0] = {}, picks = {}) {
  return buildIdeaApplication(makeSource(o), picks, ctx);
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

// Real sandbox responses (2026-10-07), owners/agent/business dropped.
const SANDBOX = {
  draft: { id: 714702, status: "draft", offerPageUrl: "", offers: [], checkoutRequirements: [], declinedReason: "", incompleteInfo: "" },
  processing: {
    id: 714702,
    status: "processing",
    offerPageUrl: "https://application.ideafinancial.net/preview/summary?uuid=b72b",
    offers: [],
    checkoutRequirements: [],
    declinedReason: "",
    incompleteInfo: "",
  },
  incomplete: {
    id: 714703,
    status: "submission-incomplete",
    offers: [],
    checkoutRequirements: [],
    declinedReason: "",
    incompleteInfo: "TEST: Application requires at least 2 unique phone numbers",
  },
  declined: {
    id: 714702,
    status: "declined",
    offers: [],
    checkoutRequirements: [],
    declinedReason: "",
    incompleteInfo: "TEST: Application requires at least 2 unique phone numbers",
  },
};

describe("idea mapping — payload", () => {
  it("builds a complete application from the fixture", () => {
    const built = build();
    const p = built.payload as IdeaApplication;
    expect(built.gaps).toEqual([]);
    expect(p.agentId).toBeUndefined(); // the client adds it from env
    expect(p.business).toMatchObject({
      name: "Doe Plumbing LLC",
      dba: "Doe Plumbing",
      entityType: "limited-liability-company",
      ein: "123456789",
      phone: "3055550199",
      timeInBusiness: "over-two-years",
      monthlySales: 45000,
      physicalAddress: { address1: "10 Pipe St", city: "Miami", state: "FL", zip: "33101" },
    });
    expect(p.business.description).toBeTruthy();
    expect(p.owners).toHaveLength(1);
    expect(p.owners[0]).toMatchObject({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      dateOfBirth: "1980-02-03",
      mobilePhone: "3055550100",
      ssn: "123456789",
      ownershipPercentage: 100,
      homeAddress: { address1: "22 Palm Ave", city: "Miami", state: "FL", zip: "33130" },
    });
    expect(p.requestedAmount).toBe(50000);
  });

  it("only uses vocabulary Idea accepts", () => {
    const p = build().payload as IdeaApplication;
    expect(IDEA_ENTITY_TYPES).toContain(p.business.entityType);
    expect(IDEA_TIME_IN_BUSINESS).toContain(p.business.timeInBusiness);
  });

  it("redacts the SSN on the stored copy only", () => {
    const built = build({ owners: [owner(2)] });
    const red = built.redacted as IdeaApplication;
    expect(red.owners.map((o) => o.ssn)).toEqual(["***-**-6789", "***-**-4321"]);
    expect((built.payload as IdeaApplication).owners[0].ssn).toBe("123456789");
  });

  it("maps entity types and leaves the unmappable to UW", () => {
    expect(mapIdeaEntityType("LLC")).toBe("limited-liability-company");
    expect(mapIdeaEntityType("S-Corp")).toBe("corporation");
    expect(mapIdeaEntityType("Sole Proprietor")).toBe("sole-proprietorship");
    expect(mapIdeaEntityType("Partnership")).toBe("general-partnership");
    expect(mapIdeaEntityType("Non-Profit")).toBe("not-for-profit");
    expect(mapIdeaEntityType("LLP")).toBeNull();
    const built = build({ vault: { legal_entity_type: "LLP" }, business: { legal_entity_type: "LLP" } });
    expect(built.gaps).toContainEqual({ field: "pick:entity_type", label: "Entity type", kind: "missing" });
    expect(build({}, { entity_type: "llc" }).gaps).toContainEqual({ field: "pick:entity_type", label: "Entity type", kind: "invalid" });
  });

  it("buckets time in business", () => {
    const now = new Date("2026-10-07T00:00:00Z");
    expect(ideaTimeInBusiness("2026-03-01", now)).toBe("zero-one-years");
    expect(ideaTimeInBusiness("2025-06-01", now)).toBe("one-two-years");
    expect(ideaTimeInBusiness("2018-05-01", now)).toBe("over-two-years");
    expect(ideaTimeInBusiness(null, now)).toBeNull();
  });
});

describe("idea mapping — gaps", () => {
  it("flags every required owner field", () => {
    const built = build({
      vault: { client_email: null, owner_1_dob: null, ssn: "123", client_phone: null, owner_1_ownership_pct: null },
      business: { phone: null },
    });
    const fields = built.gaps.map((g) => g.field);
    for (const f of ["client_email", "owner_1_dob", "ssn", "client_phone", "owner:1"]) expect(fields).toContain(f);
  });

  it("needs a description, an EIN and a business address", () => {
    const built = build({
      vault: { ein: null, industry: null, business_address: null, company_city: null, company_state: null, company_zip_code: null },
      business: { industry: null, company_city: null, company_state: null, company_zip_code: null },
    });
    const fields = built.gaps.map((g) => g.field);
    for (const f of ["ein", "business:industry", "business_street", "company_city", "company_state", "company_zip_code"]) {
      expect(fields).toContain(f);
    }
  });

  it("never sends the primary business's EIN for another business", () => {
    const built = build({ business: { is_primary: false } });
    expect(built.gaps).toContainEqual(expect.objectContaining({ field: "business:ein" }));
  });
});

describe("idea mapping — co-owners", () => {
  it("sends complete co-owners", () => {
    const p = build({ vault: { owner_1_ownership_pct: 60 }, owners: [owner(2)] }).payload as IdeaApplication;
    expect(p.owners).toHaveLength(2);
    expect(p.owners[1]).toMatchObject({ firstName: "John", lastName: "Partner", ownershipPercentage: 40, ssn: "987654321" });
  });

  it("blocks on an incomplete 20%+ owner, drops an incomplete minority owner", () => {
    const big = build({ vault: { owner_1_ownership_pct: 60 }, owners: [owner(2, { ssn: null })] });
    expect(big.gaps).toContainEqual(expect.objectContaining({ field: "owner:2", kind: "missing" }));
    const small = build({ vault: { owner_1_ownership_pct: 90 }, owners: [owner(2, { ownership_pct: 10, email: null })] });
    expect(small.gaps).toEqual([]);
    expect((small.payload as IdeaApplication).owners).toHaveLength(1);
  });

  it("refuses shares over 100% and unknown co-owners", () => {
    expect(build({ owners: [owner(2)] }).gaps).toContainEqual(expect.objectContaining({ field: "owner:shares" }));
    const unknown = build({ ownersAvailable: false, vault: { owner_1_ownership_pct: 50, owner_2_name: "X", owner_2_ownership_pct: 50 } });
    expect(unknown.gaps).toContainEqual(expect.objectContaining({ field: "owner:2" }));
  });
});

describe("idea mapping — documents", () => {
  const doc = (id: string, filename: string, docCode: string | null): OutboundDocument => ({
    documentId: id,
    filename,
    url: `https://x/${id}`,
    docCode,
    stamped: false,
  });

  it("tags only the two submission types", () => {
    expect(ideaTagsForDocCode("signed_application")).toEqual(["application"]);
    expect(ideaTagsForDocCode("business_bank_statements")).toEqual(["bank-statement"]);
    expect(ideaTagsForDocCode("drivers_license")).toEqual([]);
  });

  it("plans uploads, refusing untyped files, bad formats and the Draft caps", () => {
    const docs = [
      doc("a", "app.pdf", "signed_application"),
      doc("b", "dl.pdf", "drivers_license"),
      doc("c", "scan.HEIC", "business_bank_statements"),
      ...Array.from({ length: 7 }, (_, i) => doc(`s${i}`, `stmt-${i}.pdf`, "business_bank_statements")),
    ];
    const plans = planIdeaUploads(docs);
    expect(plans[0]).toEqual({ documentType: "application", fileName: "app.pdf", fileExtension: ".pdf", mimeType: "application/pdf" });
    expect(plans[1]).toHaveProperty("error");
    expect(plans[2]).toHaveProperty("error");
    expect(plans.slice(3, 9).every((p) => "documentType" in p)).toBe(true);
    expect(plans[9]).toEqual({ error: "Idea takes at most 6 bank-statement files per submission" });
  });
});

describe("idea mapping — status", () => {
  it("reads real sandbox statuses", () => {
    expect(interpretIdeaStatus(SANDBOX.processing)).toEqual({ kind: "in_progress", stage: "processing" });
    expect(interpretIdeaStatus(SANDBOX.incomplete)).toEqual({
      kind: "needs_info",
      stage: "submission-incomplete",
      note: "TEST: Application requires at least 2 unique phone numbers",
    });
    // Sandbox puts the decline text in incompleteInfo; declinedReason stays empty.
    expect(interpretIdeaStatus(SANDBOX.declined)).toEqual({
      kind: "declined",
      stage: "declined",
      note: "TEST: Application requires at least 2 unique phone numbers",
    });
  });

  it("reports a draft as not yet submitted, with Idea's push refusal", () => {
    const s = interpretIdeaStatus({ ...SANDBOX.draft, pushError: "Signed Application document has to be uploaded to proceed." });
    expect(s.kind).toBe("needs_info");
    expect("note" in s && s.note).toContain("Signed Application document has to be uploaded");
  });

  // Real sandbox offer (app 714735, 2026-10-07), trimmed to two of its four offers.
  const OFFER = {
    status: "offer",
    offerPageUrl: "https://application.ideafinancial.net/preview/summary?uuid=eed9",
    checkoutRequirements: [],
    offers: [
      {
        id: 259192,
        status: "pending",
        details: {
          term: 12, productType: "term-loan", paymentFrequency: "weekly", offerDate: "2026-10-07T00:00:00",
          interestRate: 1.29, maxInterestRate: 1.29, minInterestRate: 1.29, maintenanceFee: 0.5, originationFee: 0,
          servicingFee: 0, drawFee: 0, minDrawFee: 0, maxDrawFee: 0, amount: 200000, minAmount: 200000, maxAmount: 200000,
        },
        checkoutRequirements: [],
      },
      {
        id: 259193,
        status: "pending",
        details: {
          term: 18, productType: "line-of-credit", paymentFrequency: "weekly", offerDate: "2026-10-07T00:00:00",
          interestRate: 30.5, maxInterestRate: 30.5, minInterestRate: 30.5, maintenanceFee: 1, originationFee: 0,
          servicingFee: 0, drawFee: 2.25, minDrawFee: 2.25, maxDrawFee: 2.25, amount: 250000, minAmount: 250000, maxAmount: 250000,
        },
        checkoutRequirements: [],
      },
    ],
  };

  it("reads the real sandbox offer body", () => {
    const s = interpretIdeaStatus(OFFER);
    expect(s).toEqual({
      kind: "approved",
      stage: "offer",
      note: [
        "Term loan · $200,000 · 12 months · weekly · 1.29% · maintenance 0.5%",
        "Line of credit · $250,000 · 18 months · weekly · 30.5% · maintenance 1% · draw fee 2.25%",
        "Offer page: https://application.ideafinancial.net/preview/summary?uuid=eed9",
      ].join("\n"),
    });
  });

  it("waits for the offers: status flips to offer before they are attached", () => {
    expect(interpretIdeaStatus({ ...OFFER, offers: [] })).toEqual({ kind: "in_progress", stage: "offer" });
    expect(interpretIdeaStatus({ ...OFFER, status: "conditional-offer", offers: [] }).kind).toBe("in_progress");
  });

  it("treats every later stage as approved, even without offers", () => {
    for (const stage of ["closing", "closing-incomplete", "contract-ready", "contract-out", "open", "funded", "closed"]) {
      expect(interpretIdeaStatus({ status: stage, offers: [] }).kind).toBe("approved");
    }
    // Customer walked away — not a lender decision.
    for (const stage of ["not-interested", "abandoned", "dormant"]) {
      expect(interpretIdeaStatus({ status: stage }).kind).toBe("in_progress");
    }
  });

  it("reads real sandbox stips: skips not-required-for-offer-selected, shows a question's text", () => {
    const s = interpretIdeaStatus({
      ...OFFER,
      checkoutRequirements: [
        { id: 274598, status: "required", name: "Voided Check", requiredDocument: "Voided Check", fileUploaded: true, requiredDocumentType: "document", notes: "TEST: should be readable and valid scan", files: [] },
        { id: 274599, status: "required", name: "Question", requiredDocument: "Question", fileUploaded: false, requiredDocumentType: "text", notes: "TEST: What account are payroll payments issued from?", files: [] },
        { id: 274600, status: "not-required-for-offer-selected", name: "Lender Contract", requiredDocument: "Lender Contract", requiredDocumentType: "document", files: [] },
      ],
    });
    const note = "note" in s ? s.note : "";
    expect(note).toContain("Stips: Voided Check, Question (TEST: What account are payroll payments issued from?)");
    expect(note).not.toContain("Lender Contract");
  });

  it("lists open stips (top level and per offer) and shows ranges", () => {
    const s = interpretIdeaStatus({
      status: "offer",
      offers: [
        {
          id: 1,
          status: "accepted",
          details: { productType: "term-loan", minAmount: 100000, maxAmount: 200000, minInterestRate: 1.1, maxInterestRate: 1.3 },
          checkoutRequirements: [{ id: 11, name: "Bank verification", status: "required" }],
        },
      ],
      checkoutRequirements: [
        { id: 9, name: "Voided check", status: "required" },
        { id: 10, name: "Photo ID", status: "approved" },
      ],
    });
    const note = "note" in s ? s.note : "";
    expect(note).toContain("$100,000–$200,000");
    expect(note).toContain("1.1%–1.3%");
    expect(note).toContain("(accepted)");
    expect(note).toContain("Stips: Voided check, Bank verification");
    expect(note).not.toContain("Photo ID");
  });

  it("stores nothing personal", () => {
    const stored = sanitizeIdeaStatus({
      ...SANDBOX.processing,
      owners: [{ ssn: "589-12-3456", dateOfBirth: "1980-05-15" }],
      business: { ein: "123456789" },
      agent: { email: "a@b.c" },
    });
    const text = JSON.stringify(stored);
    expect(text).not.toContain("589-12-3456");
    expect(text).not.toContain("123456789");
    expect(stored.status).toBe("processing");
  });
});
