"use client";

/**
 * useDocumentPackages — the loan types on offer and the document list each one
 * requests, for the surfaces that pick a loan type or turn a selection into a
 * document request.
 *
 * Starts on the built-in loan types and lists, and swaps to the staff-edited
 * ones (Loan Types page) as soon as the fetch lands — well before anyone has
 * picked a product. A failed fetch is logged and leaves the built-in ones in
 * place: creating a file must never wait on, or break over, this read.
 */

import { useEffect, useMemo, useState } from "react";
import { PROGRAM_DOCUMENT_PACKAGES } from "@/data/program-document-packages";
import { loanTypesFor, type DocumentPackageMap } from "@/lib/document-packages-shared";

export function useDocumentPackages(): {
  /** Keyed by loan type; pass to packageForLoanTypes. */
  packages: DocumentPackageMap;
  /** Every loan type a picker should offer, in display order. */
  loanTypes: string[];
} {
  const [packages, setPackages] = useState<DocumentPackageMap>(PROGRAM_DOCUMENT_PACKAGES);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/document-packages")
      .then((res) => {
        if (!res.ok) throw new Error(`document packages fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data?.packages && typeof data.packages === "object") {
          setPackages(data.packages as DocumentPackageMap);
        }
      })
      .catch((err) => console.error("useDocumentPackages failed, using the built-in lists:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const loanTypes = useMemo(() => loanTypesFor(packages), [packages]);
  return { packages, loanTypes };
}
