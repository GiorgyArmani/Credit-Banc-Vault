// src/lib/__tests__/document-packages-shared.test.ts
import { describe, it, expect } from "vitest";
import {
  PROGRAM_DOCUMENT_PACKAGES,
  packageForLoanTypes,
} from "@/data/program-document-packages";
import { FUNDING_OPTIONS } from "@/data/loan-types";
import {
  docCodeFromLabel,
  loanTypesFor,
  mergePackageOverrides,
  validateLoanTypeName,
  validateNewDocumentType,
  validatePackageInput,
} from "@/lib/document-packages-shared";

const CATALOG = new Set([
  "funding_application",
  "business_bank_statements",
  "drivers_license",
  "voided_check",
  "pfs",
  "lender_documentation",
]);

describe("mergePackageOverrides", () => {
  it("returns the built-in lists when nothing is edited", () => {
    expect(mergePackageOverrides([])).toEqual(PROGRAM_DOCUMENT_PACKAGES);
  });

  it("replaces only the edited loan type", () => {
    const merged = mergePackageOverrides([
      { loan_type: "MCA", document_codes: ["funding_application", "business_bank_statements"], statement_months: 6 },
    ]);
    expect(merged.MCA).toEqual({
      codes: ["funding_application", "business_bank_statements"],
      statementMonths: 6,
    });
    expect(merged["SBA Loan"]).toBe(PROGRAM_DOCUMENT_PACKAGES["SBA Loan"]);
  });

  it("gives 'Other' a list once someone saves one", () => {
    const merged = mergePackageOverrides([
      { loan_type: "Other", document_codes: ["funding_application"], statement_months: null },
    ]);
    expect(merged.Other).toEqual({ codes: ["funding_application"] });
  });

  it("drops the month count when the list has no bank statements", () => {
    const merged = mergePackageOverrides([
      { loan_type: "MCA", document_codes: ["pfs"], statement_months: 12 },
    ]);
    expect(merged.MCA).toEqual({ codes: ["pfs"] });
  });

  it("ignores an empty edit", () => {
    const merged = mergePackageOverrides([
      { loan_type: "MCA", document_codes: [], statement_months: null },
      { loan_type: "Franchise Loan", document_codes: [], statement_months: null },
    ]);
    expect(merged.MCA).toBe(PROGRAM_DOCUMENT_PACKAGES.MCA);
    expect(merged["Franchise Loan"]).toBeUndefined();
  });

  it("carries a loan type staff added", () => {
    const merged = mergePackageOverrides([
      { loan_type: "Franchise Loan", document_codes: ["pfs", "business_bank_statements"], statement_months: 6 },
    ]);
    expect(merged["Franchise Loan"]).toEqual({
      codes: ["pfs", "business_bank_statements"],
      statementMonths: 6,
    });
  });
});

describe("loanTypesFor", () => {
  it("is the built-in list when nothing was added", () => {
    expect(loanTypesFor(mergePackageOverrides([]))).toEqual([...FUNDING_OPTIONS]);
  });

  it("slots added loan types in A–Z, ahead of Other", () => {
    const types = loanTypesFor(
      mergePackageOverrides([
        { loan_type: "Working Capital", document_codes: ["pfs"], statement_months: null },
        { loan_type: "Franchise Loan", document_codes: ["pfs"], statement_months: null },
        { loan_type: "MCA", document_codes: ["pfs"], statement_months: null },
      ]),
    );
    expect(types).toHaveLength(FUNDING_OPTIONS.length + 2);
    expect(types.slice(-3)).toEqual(["Franchise Loan", "Working Capital", "Other"]);
    expect(types.filter((t) => t === "MCA")).toHaveLength(1);
  });
});

describe("validateLoanTypeName", () => {
  const existing = [...FUNDING_OPTIONS, "Franchise Loan"];

  it("tidies whitespace", () => {
    expect(validateLoanTypeName("  Working   Capital ", existing)).toEqual({ ok: true, value: "Working Capital" });
  });

  it("rejects an empty, overlong or comma-carrying name", () => {
    expect(validateLoanTypeName(" ", existing).ok).toBe(false);
    expect(validateLoanTypeName("x".repeat(61), existing).ok).toBe(false);
    // Loan types are stored comma-joined on a file.
    expect(validateLoanTypeName("Bridge, Short Term", existing).ok).toBe(false);
  });

  it("rejects a name already in use, whatever its case", () => {
    expect(validateLoanTypeName("sba loan", existing).ok).toBe(false);
    expect(validateLoanTypeName("FRANCHISE LOAN", existing).ok).toBe(false);
  });
});

