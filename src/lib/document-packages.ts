// src/lib/document-packages.ts
//
// Server-only read of the loan-type document lists in force: the built-in
// lists (@/data/program-document-packages) with staff edits laid over them.
//
// The table is RLS-locked with zero policies, so the read goes through the
// service role. Nothing here is sensitive — it is a list of document types per
// loan type — but callers that expose it still check the viewer is staff.

import { createAdminClient } from "@/lib/supabase/admin";
import { PROGRAM_DOCUMENT_PACKAGES } from "@/data/program-document-packages";
import {
  mergePackageOverrides,
  type DocumentPackageMap,
  type PackageOverrideRow,
} from "@/lib/document-packages-shared";

export type DocumentPackagesResult = {
  /** Keyed by loan type. Always usable — falls back to the built-in lists. */
  packages: DocumentPackageMap;
  /** The saved edits, for the editor to show who changed what. */
  overrides: PackageOverrideRow[];
  /** The edits couldn't be read; `packages` is the built-in lists only. */
  degraded: boolean;
};

export async function loadDocumentPackages(): Promise<DocumentPackagesResult> {
  try {
    const { data, error } = await createAdminClient()
      .from("loan_type_document_packages")
      .select("loan_type, document_codes, statement_months, updated_by, updated_at");

    if (error || !data) {
      console.error("[document-packages] read failed, using the built-in lists:", error);
      return { packages: { ...PROGRAM_DOCUMENT_PACKAGES }, overrides: [], degraded: true };
    }

    const overrides = data as PackageOverrideRow[];
    return { packages: mergePackageOverrides(overrides), overrides, degraded: false };
  } catch (err) {
    console.error("[document-packages] read threw, using the built-in lists:", err);
    return { packages: { ...PROGRAM_DOCUMENT_PACKAGES }, overrides: [], degraded: true };
  }
}
