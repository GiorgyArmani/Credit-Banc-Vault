"use client";

/**
 * Bundle a set of already-signed file URLs into one ZIP, in the browser.
 *
 * WHY CLIENT-SIDE. A funded packet is ~155 files and a few hundred MB. Zipping
 * that in a Vercel function would mean pulling every file Supabase → lambda →
 * browser, inside a 60s ceiling and a fixed memory budget: it would time out,
 * and it would pay for the bytes twice. The browser already holds a signed URL
 * for each file, so it can stream them straight from storage and assemble the
 * archive locally. No server involved, no timeout, no egress through us.
 *
 * WHY IT REPLACES THE OLD PATTERN. The existing "Download All" fires one
 * download per file on a timer — 155 saves, two minutes of the browser raining
 * files, and every browser blocks the sequence after the first handful. It also
 * produces 155 files named alike, since statements share a label.
 *
 * FOLDERS. Files are grouped into ZIP directories by their section label, which
 * is what makes "download the whole packet" usable: the lender opens it and
 * finds `Bank Statements — Chase ••4821/`, `Tax Returns/`, and so on, rather
 * than one flat pile. Duplicate names inside a folder get ` (2)`, ` (3)`.
 */

import { downloadZip } from "client-zip";

export interface ZipEntry {
  /** Display name, used for the file name inside the archive. */
  name: string;
  /** ZIP subdirectory. Omit for the archive root. */
  folder?: string | null;
  /**
   * Where the bytes come from. Exactly one of these.
   *
   * `url` is the lender page: it already holds a signed URL per file, so the
   * fetch streams from storage with no auth step.
   *
   * `load` is the staff pages: they read through an authenticated Supabase
   * client (`storage.download`), which returns a Blob and has no URL to hand
   * over. Signing 155 URLs first would be a pointless extra round trip per file.
   */
  url?: string;
  load?: () => Promise<Blob>;
}

export interface ZipProgress {
  /** Files fetched so far. */
  completed: number;
  total: number;
}

/** Characters that are illegal or hostile in a path on Windows/macOS/Linux. */
function sanitizeSegment(segment: string): string {
  // Path separators first — left in place they would silently create nested
  // folders inside the archive.
  const flattened = segment.replace(/[\\/]+/g, "-");

  // Drop control codes and the characters Windows forbids in a path, one
  // code point at a time. A character-class range would need literal control
  // bytes in this file; spaces and hyphens must survive, since they carry the
  // readable structure of a label like "Bank Statements - Chase 4821 - Mar 2026".
  const FORBIDDEN = '<>:"|?*';
  let out = "";
  for (const ch of flattened) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    if (FORBIDDEN.includes(ch)) continue;
    out += ch;
  }

  return (
    out
      // A leading dot hides the file on unix; a trailing dot or space breaks
      // Windows.
      .replace(/^\.+/, "")
      .replace(/[. ]+$/, "")
      .trim()
      .slice(0, 120) || "file"
  );
}

/**
 * Ensure every path in the archive is unique.
 *
 * Not cosmetic: statements in a category share one `custom_label`, so without
 * this a 133-file bank-statement folder collapses to a single entry (most zip
 * readers keep the last one) and the lender silently loses 132 documents.
 */
function uniquePath(taken: Set<string>, folder: string | null, name: string): string {
  const safe_name = sanitizeSegment(name);
  const safe_folder = folder ? sanitizeSegment(folder) : null;

  // Split the extension so the counter lands before it: "file (2).pdf".
  const dot = safe_name.lastIndexOf(".");
  const has_ext = dot > 0 && dot > safe_name.length - 8;
  const stem = has_ext ? safe_name.slice(0, dot) : safe_name;
  const ext = has_ext ? safe_name.slice(dot) : "";

  let candidate = safe_folder ? `${safe_folder}/${stem}${ext}` : `${stem}${ext}`;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    const numbered = `${stem} (${n})${ext}`;
    candidate = safe_folder ? `${safe_folder}/${numbered}` : numbered;
    n++;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Fetch each entry and yield it to the zip writer as it arrives.
 *
 * Sequential on purpose. 155 parallel fetches against Supabase storage invites
 * rate limiting and gives the reader no honest progress signal; one at a time is
 * bounded by bandwidth anyway, and the stream keeps memory flat.
 *
 * A file that fails to fetch is SKIPPED, not fatal — one dead signed URL must
 * not cost the lender the other 154 documents. The caller is told how many.
 */
async function* zipEntries(
  entries: ZipEntry[],
  taken: Set<string>,
  onProgress: ((p: ZipProgress) => void) | undefined,
  failures: string[]
) {
  let completed = 0;
  for (const entry of entries) {
    try {
      let input: Response | Blob;
      if (entry.url) {
        const res = await fetch(entry.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Passing the Response lets client-zip stream the body straight
        // through instead of buffering the file.
        input = res;
      } else if (entry.load) {
        input = await entry.load();
      } else {
        throw new Error("entry has neither url nor load");
      }

      yield {
        name: uniquePath(taken, entry.folder ?? null, entry.name),
        input,
      };
    } catch (err) {
      console.error(`zip: skipping ${entry.name}:`, err);
      failures.push(entry.name);
    } finally {
      completed++;
      onProgress?.({ completed, total: entries.length });
    }
  }
}

export interface ZipResult {
  /** Files written into the archive. */
  written: number;
  /** Names that could not be fetched and were left out. */
  failed: string[];
  /** False when the user dismissed the save dialog. */
  saved: boolean;
}

/**
 * Build and save a ZIP of the given files.
 *
 * Uses the File System Access API when the browser has it, which pipes the
 * archive to disk as it is built — the only way a few hundred MB is safe, since
 * the Blob fallback has to hold the whole thing in memory first. Firefox and
 * Safari take the fallback.
 */
export async function downloadFilesAsZip(
  entries: ZipEntry[],
  zip_name: string,
  onProgress?: (p: ZipProgress) => void
): Promise<ZipResult> {
  if (entries.length === 0) return { written: 0, failed: [], saved: false };

  const safe_zip_name = sanitizeSegment(zip_name).replace(/\.zip$/i, "") + ".zip";
  const failures: string[] = [];
  const taken = new Set<string>();

  // Ask for the destination BEFORE any fetching. showSaveFilePicker requires a
  // user gesture, and awaiting 155 downloads first would consume it.
  let handle: any = null;
  const picker = (window as any).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      handle = await picker.call(window, {
        suggestedName: safe_zip_name,
        types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
      });
    } catch (err: any) {
      // AbortError = the user closed the dialog. That is a cancel, not a
      // failure, and must not fall through to downloading anyway.
      if (err?.name === "AbortError") return { written: 0, failed: [], saved: false };
      console.warn("zip: save picker unavailable, falling back to blob:", err);
      handle = null;
    }
  }

  const response = downloadZip(zipEntries(entries, taken, onProgress, failures));

  if (handle) {
    const writable = await handle.createWritable();
    await response.body!.pipeTo(writable);
    return { written: entries.length - failures.length, failed: failures, saved: true };
  }

  // Fallback: materialise the whole archive, then hand it over.
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safe_zip_name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  return { written: entries.length - failures.length, failed: failures, saved: true };
}
