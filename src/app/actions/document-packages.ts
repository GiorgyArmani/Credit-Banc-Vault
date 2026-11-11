// src/app/actions/document-packages.ts
"use server";

// Everything the Loan Types page writes: a loan type's document list, a new
// loan type, a new document type. Admin and underwriting only; the tables are
// written with the service role, so the role check here is the gate.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FALLBACK_DOCUMENT_PACKAGE } from "@/data/program-document-packages";
import { BANK_STATEMENTS_DOC_CODE, DEFAULT_BANK_STATEMENT_MONTHS } from "@/lib/document-scope";
import {
  LOAN_TYPE_NAME_MAX,
  loanTypesFor,
  mergePackageOverrides,
  validateLoanTypeName,
  validateNewDocumentType,
  validatePackageInput,
  type PackageInput,
  type PackageOverrideRow,
} from "@/lib/document-packages-shared";

type ActionResult = { success: boolean; error?: string };

const NOT_ALLOWED = "Only admins and underwriting can change these lists.";

async function requireEditor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return me?.role === "admin" || me?.role === "underwriting" ? user : null;
}

function revalidate() {
  revalidatePath("/underwriting/loan-types");
  revalidatePath("/admin/uw/loan-types");
}

type Db = ReturnType<typeof createAdminClient>;

/** The document catalog, or null when it can't be read. */
async function readCatalog(db: Db): Promise<{ code: string; label: string }[] | null> {
  const { data, error } = await db.from("required_documents").select("code, label");
  if (error || !data) {
    console.error("document-packages: catalog read failed:", error);
    return null;
  }
  return data as { code: string; label: string }[];
}

/** Every loan type that exists right now (built-in + added), or null on a failed read. */
async function readLoanTypes(db: Db): Promise<string[] | null> {
  const { data, error } = await db
    .from("loan_type_document_packages")
    .select("loan_type, document_codes, statement_months");
  if (error || !data) {
    console.error("document-packages: loan type read failed:", error);
    return null;
  }
  return loanTypesFor(mergePackageOverrides(data as PackageOverrideRow[]));
}

export async function saveDocumentPackage(input: PackageInput): Promise<ActionResult> {
  const user = await requireEditor();
  if (!user) return { success: false, error: NOT_ALLOWED };

  const db = createAdminClient();
  const [catalog, loan_types] = await Promise.all([readCatalog(db), readLoanTypes(db)]);
  if (!catalog) return { success: false, error: "Couldn't check the document catalog — try again." };
  if (!loan_types) return { success: false, error: "Couldn't load the loan types — try again." };

  const checked = validatePackageInput(input, new Set(catalog.map((d) => d.code)), loan_types);
  if (!checked.ok) return { success: false, error: checked.error };

  const { error } = await db.from("loan_type_document_packages").upsert(
    { ...checked.value, updated_by: user.id, updated_at: new Date().toISOString() },
    { onConflict: "loan_type" },
  );
  if (error) {
    console.error("saveDocumentPackage: upsert failed:", error);
    return { success: false, error: `Couldn't save the list: ${error.message}` };
  }

  revalidate();
  return { success: true };
}

/**
 * Drop a loan type's saved row. For a built-in loan type that restores its
 * original list; for one staff added, the row IS the loan type, so this
 * deletes it from the pickers. Files already created keep what they have.
 */
export async function removeDocumentPackage(loan_type: string): Promise<ActionResult> {
  if (!(await requireEditor())) return { success: false, error: NOT_ALLOWED };
  if (typeof loan_type !== "string" || !loan_type || loan_type.length > LOAN_TYPE_NAME_MAX) {
    return { success: false, error: "That loan type isn't in the list." };
  }

  const { error } = await createAdminClient()
    .from("loan_type_document_packages")
    .delete()
    .eq("loan_type", loan_type);
  if (error) {
    console.error("removeDocumentPackage: delete failed:", error);
    return { success: false, error: `Couldn't remove it: ${error.message}` };
  }

  revalidate();
  return { success: true };
}

/**
 * Add a loan type. It opens with the baseline documents every file starts
 * with, which the editor then changes like any other list.
 */
export async function createLoanType(
  raw_name: string,
): Promise<ActionResult & { loan_type?: string }> {
  const user = await requireEditor();
  if (!user) return { success: false, error: NOT_ALLOWED };

  const db = createAdminClient();
  const [catalog, loan_types] = await Promise.all([readCatalog(db), readLoanTypes(db)]);
  if (!catalog) return { success: false, error: "Couldn't check the document catalog — try again." };
  if (!loan_types) return { success: false, error: "Couldn't load the loan types — try again." };

  const name = validateLoanTypeName(raw_name, loan_types);
  if (!name.ok) return { success: false, error: name.error };

  const in_catalog = new Set(catalog.map((d) => d.code));
  const document_codes = FALLBACK_DOCUMENT_PACKAGE.codes.filter((c) => in_catalog.has(c));
  if (document_codes.length === 0) {
    return { success: false, error: "The starting documents are missing from the catalog — nothing to open the list with." };
  }

  // insert, not upsert: two people adding the same name must not overwrite each other.
  const { error } = await db.from("loan_type_document_packages").insert({
    loan_type: name.value,
    document_codes,
    statement_months: document_codes.includes(BANK_STATEMENTS_DOC_CODE)
      ? (FALLBACK_DOCUMENT_PACKAGE.statementMonths ?? DEFAULT_BANK_STATEMENT_MONTHS)
      : null,
    updated_by: user.id,
  });
  if (error) {
    console.error("createLoanType: insert failed:", error);
    return {
      success: false,
      error: error.code === "23505" ? `"${name.value}" is already a loan type.` : `Couldn't add the loan type: ${error.message}`,
    };
  }

  revalidate();
  return { success: true, loan_type: name.value };
}

/**
 * Add a document type to the catalog. It becomes requestable everywhere a
 * document can be requested, not only on this page.
 */
export async function createDocumentType(input: {
  label: string;
  description?: string;
  allow_multiple?: boolean;
}): Promise<ActionResult & { document?: { code: string; label: string } }> {
  if (!(await requireEditor())) return { success: false, error: NOT_ALLOWED };

  const db = createAdminClient();
  const catalog = await readCatalog(db);
  if (!catalog) return { success: false, error: "Couldn't check the document catalog — try again." };

  const checked = validateNewDocumentType(input, catalog);
  if (!checked.ok) return { success: false, error: checked.error };

  const { error } = await db.from("required_documents").insert({ ...checked.value, is_core: false });
  if (error) {
    console.error("createDocumentType: insert failed:", error);
    return {
      success: false,
      error:
        error.code === "23505"
          ? "A document with that name already exists — refresh the page and add that one."
          : `Couldn't add the document: ${error.message}`,
    };
  }

  revalidate();
  return { success: true, document: { code: checked.value.code, label: checked.value.label } };
}
