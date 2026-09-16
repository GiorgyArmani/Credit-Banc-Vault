// src/lib/lender-api/__tests__/documents.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/share-links", () => ({
  loadGroupsByBusiness: vi.fn(),
  groupScopedCategoryLabel: vi.fn(),
  filterToExistingObjects: vi.fn(),
}));

import { outboundFilename, selectSubmittable, type DocumentRow } from "@/lib/lender-api/documents";

const row = (o: Partial<DocumentRow>): DocumentRow => ({
  id: "d1",
  name: "stmt.pdf",
  custom_label: null,
  doc_code: "business_bank_statements",
  category: null,
  business_profile_id: "bp-1",
  funding_deal_id: null,
  status: "ready",
  document_group_id: null,
  storage_path: "user-1/stmt.pdf",
  type: "application/pdf",
  ...o,
});

const base = {
  businessProfileId: "bp-1",
  dealId: "deal-2",
  labelFor: (code: string) => code.toUpperCase(),
  tagsForDocCode: (code: string | null) => (code === "business_bank_statements" ? ["bank_statement"] : []),
};

describe("selectSubmittable", () => {
  it("keeps this business + round (or carry-over), drops rejected, other business and older rounds", () => {
    const docs = selectSubmittable({
      ...base,
      approvals: [],
      rows: [
        row({ id: "keep-carry", funding_deal_id: null }),
        row({ id: "keep-round", funding_deal_id: "deal-2" }),
        row({ id: "old-round", funding_deal_id: "deal-1" }),
        row({ id: "rejected", status: "rejected" }),
        row({ id: "other-biz", business_profile_id: "bp-9" }),
        row({ id: "dl-any-biz", doc_code: "drivers_license", business_profile_id: "bp-9" }),
        row({ id: "no-code", doc_code: null, category: null }),
      ],
    });
    expect(docs.map((d) => d.id).sort()).toEqual(["dl-any-biz", "keep-carry", "keep-round"]);
  });

  it("preselects categories approved for this business and round", () => {
    const docs = selectSubmittable({
      ...base,
      approvals: [
        { doc_code: "business_bank_statements", business_profile_id: "bp-1", funding_deal_id: "deal-2" },
        { doc_code: "voided_check", business_profile_id: "bp-1", funding_deal_id: "deal-1" },
      ],
      rows: [row({ id: "stmt" }), row({ id: "check", doc_code: "voided_check" })],
    });
    expect(Object.fromEntries(docs.map((d) => [d.id, d.preselected]))).toEqual({ stmt: true, check: false });
  });

  it("flags unstampable files and attaches provider tags and labels", () => {
    const [xlsx] = selectSubmittable({
      ...base,
      approvals: [],
      rows: [row({ id: "x", name: "pnl.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })],
    });
    expect(xlsx).toMatchObject({ stampable: false, tags: ["bank_statement"], label: "BUSINESS_BANK_STATEMENTS", file_name: "pnl.xlsx" });
  });
});

describe("outboundFilename", () => {
  it("uses the custom label, forces .pdf when stamped, strips path characters", () => {
    expect(outboundFilename({ custom_label: "Chase / Jan", name: "a.png" }, true)).toBe("Chase - Jan.pdf");
    expect(outboundFilename({ custom_label: null, name: "pnl.xlsx" }, false)).toBe("pnl.xlsx");
    expect(outboundFilename({ custom_label: "Statement.PDF", name: "x.pdf" }, true)).toBe("Statement.pdf");
  });

  it("keeps the original extension when an unstamped file's custom label has none", () => {
    expect(outboundFilename({ custom_label: "Chase Jan", name: "pnl.xlsx" }, false)).toBe("Chase Jan.xlsx");
    expect(outboundFilename({ custom_label: "Report.docx", name: "x.xlsx" }, false)).toBe("Report.docx");
    expect(outboundFilename({ custom_label: "Chase Jan", name: "noext" }, false)).toBe("Chase Jan");
    expect(outboundFilename({ custom_label: "Chase Jan", name: "a.png" }, true)).toBe("Chase Jan.pdf");
  });
});
