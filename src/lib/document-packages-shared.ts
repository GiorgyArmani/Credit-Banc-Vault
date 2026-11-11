// src/lib/document-packages-shared.ts
//
// The pure half of the editable loan-type document lists. Client-safe: no
// database, no secrets — imported by the browser editor and by server code.
//
// THE MODEL. Each built-in loan type has a list in
// @/data/program-document-packages. Staff (admin + underwriting) can replace
// one loan type's list; that edit is a row in loan_type_document_packages. No
// row means the built-in list. So a failed or missing table read degrades to
// exactly what the app did before the table existed.
//
// A LOAN TYPE STAFF ADDED is a row whose name is not in FUNDING_OPTIONS. The
// row is the loan type: it carries the name and the list, and deleting it
// removes the loan type from the pickers. There is no second table to keep in
// step.

import { FUNDING_OPTIONS } from "@/data/loan-types";
import {
  PROGRAM_DOCUMENT_PACKAGES,
  type ProgramDocumentPackage,
} from "@/data/program-document-packages";
import { BANK_STATEMENTS_DOC_CODE, BANK_STATEMENT_MONTH_OPTIONS } from "@/lib/document-scope";
import { LENDER_DOCUMENTATION_DOC_CODE } from "@/lib/document-groups";

export type DocumentPackageMap = Record<string, ProgramDocumentPackage>;

/** A row of loan_type_document_packages. */
export interface PackageOverrideRow {
  loan_type: string;
  document_codes: string[];
  statement_months: number | null;
  updated_by?: string | null;
  updated_at?: string | null;
}

export const LOAN_TYPE_NAME_MIN = 2;
export const LOAN_TYPE_NAME_MAX = 60;
export const DOCUMENT_LABEL_MIN = 2;
export const DOCUMENT_LABEL_MAX = 80;
export const DOCUMENT_DESCRIPTION_MAX = 300;
/** File cap for a document type that takes several files — what tax returns and bank statements use. */
export const DOCUMENT_MULTIPLE_MAX_FILES = 12;

/**
 * Documents that can never be on a request list. Lender documentation is paper
 * RECEIVED from lenders, never asked of a client.
 */
export function isRequestableDocCode(code: string): boolean {
  return code !== LENDER_DOCUMENTATION_DOC_CODE;
}

export function isBuiltInLoanType(loan_type: string): boolean {
  return FUNDING_OPTIONS.includes(loan_type);
}

/**
 * The lists in force: built-in lists with staff edits laid over them, plus the
 * loan types staff added.
 *
 * A row with no documents is ignored — an empty edit must never blank a loan
 * type's request.
 */
export function mergePackageOverrides(rows: readonly PackageOverrideRow[]): DocumentPackageMap {
  const merged: DocumentPackageMap = { ...PROGRAM_DOCUMENT_PACKAGES };

  for (const row of rows) {
    if (typeof row.loan_type !== "string" || !row.loan_type.trim()) continue;
    const codes = Array.isArray(row.document_codes)
      ? row.document_codes.filter((c) => typeof c === "string" && c)
      : [];
    if (codes.length === 0) continue;

    merged[row.loan_type] =
      codes.includes(BANK_STATEMENTS_DOC_CODE) && typeof row.statement_months === "number"
        ? { codes, statementMonths: row.statement_months }
        : { codes };
  }

  return merged;
}

/**
 * Every loan type a picker should offer: the built-in ones in their usual
 * order, with the ones staff added (A–Z) slotted in ahead of "Other", which
 * stays last because it is the catch-all.
 */
export function loanTypesFor(packages: DocumentPackageMap): string[] {
  const added = Object.keys(packages)
    .filter((t) => !isBuiltInLoanType(t))
    .sort((a, b) => a.localeCompare(b));
  if (added.length === 0) return [...FUNDING_OPTIONS];

  const built_in = [...FUNDING_OPTIONS];
  const other_at = built_in.indexOf("Other");
  if (other_at === -1) return [...built_in, ...added];
  return [...built_in.slice(0, other_at), ...added, ...built_in.slice(other_at)];
}

/**
 * Check the name of a loan type someone wants to add.
 *
 * No commas: a file's loan types are stored comma-joined in one column, so a
 * comma in a name would split it into two loan types that don't exist.
 */
export function validateLoanTypeName(
  raw: unknown,
  existing: readonly string[],
): { ok: true; value: string } | { ok: false; error: string } {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (name.length < LOAN_TYPE_NAME_MIN) {
    return { ok: false, error: "Give the loan type a name." };
  }
  if (name.length > LOAN_TYPE_NAME_MAX) {
    return { ok: false, error: `Keep the name to ${LOAN_TYPE_NAME_MAX} characters or fewer.` };
  }
  if (name.includes(",")) {
    return { ok: false, error: "A loan type name can't contain a comma." };
  }
  const taken = existing.find((t) => t.toLowerCase() === name.toLowerCase());
  if (taken) {
    return { ok: false, error: `"${taken}" is already a loan type.` };
  }
  return { ok: true, value: name };
}

