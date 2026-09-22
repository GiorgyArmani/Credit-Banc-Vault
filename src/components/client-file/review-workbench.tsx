// src/components/client-file/review-workbench.tsx
//
//  Documents            │                          │  Bank statements
//  Bank statements ●3   │                          │  Ready for review
//   ● Jan.pdf           │        [ preview ]       │  3 files
//     Sep 3 · Client    │                          │  [ Approve category ]
//   ● Feb.pdf           │                          │  [ Reject… ]
//  Tax returns ●0       │                          │  ─────────────
//   Nothing uploaded yet│                          │  Rename · Download · Open
//
// The Review tab: list | preview | decision, so a reviewer walks a packet
// without opening a modal per file. Presentational — every action is a prop,
// and the only internal state is the fallback selection used when the caller
// does not drive `selected_file_id`.

"use client";

import React, { useMemo, useRef, useState } from "react";
import { Check, Download, Loader2, Maximize2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { DocumentPreviewBody } from "@/components/pdf/pdf-viewer";
import { EmptyLine } from "./empty-line";
import { formatDate } from "./format";

export type ReviewFile = {
  id: string;
  /** Display label (custom_label ?? name) — often has no extension. */
  name: string;
  /** Stored file name, for type detection in the preview. */
  file_name?: string | null;
  type?: string;
  upload_date?: string | null;
  uploaded_by_role?: string | null;
  viewed?: boolean;
};

export type ReviewCategoryState = "approved" | "rejected" | "ready_for_review" | "awaiting_upload";

export type ReviewCategory = {
  code: string;
  label: string;
  files: ReviewFile[];
  state: ReviewCategoryState;
  file_count: number;
};

export type ReviewWorkbenchProps = {
  categories: ReviewCategory[];
  /** Controlled selection; when undefined the component picks the first file of the first non-approved category. */
  selected_file_id?: string | null;
  on_select_file: (file: ReviewFile, category: ReviewCategory) => void;
  on_approve: (category: ReviewCategory) => void;
  on_reject: (category: ReviewCategory) => void;
  approving_code?: string | null;
  on_rename?: (file: ReviewFile) => void;
  on_download?: (file: ReviewFile) => void;
  on_open_full?: (file: ReviewFile) => void;
  can_decide?: boolean;
};

type Entry = { file: ReviewFile; category: ReviewCategory };

const STATE_DOT: Record<ReviewCategoryState, string> = {
  approved: "bg-emerald-500",
  ready_for_review: "bg-amber-500",
  rejected: "bg-rose-500",
  awaiting_upload: "bg-cb-ink/30",
};

const STATE_LABEL: Record<ReviewCategoryState, string> = {
  approved: "Approved",
  ready_for_review: "Ready for review",
  rejected: "Rejected",
  awaiting_upload: "Awaiting upload",
};

const STATE_TEXT: Record<ReviewCategoryState, string> = {
  approved: "text-emerald-700",
  ready_for_review: "text-amber-700",
  rejected: "text-rose-600",
  awaiting_upload: "text-cb-ink/50",
};

const BUTTON_BASE =
  "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
const GHOST_LINK =
  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-cb-ink/60 transition-colors hover:bg-black/5 hover:text-cb-ink";

function optionId(fileId: string) {
  return `review-file-${fileId}`;
}

/** "client" -> "Client", "advisor_admin" -> "Advisor admin". */
function sentenceCase(value: string) {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function fileMeta(file: ReviewFile) {
  const parts: string[] = [];
  if (file.upload_date) parts.push(formatDate(file.upload_date));
  if (file.uploaded_by_role) parts.push(sentenceCase(file.uploaded_by_role));
  return parts.join(" · ");
}

function isNarrow() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
}

export function ReviewWorkbench({
  categories,
  selected_file_id,
  on_select_file,
  on_approve,
  on_reject,
  approving_code,
  on_rename,
  on_download,
  on_open_full,
  can_decide,
}: ReviewWorkbenchProps) {
  const preview_ref = useRef<HTMLDivElement>(null);
  // Only the fallback: when the caller passes selected_file_id we never read it.
  const [fallback_id, set_fallback_id] = useState<string | null>(null);
  // Desktop-only: collapsing the file list widens the preview. Mobile stacks,
  // so the list stays visible there whatever this says.
  const [list_shown, set_list_shown] = useState(true);

  const controlled = selected_file_id !== undefined;

  // One flat list so ArrowUp/ArrowDown cross category boundaries for free.
  const entries = useMemo<Entry[]>(
    () => categories.flatMap((category) => category.files.map((file) => ({ file, category }))),
    [categories],
  );

  const default_id = useMemo(() => {
    const first_open = categories.find((category) => category.state !== "approved" && category.files.length > 0);
    return (first_open ?? categories.find((category) => category.files.length > 0))?.files[0]?.id ?? null;
  }, [categories]);

  const active_id = controlled ? selected_file_id : (fallback_id ?? default_id);
  const selected =
    entries.find((entry) => entry.file.id === active_id) ??
    // A stale fallback id (file removed) drops back to the default rather than
    // leaving the workbench blank. A controlled null means "nothing selected".
    (controlled ? null : (entries.find((entry) => entry.file.id === default_id) ?? null));

  function select(entry: Entry, options?: { focus?: boolean; scroll?: boolean }) {
    if (!controlled) set_fallback_id(entry.file.id);
    on_select_file(entry.file, entry.category);
    if (options?.focus) document.getElementById(optionId(entry.file.id))?.focus();
    if (options?.scroll && isNarrow()) {
      preview_ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function handle_list_keydown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (entries.length === 0) return;
    const current = selected ? entries.findIndex((entry) => entry.file.id === selected.file.id) : -1;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = current < 0 ? 0 : Math.min(current + 1, entries.length - 1);
        break;
      case "ArrowUp":
        next = current < 0 ? entries.length - 1 : Math.max(current - 1, 0);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = entries.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(entries[next], { focus: true });
  }

  // Roving tabIndex: the selected row is the single tab stop, or the first row
  // when nothing is selected yet.
  const roving_id = selected?.file.id ?? entries[0]?.file.id ?? null;
  const decision_category = selected?.category ?? null;
  const show_decisions = can_decide !== false;

  return (
    <div
      className={cn(
        "grid grid-cols-1 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm",
        "divide-y divide-black/5 lg:h-[calc(100vh-15rem)] lg:min-h-[600px]",
        // Collapsing the list hands its track to the preview, for a reviewer
        // who wants the document as wide as the window allows.
        list_shown
          ? "lg:grid-cols-[minmax(200px,220px)_minmax(0,1fr)_minmax(220px,260px)]"
          : "lg:grid-cols-[minmax(0,1fr)_minmax(220px,260px)]",
        "lg:divide-x lg:divide-y-0",
      )}
    >
      {/* Left: categories and their files */}
      <div
        role="listbox"
        aria-label="Documents to review"
        onKeyDown={handle_list_keydown}
        className={cn("min-w-0 overflow-y-auto py-2", !list_shown && "lg:hidden")}
      >
        <div className="px-2 pb-1 pt-1">
          <button
            type="button"
            onClick={() => set_list_shown((shown) => !shown)}
            className="hidden rounded-lg px-2 py-1 text-xs font-semibold text-cb-ink/60 transition-colors hover:bg-black/5 hover:text-cb-ink lg:inline-flex"
          >
            Hide list
          </button>
        </div>
        {categories.length === 0 ? (
          <div className="px-4">
            <EmptyLine>No document categories yet</EmptyLine>
          </div>
        ) : (
          categories.map((category) => (
            <div key={category.code} role="group" aria-label={category.label} className="pb-1">
              <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                <span
                  aria-hidden
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATE_DOT[category.state])}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-cb-ink" title={category.label}>
                  {category.label}
                </span>
                <span className="shrink-0 rounded-full bg-black/5 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-cb-ink/60">
                  {category.file_count}
                </span>
              </div>

              {category.files.length === 0 ? (
                <p className="px-4 pb-1 text-xs text-cb-ink/40">Nothing uploaded yet</p>
              ) : (
                category.files.map((file) => {
                  const is_selected = selected?.file.id === file.id;
                  return (
                    <div
                      key={file.id}
                      id={optionId(file.id)}
                      role="option"
                      aria-selected={is_selected}
                      tabIndex={roving_id === file.id ? 0 : -1}
                      onClick={() => select({ file, category }, { scroll: true })}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        select({ file, category }, { focus: true });
                      }}
                      className={cn(
                        "cursor-pointer border-l-2 px-4 py-2 outline-none transition-colors",
                        "focus-visible:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400",
                        is_selected
                          ? "border-emerald-500 bg-emerald-50 text-cb-ink"
                          : "border-transparent hover:bg-black/[0.03]",
                      )}
                    >
                      <p className="flex items-center gap-1.5">
                        <span
                          aria-label={file.viewed ? undefined : "Not viewed"}
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            file.viewed ? "bg-transparent" : "bg-emerald-500",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>
                          {file.name}
                        </span>
                      </p>
                      {fileMeta(file) && <p className="pl-3 text-xs text-cb-ink/50">{fileMeta(file)}</p>}
                    </div>
                  );
                })
              )}
            </div>
          ))
        )}
      </div>

      {/* Middle: the preview itself */}
      <div ref={preview_ref} className="flex min-w-0 h-[70vh] flex-col overflow-hidden lg:h-auto">
        {!list_shown && (
          <div className="hidden shrink-0 border-b border-black/5 px-2 py-1 lg:block">
            <button
              type="button"
              onClick={() => set_list_shown(true)}
              className="inline-flex rounded-lg px-2 py-1 text-xs font-semibold text-cb-ink/60 transition-colors hover:bg-black/5 hover:text-cb-ink"
            >
              Show list
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {selected ? (
            <DocumentPreviewBody
              documentId={selected.file.id}
              docName={selected.file.name}
              fileName={selected.file.file_name}
              fileType={selected.file.type}
              className="h-full rounded-none"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-sm text-cb-ink/40">
              Select a document to review
            </div>
          )}
        </div>
      </div>

      {/* Right: the selected file's category decision + per-file actions */}
      <div className="min-w-0 overflow-y-auto px-4 py-4">
        {!decision_category || !selected ? (
          <p className="text-sm text-cb-ink/40">Select a document to review</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="font-manrope text-sm font-bold text-cb-ink">{decision_category.label}</h3>
              <p className={cn("text-xs font-semibold", STATE_TEXT[decision_category.state])}>
                {STATE_LABEL[decision_category.state]}
              </p>
              <p className="text-xs text-cb-ink/50">
                {decision_category.file_count} {decision_category.file_count === 1 ? "file" : "files"}
              </p>
            </div>

            {show_decisions && decision_category.file_count > 0 && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => on_approve(decision_category)}
                  disabled={decision_category.state === "approved" || approving_code === decision_category.code}
                  className={cn(
                    BUTTON_BASE,
                    decision_category.state === "approved"
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-700 disabled:opacity-100"
                      : "bg-cb-mint text-cb-navy shadow-sm hover:brightness-95"
                  )}
                >
                  {decision_category.state === "approved" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    approving_code === decision_category.code && <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {decision_category.state === "approved" ? "Approved" : "Approve category"}
                </button>
                <button
                  type="button"
                  onClick={() => on_reject(decision_category)}
                  className={cn(BUTTON_BASE, "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50")}
                >
                  Reject…
                </button>
              </div>
            )}

            {(on_rename || on_download || on_open_full) && (
              <div className="space-y-0.5 border-t border-black/5 pt-3">
                <p className="truncate px-2 pb-1 text-xs text-cb-ink/40" title={selected.file.name}>
                  {selected.file.name}
                </p>
                {on_rename && (
                  <button type="button" onClick={() => on_rename(selected.file)} className={GHOST_LINK}>
                    <Pencil className="h-3.5 w-3.5" />
                    Rename
                  </button>
                )}
                {on_download && (
                  <button type="button" onClick={() => on_download(selected.file)} className={GHOST_LINK}>
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </button>
                )}
                {on_open_full && (
                  <button type="button" onClick={() => on_open_full(selected.file)} className={GHOST_LINK}>
                    <Maximize2 className="h-3.5 w-3.5" />
                    Open full view
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
