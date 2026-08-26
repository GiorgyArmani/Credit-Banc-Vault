/**
 * Base document package per funding product.
 *
 * THE POINT. An advisor creating a file used to tick documents one at a time
 * from an eight-item list, from memory, for a product with fourteen
 * requirements. What the client got asked for depended on who filled the form
 * in. These packages make the product the input and the document list the
 * output: pick "SBA Loan" and the eleven documents an SBA file needs are
 * already selected.
 *
 * NOT A LOCK. The package is a starting selection, not a rule — the advisor can
 * add and remove before creating the client, and underwriting can request more
 * later. It removes the recall problem, not the judgement.
 *
 * THE KEYS are exactly the strings in FUNDING_OPTIONS (@/data/loan-types); the
 * product picker writes those verbatim into `proposed_loan_type`. A typo here
 * is a package that silently never applies, which is why
 * `programsWithoutPackage()` exists and why the creation form says out loud
 * when a selected product has no package.
 *
 * THE CODES are required_documents.code. Codes added by migration 20260824 are
 * used freely: the resolver drops any code the catalog doesn't yet carry, so a
 * package degrades to its available subset rather than failing.
 *
 * ORDER follows the source list for each product, because that is the order the
 * team reads them in when checking a file is complete.
 *
 * ONE DOCUMENT TYPE PER LINE ITEM, not per year. A list saying "2022, 2023, 2024
 * Business Tax Returns" is one `tax_returns` requirement holding three files —
 * the per-year split is a document group (@/lib/document-groups), not three
 * document types. Same for "P+L and Balance Sheet", which is two types
 * (`profit_loss`, `balance_sheets`) each spanning the years asked for.
 */

import { FUNDING_OPTIONS } from "./loan-types";

export interface ProgramDocumentPackage {
  /** required_documents.code values, in the order the product's list gives them. */
  codes: readonly string[];
  /**
   * Months of bank statements this product asks for. Omitted when the product
   * doesn't ask for statements at all (Personal Term Loan).
   */
  statementMonths?: number;
}

/**
 * Keyed by FUNDING_OPTIONS string. A product absent from this map has no base
 * package — see `programsWithoutPackage()`.
 */
export const PROGRAM_DOCUMENT_PACKAGES: Readonly<Record<string, ProgramDocumentPackage>> = {
  "Personal Term Loan": {
    // The only consumer-paper product here: no business documents at all.
    codes: [
      "funding_application",
      "drivers_license",
      "paystub_w2",
      "personal_tax_returns",
      "pfs",
    ],
  },

  "Term Loan": {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "tax_extension_filing",
      "profit_loss",
      "balance_sheets",
      "voided_check",
      "debt_schedule",
      "asset_equipment_list",
    ],
  },

  // SBA is the Term Loan package plus the four things an SBA lender always
  // comes back for.
  "SBA Loan": {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "tax_extension_filing",
      "profit_loss",
      "balance_sheets",
      "voided_check",
      "debt_schedule",
      "asset_equipment_list",
      "pfs",
      "ar_report",
      "ap_report",
      "business_license",
    ],
  },

  // The SBA package, plus the buyer's credentials, plus a second company's
  // paperwork — see the target_* codes in migration 20260824.
  Acquisition: {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "tax_extension_filing",
      "profit_loss",
      "balance_sheets",
      "voided_check",
      "debt_schedule",
      "asset_equipment_list",
      "pfs",
      "ar_report",
      "ap_report",
      "business_license",
      "resume",
      "business_plan",
      // Business being acquired
      "target_tax_returns",
      "target_profit_loss",
      "target_debt_schedule",
      "letter_of_intent",
      "target_asset_equipment_list",
      "target_lease_agreement",
    ],
  },

  Equipment: {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "tax_extension_filing",
      "profit_loss",
      "balance_sheets",
      "voided_check",
      "debt_schedule",
      "purchase_order",
    ],
  },

  // Fix + flip. `myscoreiq` is the FICO-scores line item — it is the credit
  // report product we already pull, so no separate document type for it.
  "Real Estate Loan": {
    codes: [
      "funding_application",
      "pfs",
      "tax_returns",
      "myscoreiq",
      "resume",
      "prior_projects",
      // Subject property
      "closing_statement",
      "scope_of_work",
      "mortgage_statement",
      "valuation_comparables",
    ],
  },

  "Project Financing": {
    statementMonths: 12,
    codes: [
      "funding_application",
      "tax_returns",
      "profit_loss",
      "balance_sheets",
      "ap_report",
      "ar_report",
      "wip_report",
      "business_bank_statements",
      "debt_schedule",
      "drivers_license",
      "job_contracts",
    ],
  },

  "Revenue Based Loan": {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "tax_extension_filing",
      "profit_loss",
      "balance_sheets",
      "voided_check",
      "debt_schedule",
    ],
  },

  "Inventory Financing": {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "profit_loss",
      "balance_sheets",
      "inventory_report",
      "inventory_order",
      "ar_report",
      "ap_report",
      "debt_schedule",
      "voided_check",
    ],
  },

  MCA: {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "profit_loss",
      "balance_sheets",
      "debt_schedule",
      "voided_check",
    ],
  },

  "E-commerce": {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "debt_schedule",
      "voided_check",
    ],
  },

  "Line of Credit": {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "tax_returns",
      "drivers_license",
      "debt_schedule",
      "voided_check",
      "pfs",
    ],
  },

  "Invoice Factoring": {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "profit_loss",
      "balance_sheets",
      "factoring_invoices",
      "ar_report",
      "ap_report",
      "debt_schedule",
      "voided_check",
    ],
  },

  // "Factor and A/R Loan" is one list in the source, and the product picker
  // carries the two names separately. Same package under both.
  Factor: {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "profit_loss",
      "balance_sheets",
      "ar_report",
      "contract_invoice_example",
      "ap_report",
      "debt_schedule",
      "voided_check",
    ],
  },

  "AR Loan": {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "profit_loss",
      "balance_sheets",
      "ar_report",
      "contract_invoice_example",
      "ap_report",
      "debt_schedule",
      "voided_check",
    ],
  },

  // Refinancing existing positions. The two things only this product asks for
  // are the paper behind the debt (`loan_agreements` — "contracts for all notes
  // to be consolidated") and the schedule that lists it.
  Consolidation: {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "profit_loss",
      "balance_sheets",
      "loan_agreements",
      "debt_schedule",
      "pfs",
      "voided_check",
    ],
  },

  "Purchase Order Financing": {
    statementMonths: 12,
    codes: [
      "funding_application",
      "business_bank_statements",
      "drivers_license",
      "tax_returns",
      "profit_loss",
      "balance_sheets",
      "ar_report",
      "purchase_order",
      "ap_report",
      "debt_schedule",
      "voided_check",
    ],
  },
};

