// src/lib/lender-api/providers/yes-leasing/constants.ts
//
// YES Leasing takes deals through the Kaaj Partner API:
// POST /partner-portal/ingest (spec: https://docs.kaaj.ai/api/openapi.json).

/** Must match the lender_guidelines.lender_name UW assigns ("YES Leasing"). */
export const YES_LEASING_DISPLAY_NAME = "YES Leasing";

/** Kaaj's own name for the lender, sent as `lender_name` (from Kaaj, 2026-10-21). */
export const YES_LEASING_KAAJ_LENDER_NAME = "yesleasing";

/** What YES Leasing usually needs (Kaaj, 2026-10-21): application, invoice, last 3 months of bank statements. */
export const YES_LEASING_APPLICATION_DOC_CODES: readonly string[] = ["funding_application", "signed_application"];
export const YES_LEASING_INVOICE_DOC_CODES: readonly string[] = ["equipment_invoice", "contract_invoice_example"];
export const YES_LEASING_BANK_STATEMENT_DOC_CODES: readonly string[] = ["business_bank_statements"];

/** Kaaj limit, per file. */
export const YES_LEASING_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Ours, not Kaaj's: what we store once Kaaj accepted the package. */
export const YES_LEASING_DELIVERED_STATUS = "delivered";
