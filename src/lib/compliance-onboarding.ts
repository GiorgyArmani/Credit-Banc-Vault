// src/lib/compliance-onboarding.ts
//
// The ONE implementation of "sign a W-9, upload a voided check" — shared by
//
//   referral_partners  — partner_advisor deal desk (migration 20260825)
//   advisors           — internal advisors invited via /admin/team (migration
//                        20260903_advisor_compliance_onboarding)
//
// Both tables carry the same eight columns under the same names, so every
// operation here is keyed by `subject.table` and nothing else differs but the
// storage prefix. The role-specific modules (partner-onboarding.ts,
// advisor-onboarding.ts) own the parts that genuinely differ: how the row is
// found for a login, what "finished" requires (the partner also owes a phone
// number), and what opens when it is.
//
// EVERYTHING HERE IS SERVICE-ROLE. Callers resolve the subject from the
// SESSION before handing it in; an id is never accepted from the client.
//
// SignWell timing, learned the hard way ([[partner_advisor_onboarding]]):
// SignWell flips a document to "Completed" a few seconds BEFORE the signed PDF
// is downloadable. The browser's `completed` event and the webhook both land
// in that window, so the PDF fetch retries, and the signature is recorded
// independently of whether our copy arrived.

import { createAdminClient } from "@/lib/supabase/admin";
import { signWell } from "@/lib/signwell";

/**
 * The PRIVATE bucket, deliberately not `user-documents`.
 *
 * A W-9 carries an SSN or EIN and a voided check carries a routing and account
 * number, so neither may live anywhere readable without auth. Reads go through
 * short-lived signed URLs minted below.
 */
export const COMPLIANCE_DOC_BUCKET = "vault";
/** Long enough to open and read, short enough that a copied URL is worthless. */
export const COMPLIANCE_DOC_TTL_SECONDS = 60 * 10;

/** What the voided-check step will accept. Deliberately narrow. */
export const VOIDED_CHECK_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
];
export const VOIDED_CHECK_MAX_BYTES = 15 * 1024 * 1024; // 15MB

export type ComplianceTable = "referral_partners" | "advisors";

/** Storage folder per table, under the vault bucket. */
export const COMPLIANCE_DOC_PREFIX: Record<ComplianceTable, string> = {
  referral_partners: "partner-onboarding",
  advisors: "advisor-onboarding",
};

/** The compliance columns, identical on both tables. */
export const COMPLIANCE_COLUMNS =
  "w9_document_id, w9_contract_url, w9_signed_at, w9_file_path, voided_check_path, voided_check_filename, voided_check_uploaded_at, onboarding_completed_at";

export interface ComplianceFields {
  w9_document_id: string | null;
  w9_contract_url: string | null;
  w9_signed_at: string | null;
  /** Our copy of the signed W-9 in the private bucket; null until SignWell's PDF lands. */
  w9_file_path: string | null;
  voided_check_path: string | null;
  voided_check_filename: string | null;
  voided_check_uploaded_at: string | null;
  onboarding_completed_at: string | null;
}

/** What every operation needs to know about the row it is acting on. */
export interface ComplianceSubject extends ComplianceFields {
  table: ComplianceTable;
  id: string;
  /** Display name for the SignWell recipient and the admin's file title. */
  name: string;
  email: string | null;
}

function now() {
  return new Date().toISOString();
}

/**
 * Create (or resume) the subject's W-9 in SignWell.
 *
 * Resuming matters: `w9_document_id` is the idempotency key, so someone who
 * reloads mid-signing lands back on the SAME document. Without it every reload
 * would mint another envelope, leaving orphans in the SignWell account and a
 * signed copy of whichever one they happened to finish.
 *
 * NOTHING IS PREFILLED, on purpose. The template's fields come back from the
 * API as bare positional ids (`TextField_1`… `CheckBox_8`) with empty labels —
 * there is no way to know which box is the TIN and which is the entity
 * classification without guessing at coordinates on a tax form. A wrong TIN or
 * a wrong entity checkbox on a W-9 is worse than an empty one.
 */