/**
 * The list to fall back on when the selected products resolve to nothing.
 *
 * Only "Other" has no package, and a file created against "Other" alone would
 * otherwise reach the client with an EMPTY document request — a vault with
 * nothing to upload and a deal dead on arrival. These four are what every
 * business funding file opens with regardless of product; the advisor adds the
 * rest from the client's vault once they know what they are working with.
 *
 * Deliberately not merged into `packageForLoanTypes`: callers that show a
 * picker want to know the package is empty so they can say so. Only callers
 * that request documents WITHOUT a picker (the speed form) apply this.
 */
export const FALLBACK_DOCUMENT_PACKAGE: ProgramDocumentPackage = {
  statementMonths: 12,
  codes: [
    "funding_application",
    "business_bank_statements",
    "drivers_license",
    "voided_check",
  ],
};

/**
 * Products in the picker with no base package.
 *
 * Computed rather than listed so it can never drift: add a product to
 * FUNDING_OPTIONS and it shows up here until someone writes its package. The
 * creation form reads this to tell the advisor, at the moment they pick it,
 * that a product will not pre-select anything.
 *
 * As of writing: only "Other", a catch-all that by definition has no fixed
 * package. Every named product carries one.
 */
export function programsWithoutPackage(): string[] {
  return FUNDING_OPTIONS.filter((option) => !PROGRAM_DOCUMENT_PACKAGES[option]);
}

/**
 * The combined package for one or more selected products.
 *
 * Union, not intersection: a file marked both "Term Loan" and "SBA Loan" is
 * going to both kinds of lender, and asking for the smaller list guarantees a
 * second round of document chasing. First-appearance order is preserved so the
 * dominant product's list reads in its own order, with later products'
 * additions appended.
 *
 * `statementMonths` takes the largest any selected product asks for — the
 * longer period satisfies the shorter one, and asking twice does not.
 */
export function packageForLoanTypes(loanTypes: readonly string[]): {
  codes: string[];
  statementMonths: number | null;
  /** Selected products that had no package, for the form to name. */
  withoutPackage: string[];
} {
  const codes: string[] = [];
  const seen = new Set<string>();
  const withoutPackage: string[] = [];
  let statementMonths: number | null = null;

  for (const type of loanTypes) {
    const pkg = PROGRAM_DOCUMENT_PACKAGES[type];
    if (!pkg) {
      withoutPackage.push(type);
      continue;
    }
    for (const code of pkg.codes) {
      if (seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
    }
    if (typeof pkg.statementMonths === "number") {
      statementMonths = Math.max(statementMonths ?? 0, pkg.statementMonths);
    }
  }

  return { codes, statementMonths, withoutPackage };
}
