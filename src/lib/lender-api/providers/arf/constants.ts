// src/lib/lender-api/providers/arf/constants.ts
//
// ARF takes deals through the Dragin Partner API ("Submitting deals and
// additional documents — integration guide for ISO partners").

/** Must equal the lender_guidelines.lender_name UW assigns. */
export const ARF_LENDER_NAME = "ARF";
export const ARF_DISPLAY_NAME = "ARF";

/** Dragin reads the whole deal from this document — a packet without it has nothing to extract. */
export const ARF_APPLICATION_DOC_CODES: readonly string[] = ["funding_application", "signed_application"];

/** GET /jobs/{jobId} while it answers 202. */
export const ARF_WORKING_STATUSES: readonly string[] = ["queued", "processing", "awaiting_callback"];
/** GET /jobs/{jobId} on 200: the deal was delivered to the funder. */
export const ARF_DELIVERED_STATUS = "submitted";
/** Ours, not theirs: what we store when GET /jobs/{jobId} answers 500. */
export const ARF_FAILED_STATUS = "failed";

/**
 * Guide §8: the extension must be one of these AND match the contents. One
 * file outside the list (Office, CSV, HEIC, zip…) fails the WHOLE request with
 * 415, so we never send one.
 */
export const ARF_ALLOWED_EXTENSIONS: readonly string[] = ["pdf", "jpg", "jpeg", "png", "tif", "tiff", "gif", "bmp"];
/** Guide §8 limits, per request on both POST endpoints. Over any of them = 413 for the whole request. */
export const ARF_MAX_FILES = 30;
export const ARF_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ARF_MAX_REQUEST_BYTES = 150 * 1024 * 1024;

