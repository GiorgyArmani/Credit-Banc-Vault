"use client";

/**
 * Reading client documents from the browser.
 *
 * Three things live here because three surfaces (underwriting file, advisor /
 * admin workspace, and the client's own vault) each had their own copy:
 *
 *   1. the URL a browser uses to reach a document's bytes,
 *   2. the rule for what a downloaded file is CALLED, and
 *   3. bulk download as a single ZIP.
 *
 * On (1): the browser no longer touches Supabase storage. It used to call
 * `supabase.storage.from("user-documents").download(path)` directly, which
 * worked because the bucket was PUBLIC — meaning it also worked for anyone at
 * all, with no key, who had ever seen a path. Reads now go through
 * GET /api/documents/[id]/file, which authorises the caller server-side and
 * 302s to a five-minute signed URL. See src/lib/document-access.ts.
 *
 * On (3): every staff page used to loop over the files firing one browser
 * download each, 800ms apart. On a real packet that is 155 saves and two
 * minutes of the browser raining files — and browsers block a multi-download
 * sequence after the first handful, so the lender or underwriter silently
 * ended up with a fraction of what they asked for. One archive replaces it.
 */

import { downloadFilesAsZip, type ZipEntry, type ZipProgress, type ZipResult } from "@/lib/zip-download";

export const DOCUMENTS_BUCKET = "user-documents";

/** The minimum a document needs to be downloadable. */
export interface DownloadableDocument {
  id: string;
  name: string;
  custom_label?: string | null;
  storage_path?: string | null;
}

/**
 * Where the browser fetches a document's bytes.
 *
 * `download: true` makes the response an attachment named by
 * resolveDownloadName's server-side twin, which is what you want behind an
 * `<a href>`; leave it off for previews rendered inline (iframe, img, the
 * office viewers).
 */
export function documentFileUrl(document_id: string, options?: { download?: boolean }): string {
  return `/api/documents/${document_id}/file${options?.download ? "?download=1" : ""}`;
}

/**
 * Fetch one document's bytes through the authorised route.
 *
 * Throws on a non-2xx so callers surface a failure rather than saving a ZIP
 * full of HTML error pages — the old storage call failed loudly too and the
 * behaviour is worth keeping.
 */
export async function fetchDocumentBlob(document_id: string): Promise<Blob> {
  const res = await fetch(documentFileUrl(document_id));
  if (!res.ok) {
    throw new Error(`Could not load document ${document_id} (${res.status})`);
  }
  return res.blob();
}

/**
 * Save one document to disk.
 *
 * Uses the attachment URL directly rather than fetching a blob: the browser
 * streams it, so a 200 MB statement never has to sit in a tab's memory, and
 * the filename comes from the server's Content-Disposition.
 */
export function downloadDocument(document_id: string): void {
  const a = document.createElement("a");
  a.href = documentFileUrl(document_id, { download: true });
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * What the file is called on disk.
 *
 * `custom_label` is the human name (it carries the bank account and statement
 * month on organised statements); `name` is the only place the extension is
 * guaranteed to live. Prefer the label, but never hand the OS an extensionless
 * file — that is a file the recipient has to guess at.
 *
 * Mirrored server-side by resolveServedFileName in src/lib/document-access.ts,
 * which names single-file downloads. This copy names ZIP entries, which the
 * server never sees.
 */
export function resolveDownloadName(doc: DownloadableDocument): string {
  if (!doc.custom_label) return doc.name;

  const ext_index = doc.name.lastIndexOf(".");
  const extension = ext_index !== -1 ? doc.name.substring(ext_index) : "";
  if (extension && !doc.custom_label.toLowerCase().endsWith(extension.toLowerCase())) {
    return doc.custom_label + extension;
  }
  return doc.custom_label;
}

/**
 * Sign a whole set of documents in one request.
 *
 * Returns a map of document id → short-lived signed URL. Ids the server would
 * not sign are simply absent from the map, which is what the ZIP relies on to
 * fail loudly on a file it cannot fetch.
 */
export async function fetchDocumentUrls(
  document_ids: string[]
): Promise<Record<string, string>> {
  if (document_ids.length === 0) return {};

  const res = await fetch("/api/documents/urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_ids }),
  });
  if (!res.ok) {
    throw new Error(`Could not prepare documents for download (${res.status})`);
  }
  const body = await res.json();
  return (body?.urls ?? {}) as Record<string, string>;
}

/**
 * Bundle documents into one ZIP.
 *
 * Authorises the whole packet up front in a single request, then pulls each
 * file's bytes straight from storage — so a 155-file review packet costs ONE
 * authorisation, not 155. The ZIP itself stays sequential on purpose; see
 * zip-download.ts.
 *
 * `folderOf` opts into subdirectories — pass it when the archive spans more
 * than one category or bank account, omit it when the set is already one
 * section and a folder would just add a click.
 */
export async function zipDocuments(
  documents: DownloadableDocument[],
  zip_name: string,
  options?: {
    folderOf?: (doc: DownloadableDocument) => string | null;
    onProgress?: (p: ZipProgress) => void;
  }
): Promise<ZipResult> {
  const urls = await fetchDocumentUrls(documents.map((d) => d.id));

  const entries: ZipEntry[] = documents.map((doc) => ({
    name: resolveDownloadName(doc),
    folder: options?.folderOf?.(doc) ?? null,
    load: async () => {
      const url = urls[doc.id];
      // No URL means the server declined to sign it — a row whose storage
      // object is gone, or (a bug worth hearing about) a file this caller may
      // not read. Either way the archive must not quietly omit it.
      if (!url) throw new Error(`Could not load "${resolveDownloadName(doc)}"`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load "${resolveDownloadName(doc)}" (${res.status})`);
      return res.blob();
    },
  }));

  return downloadFilesAsZip(entries, zip_name, options?.onProgress);
}
