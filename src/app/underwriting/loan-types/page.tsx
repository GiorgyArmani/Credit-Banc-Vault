// src/app/underwriting/loan-types/page.tsx
//
// The documents requested for each loan type — viewable and editable by
// underwriting and admins, who can also add loan types and document types.
// Re-exported at /admin/uw/loan-types.
//
// Each built-in loan type has a list (@/data/program-document-packages); an
// edit made here replaces it for that loan type and applies to every file
// created afterwards. See @/lib/document-packages-shared for the model.

import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  FALLBACK_DOCUMENT_PACKAGE,
  PROGRAM_DOCUMENT_PACKAGES,
} from "@/data/program-document-packages";
import { loadDocumentPackages } from "@/lib/document-packages";
import {
  isBuiltInLoanType,
  isRequestableDocCode,
  loanTypesFor,
} from "@/lib/document-packages-shared";
import {
  LoanTypeDocumentsManager,
  type CatalogDoc,
  type LoanTypeEntry,
} from "./_components/loan-type-documents-manager";

export const dynamic = "force-dynamic";

export default async function LoanTypesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin" && me?.role !== "underwriting") redirect("/dashboard");

  const db = createAdminClient();
  const [{ packages, overrides, degraded }, catalog_result] = await Promise.all([
    loadDocumentPackages(),
    db.from("required_documents").select("code, label").order("label", { ascending: true }),
  ]);

  if (catalog_result.error) {
    console.error("loan-types: document catalog read failed:", catalog_result.error);
  }
  const catalog = ((catalog_result.data ?? []) as CatalogDoc[]).filter((d) =>
    isRequestableDocCode(d.code),
  );

  // Who made each edit, for the "Edited by" line.
  const editor_ids = [...new Set(overrides.map((o) => o.updated_by).filter((id): id is string => !!id))];
  const editor_names = new Map<string, string>();
  if (editor_ids.length > 0) {
    const { data: editors } = await db
      .from("users")
      .select("id, first_name, last_name")
      .in("id", editor_ids);
    for (const e of editors ?? []) {
      const name = `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim();
      if (name) editor_names.set(e.id, name);
    }
  }
  const override_by_type = new Map(overrides.map((o) => [o.loan_type, o]));

  const entries: LoanTypeEntry[] = loanTypesFor(packages).map((loan_type) => {
    const pkg = packages[loan_type];
    const override = override_by_type.get(loan_type);
    // Only a row that actually took effect counts as an edit.
    const edited = override && override.document_codes?.length > 0 ? override : null;
    return {
      loan_type,
      codes: pkg ? [...pkg.codes] : [],
      statement_months: pkg?.statementMonths ?? null,
      added: !isBuiltInLoanType(loan_type),
      built_in_count: PROGRAM_DOCUMENT_PACKAGES[loan_type]?.codes.length ?? 0,
      edited: edited
        ? {
            // Formatted here so server and browser render the same text.
            on: edited.updated_at
              ? new Date(edited.updated_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : null,
            by: edited.updated_by ? (editor_names.get(edited.updated_by) ?? null) : null,
          }
        : null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cb-navy text-cb-mint">
          <ListChecks className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-headline text-2xl font-extrabold tracking-tight">Loan Types</h1>
          <p className="text-sm text-cb-gray">
            The documents a new file is asked for, by loan type. A file with two loan types is
            asked for both lists combined. You can add loan types and document types here too.
          </p>
        </div>
      </div>

      {degraded && (
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Couldn&apos;t load saved edits, so these are the built-in lists and saving won&apos;t
          work. Refresh the page — if it keeps happening, the database update for this page
          hasn&apos;t been applied yet.
        </p>
      )}
      {catalog_result.error && (
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Couldn&apos;t load the document catalog, so document names are missing and nothing can
          be added. Refresh the page.
        </p>
      )}

      <LoanTypeDocumentsManager
        entries={entries}
        catalog={catalog}
        baseline_codes={[...FALLBACK_DOCUMENT_PACKAGE.codes]}
      />
    </div>
  );
}