export async function ensureW9Document(
  subject: ComplianceSubject
): Promise<{ url: string } | { error: string }> {
  if (subject.w9_contract_url) return { url: subject.w9_contract_url };

  const templateId = process.env.SIGNWELL_W9_TEMPLATE_ID;
  if (!templateId) {
    console.error("[compliance-onboarding] SIGNWELL_W9_TEMPLATE_ID is not set");
    return { error: "W-9 signing isn't configured yet. Contact support." };
  }

  const email = (subject.email || "").trim().toLowerCase();
  if (!email) return { error: "There is no email address on this account." };

  try {
    const { signingUrl, embeddedSigningUrl, documentId } = await signWell.createDocument({
      templateId,
      recipientEmail: email,
      recipientName: subject.name,
      fields: {},
    });

    // Same `?doc_id=` convention as the client contract URL — it is what lets
    // the browser hand the document id back on completion without a round trip.
    const base = embeddedSigningUrl || signingUrl;
    const url = `${base}${base.includes("?") ? "&" : "?"}doc_id=${documentId}`;

    const db = createAdminClient();
    const { error } = await db
      .from(subject.table)
      .update({ w9_document_id: documentId, w9_contract_url: url, updated_at: now() })
      .eq("id", subject.id);

    if (error) {
      // The document exists in SignWell either way. Returning the URL lets them
      // sign now; the miss is that a reload mints a second envelope.
      console.error(`[compliance-onboarding] could not persist W-9 url on ${subject.table}:`, error);
    }

    return { url };
  } catch (err) {
    console.error("[compliance-onboarding] SignWell W-9 creation failed:", err);
    return { error: "Could not open the W-9 for signing. Try again in a moment." };
  }
}

/**
 * Download the signed W-9 from SignWell into the private bucket and record the
 * path. Idempotent: a no-op once `w9_file_path` is set, and the row update is
 * guarded so two callers racing (webhook + page load) leave exactly one path.
 *
 * `attempts` > 1 waits out SignWell's PDF render. Page loads pass 1 so a slow
 * SignWell never stalls a render; the webhook passes several.
 */
export async function storeW9Pdf(
  subject: Pick<ComplianceSubject, "table" | "id" | "w9_document_id" | "w9_file_path">,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<{ stored: boolean; path: string | null; error?: string }> {
  if (subject.w9_file_path) return { stored: true, path: subject.w9_file_path };
  if (!subject.w9_document_id) {
    return { stored: false, path: null, error: "No W-9 document on file." };
  }

  const attempts = Math.max(1, opts.attempts ?? 1);
  const delayMs = opts.delayMs ?? 3000;

  let blob: Blob | undefined;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      ({ blob } = await signWell.getCompletedPDF({
        documentId: subject.w9_document_id,
        urlOnly: false,
      }));
      if (blob) break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!blob) {
    console.error(
      `[compliance-onboarding] W-9 PDF not available after ${attempts} attempt(s):`,
      lastError
    );
    return { stored: false, path: null, error: "SignWell has not rendered the PDF yet." };
  }

  const db = createAdminClient();
  const path = `${COMPLIANCE_DOC_PREFIX[subject.table]}/${subject.id}/w9_${Date.now()}.pdf`;
  const { error: uploadErr } = await db.storage
    .from(COMPLIANCE_DOC_BUCKET)
    .upload(path, await blob.arrayBuffer(), { contentType: "application/pdf", upsert: true });
  if (uploadErr) {
    console.error("[compliance-onboarding] W-9 PDF upload failed:", uploadErr);
    return { stored: false, path: null, error: uploadErr.message };
  }

  // `.is("w9_file_path", null)` is the race guard: the second writer's update
  // matches zero rows and the first path wins.
  const { error } = await db
    .from(subject.table)
    .update({ w9_file_path: path, updated_at: now() })
    .eq("id", subject.id)
    .is("w9_file_path", null);
  if (error) {
    console.error("[compliance-onboarding] could not record w9_file_path:", error);
    return { stored: false, path: null, error: error.message };
  }

  return { stored: true, path };
}

