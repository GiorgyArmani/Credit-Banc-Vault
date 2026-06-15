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
            <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2 px-1">
              {label}
            </h2>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50/60 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => set_preview(doc)}
                    className="flex items-center gap-3 min-w-0 text-left flex-1"
                  >
                    <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-slate-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {doc.display_name}
                      </p>
                      {doc.size != null && (
                        <p className="text-[11px] text-slate-400">{format_size(doc.size)}</p>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => set_preview(doc)}
                      className="flex items-center gap-1.5 px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-[11px] font-bold transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      View
                    </button>
                    <a
                      href={doc.download_url}
                      className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold transition-colors"
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
