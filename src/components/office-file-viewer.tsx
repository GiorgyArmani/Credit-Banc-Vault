"use client";

/**
 * In-browser preview for spreadsheets and Word documents.
 *
 * WHY NOT THE OFFICE / GOOGLE VIEWERS. The one-line answer is an iframe to
 * `view.officeapps.live.com` or `docs.google.com/gview`. Both work by handing
 * the file's URL to Microsoft or Google, who then FETCH the document onto their
 * servers. On the public lender share page that means shipping a client's bank
 * statements, tax returns and debt schedules to a third party on every preview.
 * That is a data-exposure decision, not a rendering choice, and not one to make
 * to save a day of work.
 *
 * So: parse and render locally. The bytes never leave the browser that already
 * had permission to see them.
 *
 * WHAT YOU GET, honestly. A spreadsheet renders as its data — sheets, rows,
 * columns — not as a pixel-accurate copy: charts, conditional formatting and
 * merged-cell styling are gone. For what actually arrives as .xlsx here (debt
 * schedules, A/R aging, rent rolls) the data IS the document. `.docx` keeps its
 * layout reasonably well. Anything else still falls back to download.
 *
 * Both parsers are loaded with dynamic import(), so a user who never opens a
 * spreadsheet never pays for the code.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Download, FileWarning, Table2 } from "lucide-react";
import clsx from "clsx";

export type OfficeKind = "xlsx" | "docx" | null;

/**
 * Which renderer, if any, handles this file.
 *
 * Extension first: uploads routinely arrive as `application/octet-stream` from
 * mobile, so the stored MIME is the less reliable signal of the two.
 */
export function detectOfficeKind(name: string, mime?: string | null): OfficeKind {
  const lower_name = (name || "").toLowerCase();
  const lower_mime = (mime || "").toLowerCase();

  if (/\.(xlsx|xlsm|csv)$/.test(lower_name)) return "xlsx";
  if (/\.docx$/.test(lower_name)) return "docx";

  if (lower_mime.includes("spreadsheetml") || lower_mime === "text/csv") return "xlsx";
  if (lower_mime.includes("wordprocessingml")) return "docx";

  // Legacy binary .xls / .doc are deliberately NOT claimed — neither parser
  // reads them, and claiming them would replace a working download button with
  // a broken preview.
  return null;
}

interface Props {
  kind: Exclude<OfficeKind, null>;
  /** Ready-to-use URL (signed, or our share route). */
  url: string;
  name: string;
  /** Rendered in the failure state so the user always has a way forward. */
  downloadUrl?: string | null;
}

interface SheetData {
  name: string;
  rows: (string | number | boolean | Date | null)[][];
}

export function OfficeFileViewer({ kind, url, name, downloadUrl }: Props) {
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [sheets, set_sheets] = useState<SheetData[]>([]);
  const [active_sheet, set_active_sheet] = useState(0);
  const docx_container = useRef<HTMLDivElement | null>(null);

  const render = useCallback(async () => {
    set_loading(true);
    set_error(null);
    set_sheets([]);

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not fetch the file (${res.status})`);
      const blob = await res.blob();

      if (kind === "docx") {
        const { renderAsync } = await import("docx-preview");
        const target = docx_container.current;
        if (!target) throw new Error("Preview container unavailable");
        target.innerHTML = "";
        await renderAsync(blob, target, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: true,
          breakPages: true,
          // Word documents can carry script-bearing content; docx-preview
          // strips it, and we never inject the raw XML ourselves.
          renderHeaders: true,
          renderFooters: true,
        });
        set_loading(false);
        return;
      }

      // CSV: no parser needed, and read-excel-file does not handle it.
      if (/\.csv$/i.test(name)) {
        const text = await blob.text();
        set_sheets([{ name: "CSV", rows: parseCsv(text) }]);
        set_loading(false);
        return;
      }

      // `/browser` — the package has no root export, and the node build pulls
      // in fs. v9 returns EVERY sheet from one call.
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const workbook = await readXlsxFile(blob);

      const parsed: SheetData[] = (workbook ?? [])
        .map((s, i) => ({
          name: s.sheet || `Sheet ${i + 1}`,
          rows: (s.data ?? []) as SheetData["rows"],
        }))
        // Drop sheets with no cells — empty tabs are common in templates and
        // render as a tab that does nothing when clicked.
        .filter((s) => s.rows.length > 0);

      if (parsed.length === 0) throw new Error("This workbook has no readable data");
      set_sheets(parsed);
      set_active_sheet(0);
      set_loading(false);
    } catch (err: any) {
      console.error("office viewer failed:", err);
      set_error(err?.message || "This file could not be previewed");
      set_loading(false);
    }
  }, [url, kind, name]);

  useEffect(() => {
    void render();
  }, [render]);

  if (loading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
          Rendering {kind === "xlsx" ? "spreadsheet" : "document"}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
        <FileWarning className="h-10 w-10 text-slate-500" />
        <div>
          <p className="text-sm font-bold text-slate-200">Preview unavailable</p>
          <p className="mt-1 max-w-sm text-xs text-slate-400">{error}</p>
        </div>
        {downloadUrl && (
          <a
            href={downloadUrl}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-emerald-700"
          >
            <Download className="h-3.5 w-3.5" />
            Download to open it
          </a>
        )}
      </div>
    );
  }

  if (kind === "docx") {
    return (
      <div className="h-full w-full overflow-auto bg-slate-200 p-4">
        <div ref={docx_container} className="mx-auto" />
      </div>
    );
  }

  const sheet = sheets[active_sheet];

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {sheets.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-2 py-1.5">
          {sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              onClick={() => set_active_sheet(i)}
              className={clsx(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors",
                i === active_sheet
                  ? "bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500 hover:bg-white/60"
              )}
            >
              <Table2 className="h-3 w-3" />
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <tbody>
            {sheet?.rows.map((row, r) => (
              <tr key={r} className={r === 0 ? "sticky top-0 z-10" : undefined}>
                {/* Row number gutter — a spreadsheet without one is hard to
                    talk about on a call, which is how these get reviewed. */}
                <td className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-2 py-1 text-right text-[10px] font-bold text-slate-400">
                  {r + 1}
                </td>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={clsx(
                      "whitespace-nowrap border border-slate-200 px-2 py-1",
                      r === 0
                        ? "bg-slate-100 font-bold text-slate-700"
                        : "bg-white text-slate-700",
                      typeof cell === "number" && "text-right tabular-nums"
                    )}
                  >
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(cell: string | number | boolean | Date | null): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toLocaleDateString();
  if (typeof cell === "number") {
    // Keep full precision for anything that isn't obviously money — rounding a
    // rate or an account number would misrepresent the document.
    return Number.isInteger(cell) ? String(cell) : cell.toLocaleString(undefined, {
      maximumFractionDigits: 4,
    });
  }
  return String(cell);
}

/**
 * Minimal RFC-4180 CSV split: quoted fields, escaped quotes, embedded newlines.
 * Small enough not to justify a dependency, and CSV is the one spreadsheet
 * format read-excel-file does not handle.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let in_quotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (in_quotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          in_quotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') in_quotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