async function readSignWellStatus(documentId: string): Promise<string | undefined | null> {
  try {
    const doc = await signWell.getDocument(documentId);
    return doc?.status as string | undefined;
  } catch (err) {
    console.error("[compliance-onboarding] SignWell status check failed:", err);
    return null;
  }
}

/** Stamp the signature once. Guarded so a replay or a race never re-stamps. */
async function stampSigned(subject: Pick<ComplianceSubject, "table" | "id">): Promise<string | null> {
  const db = createAdminClient();
  const { error } = await db
    .from(subject.table)
    .update({ w9_signed_at: now(), updated_at: now() })
    .eq("id", subject.id)
    .is("w9_signed_at", null);
  if (error) {
    console.error(`[compliance-onboarding] could not stamp w9_signed_at on ${subject.table}:`, error);
    return error.message;
  }
  return null;
}

/**
 * Ask SignWell whether the W-9 is signed, and record it if so.
 *
 * Called on every load of an onboarding screen and again when the embed fires
 * `completed`. The SignWell `document_completed` webhook
 * (/api/webhooks/signwell) normally gets there first; this is the backstop for
 * a delayed or dropped delivery, and it also picks up the PDF for a signature
 * that was recorded while SignWell's copy was still rendering.
 *
 * Storing the PDF is best-effort here. SignWell holds the original regardless,
 * and blocking someone from their portal because our copy failed to download
 * helps nobody — the signature is what the gate is about.
 */
export async function syncW9(
  subject: ComplianceSubject
): Promise<{ signed: boolean; error?: string }> {
  if (subject.w9_signed_at) {
    if (!subject.w9_file_path && subject.w9_document_id) await storeW9Pdf(subject);
    return { signed: true };
  }
  if (!subject.w9_document_id) return { signed: false };

  const status = await readSignWellStatus(subject.w9_document_id);
  if (status === null) {
    return { signed: false, error: "Could not reach SignWell. Try again in a moment." };
  }
  // SignWell reports the DOCUMENT status title-cased ("Completed") while the
  // per-recipient status is lower-case. Compare case-insensitively or a signed
  // W-9 polls forever.
  if (status?.toLowerCase() !== "completed") return { signed: false };

  const stampErr = await stampSigned(subject);
  if (stampErr) return { signed: false, error: "Signed, but we couldn't record it. Try again." };

  await storeW9Pdf(subject);
  return { signed: true };
}

export type W9CompletionResult =
  | { outcome: "not_tracked" }
  | { outcome: "not_completed"; table: ComplianceTable; subjectId: string; status?: string }
  | { outcome: "recorded"; table: ComplianceTable; subjectId: string; stored: boolean; error?: string }
  | { outcome: "error"; table?: ComplianceTable; subjectId?: string; error: string };

/**
 * Webhook entry point: SignWell says `documentId` is completed.
 *
 * Looks the document up on BOTH tables. The event hash only covers
 * `type@time`, not the body, so nothing in the payload is trusted beyond the
 * document id: the status is re-read from SignWell's own API before anything
 * is written, which also makes a replayed delivery harmless — every write is
 * guarded to run once.
 *
 * Anything the account sends that isn't one of our W-9s (client contracts,
 * templates) comes back `not_tracked` so the route can 200 it.
 */
