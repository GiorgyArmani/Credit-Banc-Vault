// src/lib/webinars-shared.ts
//
// Partner webinar library — everything both the browser and the server need.
// No Supabase imports here: the admin upload form runs this in the browser.
// Spec: docs/superpowers/specs/2026-10-14-partner-webinars-design.md

export const WEBINARS_BUCKET = "webinars";
export const MAX_WEBINAR_BYTES = 2 * 1024 * 1024 * 1024;
// Long enough to pause a 90-minute session and come back to it.
export const PLAYBACK_URL_TTL_SECONDS = 4 * 60 * 60;
export const TITLE_MAX = 200;

export type WebinarRow = {
  id: string;
  title: string;
  description: string | null;
  session_date: string | null;
  video_path: string;
  thumbnail_path: string | null;
  size_bytes: number;
  is_published: boolean;
  created_at: string;
};

export type WebinarView = WebinarRow & {
  video_url: string;
  thumbnail_url: string | null;
};

/** Admin list row: the video may be unsignable (file missing) and must still show. */
export type AdminWebinarView = WebinarRow & {
  video_url: string | null;
  thumbnail_url: string | null;
};

/**
 * Where the browser uploads a webinar file: one request to Supabase's DIRECT
 * storage host (<ref>.storage.supabase.co), which skips the API gateway.
 * Measured 2026-10-14 on 60 MB: 15.3 MB/s this way vs 3.2 MB/s through the
 * resumable (6 MB chunk) endpoint, so the user chose speed over resume.
 * Custom domains / local dev keep the host they were given.
 */
export function webinarUploadUrl(supabaseUrl: string, objectPath: string): string {
  const base = supabaseUrl
    .replace(/\/+$/, "")
    .replace(/^https:\/\/([a-z0-9]+)\.supabase\.co$/, "https://$1.storage.supabase.co");
  return `${base}/storage/v1/object/${WEBINARS_BUCKET}/${objectPath}`;
}

export function webinarVideoPath(id: string): string {
  return `videos/${id}.mp4`;
}

export function webinarThumbnailPath(id: string): string {
  return `thumbnails/${id}.jpg`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The id doubles as the storage file name, so it must never carry a path. */
export function isWebinarId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

export function validateWebinarFile(f: { name: string; type: string; size: number }): string | null {
  // Some Windows browsers hand over an MP4 with an empty MIME type.
  const is_mp4 = f.type === "video/mp4" || (f.type === "" && /\.mp4$/i.test(f.name));
  if (!is_mp4) return "Only MP4 videos can be uploaded. Zoom recordings are MP4 by default.";
  if (f.size <= 0) return "That file is empty.";
  if (f.size > MAX_WEBINAR_BYTES) return "That file is over the 2 GB limit.";
  return null;
}

export type WebinarFieldsInput = {
  title: unknown;
  description?: unknown;
  session_date?: unknown;
};

export type WebinarFields = {
  title: string;
  description: string | null;
  session_date: string | null;
};

function is_real_iso_date(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function validateWebinarFields(
  i: WebinarFieldsInput
): { ok: true; value: WebinarFields } | { ok: false; error: string } {
  const title = typeof i.title === "string" ? i.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required." };
  if (title.length > TITLE_MAX) {
    return { ok: false, error: `Title must be ${TITLE_MAX} characters or fewer.` };
  }

  const raw_desc = typeof i.description === "string" ? i.description.trim() : "";
  const description = raw_desc || null;

  const raw_date = typeof i.session_date === "string" ? i.session_date.trim() : "";
  if (raw_date && !is_real_iso_date(raw_date)) {
    return { ok: false, error: "Session date isn't a valid date." };
  }

  return { ok: true, value: { title, description, session_date: raw_date || null } };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * A `date` column arrives as "YYYY-MM-DD". Never pass it to `new Date()` —
 * that parses as UTC midnight, which is the previous evening in US time zones.
 */
export function formatSessionDate(d: string | null): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function formatBytes(n: number): string {
  const gb = n / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Turn a storage upload error into something an admin can act on. */
export function describeUploadError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b413\b|payload too large|maximum allowed size|exceeded the maximum/i.test(msg)) {
    return "Supabase is rejecting files this large — raise the Storage file size limit in the Supabase dashboard (Storage → Settings) to at least 2 GB.";
  }
  if (/\b40[13]\b/.test(msg)) {
    return "Your session expired or you don't have permission — sign in again and re-upload.";
  }
  if (/\b409\b/.test(msg)) {
    return "A file with this id already exists — cancel and start the upload again.";
  }
  return `Upload failed: ${msg}`;
}
