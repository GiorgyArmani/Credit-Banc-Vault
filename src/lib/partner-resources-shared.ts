// src/lib/partner-resources-shared.ts
//
// Referral partner resource library — everything both the browser and the
// server need. No Supabase imports here: the admin upload form runs this in
// the browser. Migration: supabase/migrations/20261111_partner_resources.sql

export const PARTNER_RESOURCES_BUCKET = "partner-resources";
export const MAX_RESOURCE_BYTES = 50 * 1024 * 1024;
export const RESOURCE_TITLE_MAX = 200;
export const RESOURCE_FILE_NAME_MAX = 200;

/**
 * Extension → the MIME type the file is stored with. The extension decides,
 * not `File.type`: browsers disagree (Windows reports a .csv as Excel, and
 * sometimes nothing at all). Must match the bucket's allowed_mime_types.
 */
export const RESOURCE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** For the file picker's `accept` attribute. */
export const RESOURCE_ACCEPT = Object.keys(RESOURCE_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export type PartnerResourceRow = {
  id: string;
  title: string;
  description: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  is_published: boolean;
  created_at: string;
};

/** Lower-cased extension when it is one we accept, otherwise null. */
export function resourceExtension(fileName: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  const ext = m?.[1].toLowerCase();
  return ext && ext in RESOURCE_TYPES ? ext : null;
}

export function resourceMimeType(fileName: string): string | null {
  const ext = resourceExtension(fileName);
  return ext ? RESOURCE_TYPES[ext] : null;
}

export function validateResourceFile(f: { name: string; size: number }): string | null {
  if (!resourceExtension(f.name)) {
    return "That file type isn't supported. Upload a PDF, Word, Excel, PowerPoint, CSV, TXT, PNG or JPG file.";
  }
  if (f.name.trim().length > RESOURCE_FILE_NAME_MAX) {
    return "That file name is too long — rename the file and try again.";
  }
  if (f.size <= 0) return "That file is empty.";
  if (f.size > MAX_RESOURCE_BYTES) return "That file is over the 50 MB limit.";
  return null;
}

/**
 * Where the file lives in the bucket: `<id>/<sanitised name>`. The id folder
 * keeps names from colliding; keeping a readable name (rather than `<id>.pdf`)
 * means a file opened in the browser still saves under a sensible name.
 * Anything outside [A-Za-z0-9._-] becomes "_", so the name can't carry a path.
 */
export function resourceStoragePath(id: string, fileName: string): string {
  const safe = fileName.trim().replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120);
  return `${id}/${safe}`;
}

export type ResourceFields = { title: string; description: string | null };

export function validateResourceFields(i: {
  title: unknown;
  description?: unknown;
}): { ok: true; value: ResourceFields } | { ok: false; error: string } {
  const title = typeof i.title === "string" ? i.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required." };
  if (title.length > RESOURCE_TITLE_MAX) {
    return { ok: false, error: `Title must be ${RESOURCE_TITLE_MAX} characters or fewer.` };
  }
  const description = typeof i.description === "string" ? i.description.trim() : "";
  return { ok: true, value: { title, description: description || null } };
}

/** "Rate Sheet Q4.pdf" → "Rate Sheet Q4" — the title an upload starts with. */
export function titleFromFileName(fileName: string): string {
  return fileName.trim().replace(/\.[a-z0-9]+$/i, "").slice(0, RESOURCE_TITLE_MAX);
}

export function formatFileSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Short badge text for a file: "PDF", "XLSX". */
export function resourceTypeLabel(fileName: string): string {
  return (resourceExtension(fileName) ?? "file").toUpperCase();
}
