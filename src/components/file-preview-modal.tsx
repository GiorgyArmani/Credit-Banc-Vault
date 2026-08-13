"use client";

// Lightweight in-app file previewer that works off a ready-made (already-signed
// or public) URL — no Supabase/auth dependency. Use it where the storage path
// isn't available client-side: the public lender share page and the lender
// response screenshots. Images render inline; PDFs/other embed in an iframe.

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileText, X, ExternalLink } from "lucide-react";
import { OfficeFileViewer, detectOfficeKind } from "@/components/office-file-viewer";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  /** Ready-to-use URL (signed or public). null → "unable to preview" state. */
  url: string | null;
  fileType?: string | null;
  /** Optional download URL; falls back to `url`. */
  downloadUrl?: string | null;
}

export function FilePreviewModal({ isOpen, onClose, name, url, fileType, downloadUrl }: Props) {
  const is_image =
    (fileType ?? "").startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);
  // Spreadsheets and Word files render in-app instead of going to an iframe,
  // which browsers cannot display and which silently downloads them instead.
  const office_kind = detectOfficeKind(name, fileType);
  const download_href = downloadUrl || url;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 overflow-hidden border-none bg-slate-950/95 backdrop-blur-xl">
        <DialogHeader className="p-4 border-b border-white/10 flex flex-row items-center justify-between shrink-0 space-y-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-white text-base md:text-lg font-bold truncate max-w-[200px] md:max-w-md">
                {name}
              </DialogTitle>
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] mt-0.5">
                Preview
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {download_href && (
              <Button
                size="sm"
                variant="outline"
                className="bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-700 h-9 px-4 rounded-xl font-bold text-[10px] uppercase tracking-widest hidden sm:flex"
                asChild
              >
                <a href={download_href}>
                  <Download className="h-3.5 w-3.5 mr-2" />
                  Download
                </a>
              </Button>
            )}
            {url && (
              <Button
                size="sm"
                variant="outline"
                className="bg-white/5 border-white/10 text-white hover:bg-white/10 h-9 px-4 rounded-xl font-bold text-[10px] uppercase tracking-widest hidden sm:flex"
                asChild
              >
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 mr-2" />
                  Open Original
                </a>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-slate-400 hover:text-white hover:bg-white/10 rounded-xl"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 bg-slate-900/50 relative flex items-center justify-center overflow-hidden">
          {url ? (
            is_image ? (
              <div className="w-full h-full p-4 flex items-center justify-center overflow-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={name}
                  className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
                />
              </div>
            ) : office_kind ? (
              <OfficeFileViewer
                kind={office_kind}
                url={url}
                name={name}
                downloadUrl={download_href}
              />
            ) : (
              <iframe src={`${url}#toolbar=0`} className="w-full h-full border-none" title={name} />
            )
          ) : (
            <div className="text-center p-8">
              <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">
                Unable to load preview
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
