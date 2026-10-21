// src/lib/lender-api/providers/yes-leasing/mapping.ts
//
// Pure. Kaaj takes FILES ONLY and reads the deal out of them, so there is no
// payload to map, no dropdown and no field gap. What is left: the document
// labels UW sees, the encrypted-PDF check, and reading our stored status.

import type { BuiltApplication, LenderApiSource, NormalizedStatus, PickDefinition, Picks } from "../../types";
import type { VaultField } from "../../vault-fields";
import { nonEmpty } from "../../normalize";
import {
  YES_LEASING_APPLICATION_DOC_CODES,
  YES_LEASING_BANK_STATEMENT_DOC_CODES,
  YES_LEASING_DELIVERED_STATUS,
  YES_LEASING_INVOICE_DOC_CODES,
} from "./constants";

export interface YesLeasingSubmission {
  /** Ours only — Kaaj has no reference field. Kept on the submission row. */
  referenceId: string;
}

export const YES_LEASING_PICKS: readonly PickDefinition[] = [];
export const YES_LEASING_REQUIRED_VAULT_FIELDS: readonly VaultField[] = [];

export function suggestYesLeasingPicks(): Record<string, string | null> {
  return {};
}

export function buildYesLeasingApplication(_source: LenderApiSource, _picks: Picks, ctx: { referenceId: string }): BuiltApplication {
  const payload: YesLeasingSubmission = { referenceId: ctx.referenceId };
  return { payload, redacted: payload, gaps: [], effectivePicks: {} };
}

/** Labels for the documents YES Leasing usually asks for; Kaaj classifies files itself. */
export function yesLeasingTagsForDocCode(docCode: string | null): string[] {
  if (!docCode) return [];
  if (YES_LEASING_APPLICATION_DOC_CODES.includes(docCode)) return ["Application"];
  if (YES_LEASING_INVOICE_DOC_CODES.includes(docCode)) return ["Invoice"];
  if (YES_LEASING_BANK_STATEMENT_DOC_CODES.includes(docCode)) return ["Bank statements (last 3 months)"];
  return [];
}

/**
 * Kaaj can't read password-protected files. A PDF is encrypted when its
 * trailer carries an /Encrypt entry; checking the raw bytes for it is enough
 * (it is never inside a compressed stream).
 */
export function isEncryptedPdf(filename: string, bytes: Buffer): boolean {
  const isPdf = /\.pdf$/i.test(filename.trim()) || bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  return isPdf && bytes.includes("/Encrypt");
}

export interface YesLeasingStatus {
  status?: string;
  uploadId?: number | null;
  fileCount?: number | null;
}

/**
 * Kaaj never reports a decision: YES Leasing tells us directly and UW records
 * it by hand. All we ever hold is "the package reached them".
 */
export function interpretYesLeasingStatus(raw: unknown): NormalizedStatus {
  const status = nonEmpty((raw as YesLeasingStatus | null)?.status)?.toLowerCase() ?? YES_LEASING_DELIVERED_STATUS;
  if (status === YES_LEASING_DELIVERED_STATUS) return { kind: "in_progress", stage: "Delivered to YES Leasing" };
  return { kind: "in_progress", stage: status };
}