export async function recordW9Completed(documentId: string): Promise<W9CompletionResult> {
  const db = createAdminClient();

  let subject: ComplianceSubject | null = null;
  for (const table of ["referral_partners", "advisors"] as const) {
    const nameCols = table === "advisors" ? "first_name, last_name" : "name";
    const { data, error } = await db
      .from(table)
      .select(`id, email, ${nameCols}, ${COMPLIANCE_COLUMNS}`)
      .eq("w9_document_id", documentId)
      .maybeSingle();
    if (error) {
      // An unapplied advisors migration lands here (42703). Log and keep
      // looking rather than failing the whole delivery.
      console.error(`[compliance-onboarding] lookup on ${table} failed:`, error.message);
      continue;
    }
    if (data) {
      const row = data as unknown as Record<string, unknown>;
      subject = {
        ...(row as unknown as ComplianceFields),
        table,
        id: row.id as string,
        email: (row.email as string | null) ?? null,
        name:
          table === "advisors"
            ? [row.first_name, row.last_name].filter(Boolean).join(" ").trim()
            : ((row.name as string) ?? ""),
      };
      break;
    }
  }
  if (!subject) return { outcome: "not_tracked" };

  const status = await readSignWellStatus(documentId);
  if (status === null) {
    return { outcome: "error", table: subject.table, subjectId: subject.id, error: "SignWell status check failed" };
  }
  if (status?.toLowerCase() !== "completed") {
    return { outcome: "not_completed", table: subject.table, subjectId: subject.id, status };
  }

  if (!subject.w9_signed_at) {
    const stampErr = await stampSigned(subject);
    if (stampErr) return { outcome: "error", table: subject.table, subjectId: subject.id, error: stampErr };
  }

  const pdf = await storeW9Pdf(subject, { attempts: 4, delayMs: 3000 });
  return {
    outcome: "recorded",
    table: subject.table,
    subjectId: subject.id,
    stored: pdf.stored,
    ...(pdf.error ? { error: pdf.error } : {}),
  };
}

/**
 * Store the voided check in the private bucket and record it on the row.
 *
 * Re-uploading replaces the record but keeps the old object: storage is cheap,
 * and someone correcting a blurry photo should not be able to destroy the copy
 * we already accepted.
 */
export async function storeVoidedCheck(
  subject: Pick<ComplianceSubject, "table" | "id">,
  file: File
): Promise<{ success: boolean; error?: string }> {
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Choose a file to upload." };
  }
  if (file.size > VOIDED_CHECK_MAX_BYTES) {
    return { success: false, error: "That file is larger than 15MB." };
  }
  if (!VOIDED_CHECK_MIME_TYPES.includes(file.type)) {
    return { success: false, error: "Upload a PDF or a photo (JPG, PNG, HEIC, WEBP)." };
  }

  const safeName = (file.name || "voided-check").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `${COMPLIANCE_DOC_PREFIX[subject.table]}/${subject.id}/voided-check_${Date.now()}_${safeName}`;

  const db = createAdminClient();
  const { error: uploadErr } = await db.storage
    .from(COMPLIANCE_DOC_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (uploadErr) {
    console.error("[compliance-onboarding] voided check upload failed:", uploadErr);
    return { success: false, error: "Upload failed. Try again." };
  }

  const { error: stampErr } = await db
    .from(subject.table)
    .update({
      voided_check_path: path,
      voided_check_filename: file.name || null,
      voided_check_uploaded_at: now(),
      updated_at: now(),
    })
    .eq("id", subject.id);
  if (stampErr) {
    console.error("[compliance-onboarding] voided check stamp failed:", stampErr);
    return { success: false, error: "Uploaded, but we couldn't record it. Try again." };
  }

  return { success: true };
}

/** Short-lived URL for staff to view a W-9 or voided check. */
export async function signedComplianceDocUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const db = createAdminClient();
  const { data, error } = await db.storage
    .from(COMPLIANCE_DOC_BUCKET)
    .createSignedUrl(path, COMPLIANCE_DOC_TTL_SECONDS);
  if (error) {
    console.error("[compliance-onboarding] signed URL failed:", error);
    return null;
  }
  return data?.signedUrl ?? null;
}
