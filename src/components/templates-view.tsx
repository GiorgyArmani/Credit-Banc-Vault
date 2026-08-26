"use client";

// The client portal's template shelf.
//
// A LIST, not a grid of cards, for the same reason the document vault is a list
// now: there are five of these, and five three-across cards each carrying a
// full-width button is a screen and a half of chrome for five links. It also
// keeps the portal reading as one thing — the client works down a list of
// documents to upload, and picks up blanks from a list of documents to fill.
//
// The whole row is the link. A row-sized <a> beats a button calling
// window.open(): middle-click, ctrl-click, "copy link" and keyboard activation
// all work for free, and the download needs no JavaScript at all.
//
// TWO FIELDS ON `templates` ARE NOT WHAT THEY LOOK LIKE, and the display works
// around both rather than showing the client the mess:
//
//   category   — not a taxonomy. Every row is "pdf" or "general", which is a
//                (half-wrong) file type, so grouping by it would produce a
//                "PDF" heading and a "GENERAL" heading and tell nobody
//                anything. The real type is derived from the file extension
//                below, which is right even when `category` isn't.
//   description — frequently the title again ("Resume Bio Template" /
//                "Resume Bio Template"). Printing both gives the client a line
//                that repeats itself, so a description that adds nothing over
//                the title is dropped.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  FileText,
  FileSpreadsheet,
  Download,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface Template {
  id: string;
  title: string;
  description: string;
  category: string;
  file_url: string;
  is_premium: boolean;
}

/**
 * The real file type, read from the URL's extension rather than `category`.
 * Signed Supabase URLs carry a query string, so the path is taken first.
 */
function fileKind(url: string): { label: string; spreadsheet: boolean } {
  const ext = (url.split("?")[0].split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "pdf":
      return { label: "PDF", spreadsheet: false };
    case "xlsx":
    case "xls":
    case "csv":
      return { label: "Excel", spreadsheet: true };
    case "docx":
    case "doc":
      return { label: "Word", spreadsheet: false };
    default:
      return { label: ext ? ext.toUpperCase() : "File", spreadsheet: false };
  }
}

/**
 * Does the description tell the client anything the title didn't?
 *
 * Compares on letters and digits only, and ignores a trailing "template" —
 * "Resume Bio Template" described as "Resume Bio Template" is the common case,
 * and "SAG - Business Debt Schedule" described as "SAG - Business Debt Schedule
 * Template" is the same case wearing a hat.
 */
function isRedundantDescription(title: string, description: string): boolean {
  const normalize = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\btemplate\b/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  const t = normalize(title);
  const d = normalize(description);
  return !d || d === t;
}

export default function TemplatesView() {
  const supabase = createClient();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("templates")
        .select("*")
        .order("title");

      if (error) throw error;
      setTemplates(data || []);
    } catch (err: any) {
      console.error("Error fetching templates:", err);
      setError("Failed to load templates. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-cb-mint" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
        <div>
          <p className="text-sm font-bold text-rose-900">Couldn&apos;t load templates</p>
          <p className="mt-0.5 text-[13px] text-rose-700">{error}</p>
        </div>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 px-6 py-14 text-center">
        <FileText className="mx-auto h-7 w-7 text-cb-ink/20" />
        <p className="mt-3 font-manrope text-base font-extrabold tracking-tight text-cb-ink">
          No templates yet
        </p>
        <p className="mt-1 text-sm text-cb-ink/45">
          Your advisor will add them here if your file needs any.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-2">
      {templates.map((template) => {
        const kind = fileKind(template.file_url);
        const Icon = kind.spreadsheet ? FileSpreadsheet : FileText;
        const showDescription = !isRedundantDescription(
          template.title,
          template.description || ""
        );

        return (
          <a
            key={template.id}
            href={template.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 rounded-xl border border-black/[0.07] bg-white px-4 py-3 transition-colors hover:border-cb-mint hover:bg-cb-mint/[0.04]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cb-cream text-cb-ink/40 transition-colors group-hover:bg-cb-mint group-hover:text-white">
              <Icon className="h-4 w-4" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-cb-ink">
                  {template.title}
                </span>
                {template.is_premium && (
                  <span className="shrink-0 rounded-full bg-cb-ink px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-cb-mint">
                    Premium
                  </span>
                )}
              </span>
              {showDescription && (
                <span className="mt-0.5 block truncate text-[12px] text-cb-ink/45">
                  {template.description}
                </span>
              )}
            </span>

            <span className="hidden shrink-0 rounded-full bg-black/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-cb-ink/45 sm:inline-block">
              {kind.label}
            </span>

            <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-cb-ink/40 transition-colors group-hover:text-cb-ink">
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Download</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}
