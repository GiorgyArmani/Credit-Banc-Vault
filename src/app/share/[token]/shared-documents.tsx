"use client";

// Client list for the public lender share page: groups the shared files by
// category and lets the lender preview each one in-app (no leaving the page)
// before downloading.
//
// Bulk download matters more here than anywhere else in the product. A funded
// packet is 150+ files, and one Download button per row means a lender clicking
// 155 times — which is not something anyone does, so in practice they ask us to
// email a zip instead. The two zip buttons (whole packet, and per section) are
// the difference between this page being usable and being a list to complain
// about. Grouping inside the archive mirrors the sections on screen, so
// "download every bank statement from the Chase account" is one click.

import { useMemo, useState } from "react";
import { FileText, Download, Eye, Loader2, FolderArchive } from "lucide-react";
import { FilePreviewModal } from "@/components/file-preview-modal";
import type { SharedDocument } from "@/lib/share-links";
import { downloadFilesAsZip, type ZipEntry } from "@/lib/zip-download";

function format_size(bytes: number | null): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Extension carried over from the stored file name, so the zip entry opens. */
function with_extension(doc: SharedDocument): string {
  if (/\.[A-Za-z0-9]{1,5}$/.test(doc.display_name)) return doc.display_name;
  // Fall back to the MIME subtype when the display name has no extension —
  // an extensionless file inside a zip is one the lender has to guess at.
  const subtype = doc.type?.split("/")[1]?.split(";")[0];
  if (!subtype) return doc.display_name;
  const ext = subtype === "jpeg" ? "jpg" : subtype;
  return `${doc.display_name}.${ext}`;
}

interface ZipState {
  /** Section label, or "__all__" for the whole packet. */
  scope: string;
  completed: number;
  total: number;
}

export function SharedDocuments({
  documents,
  packageName,
}: {
  documents: SharedDocument[];
  /** Business name — becomes the archive's file name. */
  packageName: string;
}) {
  const [preview, set_preview] = useState<SharedDocument | null>(null);
  const [zipping, set_zipping] = useState<ZipState | null>(null);

  const grouped = useMemo(() => {
    const groups = new Map<string, SharedDocument[]>();
    for (const doc of documents) {
      const key = doc.category_label;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(doc);
    }
    // Newest-first inside each section, so anything added since the link was
    // sent sits at the top of the group where the reader will actually see it.
    for (const docs of groups.values()) {
      docs.sort((a, b) => Number(b.is_new) - Number(a.is_new));
    }
    return Array.from(groups.entries());
  }, [documents]);

  async function run_zip(scope: string, label: string, docs: SharedDocument[]) {
    if (zipping) return;

    const entries: ZipEntry[] = docs.map((d) => ({
      name: with_extension(d),
      // The view URL is the same signed object URL; the download variant only
      // adds a content-disposition hint the zip has no use for.
      url: d.view_url,
      // Only foldered for the whole-packet archive. A single-section zip is
      // already about one section, so nesting it inside a folder of the same
      // name would just add a click.
      folder: scope === "__all__" ? d.category_label : null,
    }));

    set_zipping({ scope, completed: 0, total: entries.length });
    try {
      const result = await downloadFilesAsZip(entries, `${packageName} - ${label}`, (p) =>
        set_zipping({ scope, completed: p.completed, total: p.total })
      );
      // Silent on cancel: the lender closed the save dialog on purpose.
      if (result.saved && result.failed.length > 0) {
        console.warn("zip: files skipped", result.failed);
      }
    } catch (err) {
      console.error("zip failed:", err);
    } finally {
      set_zipping(null);
    }
  }

  const zip_all_busy = zipping?.scope === "__all__";

  return (
    <>
      {/* Packet-level toolbar */}
      {documents.length > 1 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-[0_1px_2px_rgba(0,3,33,0.04)]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-cb-ink">Download the whole packet</p>
            <p className="text-[11px] text-cb-gray">
              One ZIP, organized into folders by document type.
            </p>
          </div>
          <button
            type="button"
            onClick={() => run_zip("__all__", "All documents", documents)}
            disabled={!!zipping}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-cb-navy px-4 py-2.5 text-[12px] font-bold text-primary-fixed transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          >
            {zip_all_busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {zipping!.completed}/{zipping!.total}
              </>
            ) : (
              <>
                <FolderArchive className="h-4 w-4" />
                Download all ({documents.length})
              </>
            )}
          </button>
        </div>
      )}

      <div className="space-y-6">
        {grouped.map(([label, docs]) => {
          const section_busy = zipping?.scope === label;
          return (
            <section key={label}>
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <h2 className="min-w-0 truncate font-label text-[11px] font-bold uppercase tracking-[0.2em] text-cb-gray">
                  {label}
                </h2>
                {docs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => run_zip(label, label, docs)}
                    disabled={!!zipping}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 font-label text-[10px] font-bold uppercase tracking-[0.15em] text-cb-mint transition-colors hover:bg-cb-mint/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {section_busy ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {zipping!.completed}/{zipping!.total}
                      </>
                    ) : (
                      <>
                        <FolderArchive className="h-3 w-3" />
                        Zip all {docs.length}
                      </>
                    )}
                  </button>
                )}
              </div>
              <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,3,33,0.04)] divide-y divide-black/5">
                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-cb-cream/50"
                  >
                    <button
                      type="button"
                      onClick={() => set_preview(doc)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cb-mint/10 text-cb-mint">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-sm font-semibold text-cb-ink">
                          <span className="truncate">{doc.display_name}</span>
                          {/* Added after this link was sent. The lender may have
                              already reviewed the packet once; without this they
                              would have to diff it by hand. */}
                          {doc.is_new && (
                            <span className="shrink-0 rounded-full bg-cb-mint/15 px-2 py-0.5 font-label text-[9px] font-bold uppercase tracking-[0.15em] text-cb-mint">
                              New
                            </span>
                          )}
                        </p>
                        {doc.size != null && (
                          <p className="text-[11px] text-cb-gray">{format_size(doc.size)}</p>
                        )}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => set_preview(doc)}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold text-cb-ink/60 transition-colors hover:bg-black/[0.04]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View
                      </button>
                      <a
                        href={doc.download_url}
                        className="flex items-center gap-1.5 rounded-lg bg-cb-navy px-3 py-2 text-[11px] font-bold text-primary-fixed transition-transform hover:scale-[1.03]"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <FilePreviewModal
        isOpen={!!preview}
        onClose={() => set_preview(null)}
        name={preview?.display_name || ""}
        url={preview?.view_url || null}
        fileType={preview?.type}
        downloadUrl={preview?.download_url || null}
      />
    </>
  );
}
