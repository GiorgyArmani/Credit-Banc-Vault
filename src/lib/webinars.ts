// src/lib/webinars.ts
//
// Server-only reads for the partner webinar library. The table is RLS-locked
// with zero policies and the bucket is private, so everything goes through the
// service role — callers MUST have checked the viewer's role first (the
// /partner and /admin layouts do).

import { createAdminClient } from "@/lib/supabase/admin";
import {
  WEBINARS_BUCKET,
  PLAYBACK_URL_TTL_SECONDS,
  type WebinarRow,
  type WebinarView,
  type AdminWebinarView,
} from "@/lib/webinars-shared";

export const WEBINAR_COLUMNS =
  "id, title, description, session_date, video_path, thumbnail_path, size_bytes, is_published, created_at";

/**
 * Pair rows with their signed URLs. A row whose VIDEO couldn't be signed is
 * dropped (it can't play) — the rest of the library still renders. A missing
 * thumbnail just falls back to the placeholder.
 */
export function attachPlaybackUrls(
  rows: WebinarRow[],
  videoUrls: Map<string, string>,
  thumbUrls: Map<string, string>
): WebinarView[] {
  const out: WebinarView[] = [];
  for (const r of rows) {
    const video_url = videoUrls.get(r.video_path);
    if (!video_url) {
      console.error(`webinars: no signed url for ${r.video_path} — row ${r.id} hidden`);
      continue;
    }
    out.push({
      ...r,
      video_url,
      thumbnail_url: r.thumbnail_path ? thumbUrls.get(r.thumbnail_path) ?? null : null,
    });
  }
  return out;
}

/**
 * Admin variant: KEEP rows whose video couldn't be signed (video_url null).
 * The admin list never plays the video, and hiding such a row would leave a
 * broken entry the admin can neither see nor delete.
 */
export function attachAdminUrls(
  rows: WebinarRow[],
  videoUrls: Map<string, string>,
  thumbUrls: Map<string, string>
): AdminWebinarView[] {
  return rows.map((r) => ({
    ...r,
    video_url: videoUrls.get(r.video_path) ?? null,
    thumbnail_url: r.thumbnail_path ? thumbUrls.get(r.thumbnail_path) ?? null : null,
  }));
}

/** A failed batch-sign over a non-empty table is an outage, not an empty library. */
export function signingDegraded(rowCount: number, batchFailed: boolean): boolean {
  return rowCount > 0 && batchFailed;
}

export type WebinarListing<T> = {
  webinars: T[];
  /** The library couldn't be read in full — show "try again", never the empty state. */
  degraded: boolean;
};

async function signAll(
  db: ReturnType<typeof createAdminClient>,
  paths: string[]
): Promise<{ urls: Map<string, string>; failed: boolean }> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return { urls, failed: false };
  const { data, error } = await db.storage
    .from(WEBINARS_BUCKET)
    .createSignedUrls(paths, PLAYBACK_URL_TTL_SECONDS);
  if (error) {
    console.error("webinars: createSignedUrls failed:", error);
    return { urls, failed: true };
  }
  for (const s of data ?? []) {
    if (s.path && s.signedUrl && !s.error) urls.set(s.path, s.signedUrl);
  }
  return { urls, failed: false };
}

async function loadSigned(onlyPublished: boolean) {
  const db = createAdminClient();
  let q = db
    .from("webinars")
    .select(WEBINAR_COLUMNS)
    .order("session_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (onlyPublished) q = q.eq("is_published", true);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as WebinarRow[];
  const [video, thumb] = await Promise.all([
    signAll(db, rows.map((r) => r.video_path)),
    signAll(db, rows.flatMap((r) => (r.thumbnail_path ? [r.thumbnail_path] : []))),
  ]);
  return { rows, video, thumb, degraded: signingDegraded(rows.length, video.failed) };
}

export async function listPublishedWebinars(): Promise<WebinarListing<WebinarView>> {
  try {
    const { rows, video, thumb, degraded } = await loadSigned(true);
    return { webinars: attachPlaybackUrls(rows, video.urls, thumb.urls), degraded };
  } catch (err) {
    console.error("webinars: list failed:", err);
    return { webinars: [], degraded: true };
  }
}

export async function listAllWebinars(): Promise<WebinarListing<AdminWebinarView>> {
  try {
    const { rows, video, thumb, degraded } = await loadSigned(false);
    return { webinars: attachAdminUrls(rows, video.urls, thumb.urls), degraded };
  } catch (err) {
    console.error("webinars: admin list failed:", err);
    return { webinars: [], degraded: true };
  }
}
