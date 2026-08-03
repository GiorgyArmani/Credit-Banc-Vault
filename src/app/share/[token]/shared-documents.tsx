"use client";

// Client list for the public lender share page: groups the shared files by
// category and lets the lender preview each one in-app (no leaving the page)
// before downloading.

import { useMemo, useState } from "react";
import { FileText, Download, Eye } from "lucide-react";
import { FilePreviewModal } from "@/components/file-preview-modal";
import type { SharedDocument } from "@/lib/share-links";

function format_size(bytes: number | null): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SharedDocuments({ documents }: { documents: SharedDocument[] }) {
  const [preview, set_preview] = useState<SharedDocument | null>(null);

  const grouped = useMemo(() => {
    const groups = new Map<string, SharedDocument[]>();
    for (const doc of documents) {
      const key = doc.category_label;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(doc);
    }
    return Array.from(groups.entries());
  }, [documents]);

  return (
    <>
      <div className="space-y-6">
        {grouped.map(([label, docs]) => (
          <section key={label}>
            <h2 className="mb-2 px-1 font-label text-[11px] font-bold uppercase tracking-[0.2em] text-cb-gray">
              {label}
            </h2>
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
                      <p className="truncate text-sm font-semibold text-cb-ink">
                        {doc.display_name}
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
        ))}
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