/** "Franchise Agreement (signed)" → "franchise_agreement_signed". */
export function docCodeFromLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50)
    .replace(/_+$/g, "");
}

export type NewDocumentType = {
  code: string;
  label: string;
  description: string | null;
  is_multiple: boolean;
  min_files: number;
  max_files: number;
  ghl_tag: string;
};

/**
 * Check a new document type and build its catalog row. `catalog` is the
 * existing document types, to refuse a second one with the same name.
 *
 * The row follows the shape every existing type has (migration 20260824):
 * `requested_<code>` as the GHL tag, never core, at least one file.
 */
export function validateNewDocumentType(
  input: { label: unknown; description?: unknown; allow_multiple?: unknown },
  catalog: readonly { code: string; label: string }[],
): { ok: true; value: NewDocumentType } | { ok: false; error: string } {
  const label = typeof input.label === "string" ? input.label.replace(/\s+/g, " ").trim() : "";
  if (label.length < DOCUMENT_LABEL_MIN) {
    return { ok: false, error: "Give the document a name." };
  }
  if (label.length > DOCUMENT_LABEL_MAX) {
    return { ok: false, error: `Keep the name to ${DOCUMENT_LABEL_MAX} characters or fewer.` };
  }

  const code = docCodeFromLabel(label);
  if (code.length < 2 || !/^[a-z]/.test(code)) {
    return { ok: false, error: "The name needs to start with a letter and contain at least two letters or numbers." };
  }
  const clash = catalog.find(
    (d) => d.code === code || d.label.trim().toLowerCase() === label.toLowerCase(),
  );
  if (clash) {
    return { ok: false, error: `"${clash.label}" is already in the document catalog — add that one instead.` };
  }

  const description =
    typeof input.description === "string" ? input.description.replace(/\s+/g, " ").trim() : "";
  if (description.length > DOCUMENT_DESCRIPTION_MAX) {
    return { ok: false, error: `Keep the instructions to ${DOCUMENT_DESCRIPTION_MAX} characters or fewer.` };
  }

  const is_multiple = input.allow_multiple === true;
  return {
    ok: true,
    value: {
      code,
      label,
      description: description || null,
      is_multiple,
      min_files: 1,
      max_files: is_multiple ? DOCUMENT_MULTIPLE_MAX_FILES : 1,
      ghl_tag: `requested_${code}`,
    },
  };
}

export type PackageInput = {
  loan_type: unknown;
  document_codes: unknown;
  statement_months: unknown;
};

export type ValidatedPackage = {
  loan_type: string;
  document_codes: string[];
  statement_months: number | null;
};

/**
 * Check an edit before it is saved.
 *
 * `catalogCodes` is every required_documents.code — a code outside it would be
 * dropped silently when a file is created, so it is refused here instead.
 * `loanTypes` is every loan type that exists right now (built-in + added).
 */
export function validatePackageInput(
  input: PackageInput,
  catalogCodes: ReadonlySet<string>,
  loanTypes: readonly string[] = FUNDING_OPTIONS,
): { ok: true; value: ValidatedPackage } | { ok: false; error: string } {
  const loan_type = typeof input.loan_type === "string" ? input.loan_type : "";
  if (!loanTypes.includes(loan_type)) {
    return { ok: false, error: "That loan type isn't in the list." };
  }

  if (!Array.isArray(input.document_codes)) {
    return { ok: false, error: "The document list is missing." };
  }
  const document_codes: string[] = [];
  for (const raw of input.document_codes) {
    const code = typeof raw === "string" ? raw.trim() : "";
    if (code && !document_codes.includes(code)) document_codes.push(code);
  }
  if (document_codes.length === 0) {
    return {
      ok: false,
      error: isBuiltInLoanType(loan_type)
        ? "A loan type needs at least one document. To undo your edits, restore the original list."
        : "A loan type needs at least one document. To remove it altogether, delete the loan type.",
    };
  }

  const unknown = document_codes.filter((c) => !catalogCodes.has(c) || !isRequestableDocCode(c));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `These can't be requested: ${unknown.join(", ")}. Remove them and save again.`,
    };
  }

  let statement_months: number | null = null;
  if (document_codes.includes(BANK_STATEMENTS_DOC_CODE)) {
    const months = Number(input.statement_months);
    if (!(BANK_STATEMENT_MONTH_OPTIONS as readonly number[]).includes(months)) {
      return {
        ok: false,
        error: `Choose how many months of bank statements to request (${BANK_STATEMENT_MONTH_OPTIONS.join(", ")}).`,
      };
    }
    statement_months = months;
  }

  return { ok: true, value: { loan_type, document_codes, statement_months } };
}
