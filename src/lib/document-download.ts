"use client";

/**
 * Downloading client documents from the staff pages.
 *
 * Two things live here because three surfaces (underwriting file, advisor /
 * admin workspace, and the client's own vault) each had their own copy:
 *
 *   1. the rule for what a downloaded file is CALLED, and
 *   2. bulk download as a single ZIP.
 *
 * On (2): every staff page used to loop over the files firing one browser
 * download each, 800ms apart. On a real packet that is 155 saves and two
 * minutes of the browser raining files — and browsers block a multi-download
 * sequence after the first handful, so the lender or underwriter silently ended
 * up with a fraction of what they asked for. One archive replaces it.
 *
 * Staff pages read through an AUTHENTICATED Supabase client, so the bytes come
 * from `storage.download()` as a Blob rather than from a signed URL — hence the
 * `load` half of ZipEntry. The public lender page takes the `url` half instead.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadFilesAsZip, type ZipEntry, type ZipProgress, type ZipResult } from "@/lib/zip-download";

export const DOCUMENTS_BUCKET = "user-documents";

/** The minimum a document needs to be downloadable. */
export interface DownloadableDocument {
  name: string;
  custom_label?: string | null;
  storage_path: string;
}

/**
 * What the file is called on disk.
 *
 * `custom_label` is the human name (it carries the bank account and statement
 * month on organised statements); `name` is the only place the extension is
 * guaranteed to live. Prefer the label, but never hand the OS an extensionless
 * file — that is a file the recipient has to guess at.
 *
 * Previously duplicated verbatim in the UW page, the workspace and vault.tsx.
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
 * Bundle documents into one ZIP, pulling each through the authenticated client.
 *
 * `folderOf` opts into subdirectories — pass it when the archive spans more than
 * one category or bank account, omit it when the set is already one section and
 * a folder would just add a click.
 */
export async function zipDocuments(
  supabase: SupabaseClient,
  documents: DownloadableDocument[],
  zip_name: string,
  options?: {
    folderOf?: (doc: DownloadableDocument) => string | null;
    onProgress?: (p: ZipProgress) => void;
  }
): Promise<ZipResult> {
  const entries: ZipEntry[] = documents.map((doc) => ({
    name: resolveDownloadName(doc),
    folder: options?.folderOf?.(doc) ?? null,
    load: async () => {
      const { data, error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .download(doc.storage_path);
      if (error || !data) {
        throw error ?? new Error(`No data for ${doc.storage_path}`);
      }
      return data;
    },
  }));

  return downloadFilesAsZip(entries, zip_name, options?.onProgress);
}
