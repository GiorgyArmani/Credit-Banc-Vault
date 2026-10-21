import { describe, expect, it } from "vitest";
import { buildYesLeasingApplication, isEncryptedPdf, yesLeasingTagsForDocCode } from "../mapping";
import { makeSource } from "@/lib/lender-api/__tests__/fixtures";

describe("yes leasing mapping", () => {
  it("has no payload and no gaps — Kaaj reads the deal from the files", () => {
    const built = buildYesLeasingApplication(makeSource(), {}, { referenceId: "cb-9" });
    expect(built).toEqual({ payload: { referenceId: "cb-9" }, redacted: { referenceId: "cb-9" }, gaps: [], effectivePicks: {} });
  });

  it("labels the three documents YES Leasing usually needs", () => {
    expect(yesLeasingTagsForDocCode("signed_application")).toEqual(["Application"]);
    expect(yesLeasingTagsForDocCode("equipment_invoice")).toEqual(["Invoice"]);
    expect(yesLeasingTagsForDocCode("business_bank_statements")).toEqual(["Bank statements (last 3 months)"]);
    expect(yesLeasingTagsForDocCode("drivers_license")).toEqual([]);
    expect(yesLeasingTagsForDocCode(null)).toEqual([]);
  });

  it("spots an encrypted PDF by its /Encrypt trailer entry, only on PDFs", () => {
    expect(isEncryptedPdf("a.pdf", Buffer.from("%PDF-1.4 ... trailer << /Encrypt 9 0 R >>"))).toBe(true);
    expect(isEncryptedPdf("scan", Buffer.from("%PDF-1.4 ... /Encrypt"))).toBe(true);
    expect(isEncryptedPdf("a.pdf", Buffer.from("%PDF-1.4 ... trailer << /Root 1 0 R >>"))).toBe(false);
    expect(isEncryptedPdf("notes.txt", Buffer.from("see /Encrypt"))).toBe(false);
  });
});
