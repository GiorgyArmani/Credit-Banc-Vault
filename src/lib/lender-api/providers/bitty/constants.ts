// src/lib/lender-api/providers/bitty/constants.ts
//
// Copied from "Bitty – Portal Submission API" v4.0. One endpoint, no status
// API, no document endpoint: files ride inside the submission and the verdict
// comes back in the same response.

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const BITTY_LENDER_NAME = "Bitty";

/** Development by default — production only when BITTY_API_BASE is set explicitly. */
export const BITTY_DEV_API_BASE = "https://dev.bittyadvance.com";
export const BITTY_PROD_API_BASE = "https://broker.bittyadvance.com";
export const BITTY_SUBMIT_PATH = "/api/submit";

/** "Submit up to 20 files." */
export const BITTY_MAX_FILES = 20;

/** "Accepted file types. JPG, CSV, TIFF, TXT, DOC, DOCX, JPEG, PNG, PDF." */
export const BITTY_FILE_EXTENSIONS: readonly string[] = [
  "jpg", "jpeg", "png", "tiff", "tif", "pdf", "csv", "txt", "doc", "docx",
];

/** files[].type — 1 Application, 2 Bank Statement, 3 Driver's License, 4 Voided Check. */
export const BITTY_FILE_TYPES: Array<{ type: number; tag: string; docCodes: readonly string[] }> = [
  { type: 1, tag: "Application", docCodes: ["funding_application", "signed_application"] },
  { type: 2, tag: "Bank Statement", docCodes: ["business_bank_statements"] },
  { type: 3, tag: "Driver's License", docCodes: ["drivers_license", "drivers_license_front", "drivers_license_back"] },
  { type: 4, tag: "Voided Check", docCodes: ["voided_check"] },
];

export const BITTY_YES_NO = ["No", "Yes"] as const;

/** advance_current: "Current advance count (0, 1, 2, or 3+)". "3+" is sent as 3. */
export const BITTY_ADVANCE_COUNTS = ["0", "1", "2", "3+"] as const;

/** recent_negative_days is an integer; a month has at most 31 days. */
export const BITTY_NEGATIVE_DAY_OPTIONS: readonly string[] = Array.from({ length: 32 }, (_, i) => String(i));

/** advance_freqN: 1 Daily, 2 Weekly. Nothing else is accepted. */
export const BITTY_ADVANCE_FREQ: Record<string, 1 | 2> = { Daily: 1, Weekly: 2 };

/** Response `message` values. "Approved" is the ONLY successful outcome. */
export const BITTY_MESSAGES = {
  approved: "approved",
  declined: "declined",
  duplicate: "duplicate",
  duplicateRequest: "duplicate request",
  error: "error",
} as const;