describe("validateNewDocumentType", () => {
  const catalog = [
    { code: "pfs", label: "Personal Financial Statement" },
    { code: "franchise_agreement", label: "Franchise Agreement" },
  ];

  it("builds the catalog row from the name", () => {
    expect(
      validateNewDocumentType(
        { label: "  Lease  Agreement (signed) ", description: " All pages. ", allow_multiple: true },
        catalog,
      ),
    ).toEqual({
      ok: true,
      value: {
        code: "lease_agreement_signed",
        label: "Lease Agreement (signed)",
        description: "All pages.",
        is_multiple: true,
        min_files: 1,
        max_files: 12,
        ghl_tag: "requested_lease_agreement_signed",
      },
    });
  });

  it("caps a single-file document at one file and stores no empty description", () => {
    const res = validateNewDocumentType({ label: "EIN Letter", description: "  " }, catalog);
    expect(res).toMatchObject({
      ok: true,
      value: { is_multiple: false, max_files: 1, description: null },
    });
  });

  it("refuses a second document with the same name or code", () => {
    expect(validateNewDocumentType({ label: "personal financial statement" }, catalog).ok).toBe(false);
    expect(validateNewDocumentType({ label: "Franchise-Agreement" }, catalog).ok).toBe(false);
  });

  it("refuses a name that can't make a code", () => {
    expect(validateNewDocumentType({ label: "" }, catalog).ok).toBe(false);
    expect(validateNewDocumentType({ label: "1099" }, catalog).ok).toBe(false);
    expect(validateNewDocumentType({ label: "??" }, catalog).ok).toBe(false);
  });

  it("keeps codes within length", () => {
    expect(docCodeFromLabel("A ".repeat(60)).length).toBeLessThanOrEqual(50);
  });
});

describe("packageForLoanTypes with edited lists", () => {
  it("unions from the map it is given", () => {
    const merged = mergePackageOverrides([
      { loan_type: "MCA", document_codes: ["business_bank_statements", "pfs"], statement_months: 24 },
      { loan_type: "E-commerce", document_codes: ["pfs", "voided_check"], statement_months: null },
    ]);
    expect(packageForLoanTypes(["MCA", "E-commerce"], merged)).toEqual({
      codes: ["business_bank_statements", "pfs", "voided_check"],
      statementMonths: 24,
      withoutPackage: [],
    });
  });

  it("still defaults to the built-in lists", () => {
    expect(packageForLoanTypes(["MCA"]).codes).toEqual([...PROGRAM_DOCUMENT_PACKAGES.MCA.codes]);
  });
});

describe("validatePackageInput", () => {
  it("accepts a list, trimming and de-duplicating in order", () => {
    const res = validatePackageInput(
      { loan_type: "MCA", document_codes: [" pfs ", "drivers_license", "pfs"], statement_months: null },
      CATALOG,
    );
    expect(res).toEqual({
      ok: true,
      value: { loan_type: "MCA", document_codes: ["pfs", "drivers_license"], statement_months: null },
    });
  });

  it("rejects a loan type that doesn't exist, and accepts one staff added", () => {
    const input = { loan_type: "Franchise Loan", document_codes: ["pfs"], statement_months: null };
    expect(validatePackageInput(input, CATALOG).ok).toBe(false);
    expect(validatePackageInput(input, CATALOG, [...FUNDING_OPTIONS, "Franchise Loan"]).ok).toBe(true);
  });

  it("rejects an empty list", () => {
    const res = validatePackageInput({ loan_type: "MCA", document_codes: [], statement_months: null }, CATALOG);
    expect(res.ok).toBe(false);
  });

  it("names the codes the catalog doesn't carry", () => {
    const res = validatePackageInput(
      { loan_type: "MCA", document_codes: ["pfs", "made_up"], statement_months: null },
      CATALOG,
    );
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toContain("made_up");
  });

  it("never lets lender documentation onto a request list", () => {
    const res = validatePackageInput(
      { loan_type: "MCA", document_codes: ["lender_documentation"], statement_months: null },
      CATALOG,
    );
    expect(res.ok).toBe(false);
  });

  it("requires a valid month count with bank statements, and clears it without", () => {
    const base = { loan_type: "MCA", document_codes: ["business_bank_statements"] };
    expect(validatePackageInput({ ...base, statement_months: null }, CATALOG).ok).toBe(false);
    expect(validatePackageInput({ ...base, statement_months: 5 }, CATALOG).ok).toBe(false);
    expect(validatePackageInput({ ...base, statement_months: 6 }, CATALOG)).toMatchObject({
      ok: true,
      value: { statement_months: 6 },
    });
    expect(
      validatePackageInput({ loan_type: "MCA", document_codes: ["pfs"], statement_months: 12 }, CATALOG),
    ).toMatchObject({ ok: true, value: { statement_months: null } });
  });
});
