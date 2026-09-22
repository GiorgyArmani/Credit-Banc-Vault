"use client";

import {
    ShieldCheck,
    CheckCircle2,
    AlertCircle,
    UploadCloud,
    Download,
    Eye,
    Pencil,
    Trash2,
    ChevronDown,
    ChevronUp,
    XCircle,
    Plus,
    X,
    FileText,
    Star,
    RefreshCw,
    Loader2,
} from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { BANK_STATEMENTS_DOC_CODE } from "@/lib/document-scope";
import {
    getDocumentPeriod,
    groupDocuments,
    groupsForDocCode,
    UNGROUPED_KEY,
    type DocumentGroup,
} from "@/lib/document-groups";

// ── Type definitions (mirrored from page.tsx) ────────────────────────────────

interface UserDocument {
    id: string;
    name: string;
    size: number;
    type: string;
    category: string | null;
    custom_label: string | null;
    description: string | null;
    is_favorite: boolean;
    upload_date: string;
    storage_path: string;
    /** Set on files filed into a group within their own field. */
    document_group_id?: string | null;
    /** Carries metadata.original_file_name, which dates a periodic file, and
     *  metadata.rejection_reason once staff reject the category. */
    metadata?: any;
    /** 'rejected' after rejectDocumentCategory; a replacement upload arrives
     *  with its own non-rejected status. */
    status?: string | null;
}

/**
 * A category is rejected while every file in it is rejected, i.e. the client
 * hasn't sent a replacement yet. One fresh upload puts it back in review (the
 * approve action clears the old rejected rows).
 */
export function isCategoryRejected(category_docs: { status?: string | null }[]): boolean {
    return category_docs.length > 0 && category_docs.every((d) => d.status === "rejected");
}

interface DocumentUploadStatusProps {
    required_docs: { code: string; label: string }[];
    documents: UserDocument[];
    approvals: Set<string>;
    expanded_categories: Set<string>;
    completion_percentage: number;
    /** Every group on the file, across all fields — each category slices out
     *  its own with groupsForDocCode. Empty is fine: everything then renders in
     *  a single "Ungrouped" section, which is what a file looks like before
     *  anyone has sorted it. */
    document_groups?: DocumentGroup[];
    /** Non-null while a bulk ZIP is being built — disables every Download All
     *  and shows progress, so a 155-file archive isn't 30 silent seconds. */
    zipping?: { completed: number; total: number } | null;
    // Code currently being re-requested (drives the per-field spinner). null when idle.
    requesting_again_code?: string | null;
    // callbacks
    on_toggle_expand: (code: string) => void;
    on_request_docs: () => void;
    on_request_again: (doc: { code: string; label: string }, statement_months?: number) => void;
    on_upload: (code: string, label: string) => void;
    on_approve: (doc: { code: string; label: string }) => void;
    on_reject: (doc: { code: string; label: string }) => void;
    on_remove_request: (doc: { code: string; label: string }) => void;
    on_preview: (doc: UserDocument) => void;
    on_download: (doc: UserDocument) => void;
    on_download_all: (docs: UserDocument[]) => void;
    on_delete_file: (doc: UserDocument) => void;
    on_rename: (doc: UserDocument) => void;
    /** Whole packet as one archive. Omit to hide the button. */
    on_download_packet?: () => void;
    /** Inside the client file's Documents tab, whose header and tiles already
     *  carry the title, completion count and Request docs action: drops the
     *  card title, complete pill, Request Doc button and progress bar for a
     *  slim "n of m approved" toolbar. Default false keeps today's markup. */
    embedded?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function format_file_size(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function format_date(iso_string: string): string {
    const date = new Date(iso_string);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Sub-component: individual file row ───────────────────────────────────────

function DocumentFileRow({
    doc,
    on_preview,
    on_rename,
    on_download,
    on_delete,
}: {
    doc: UserDocument;
    on_preview: () => void;
    on_rename: () => void;
    on_download: () => void;
    on_delete: () => void;
}) {
    return (
        <div className="group flex items-center justify-between gap-3 rounded-xl border border-black/5 bg-white p-2.5 transition-colors hover:border-black/10">
            <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-black/[0.03]">
                    <FileText className="h-4 w-4 text-cb-ink/40" />
                </div>
                <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-cb-ink">
                        {doc.custom_label || doc.name}
                        {/* Statement month, when the bank's own filename gave it
                            up. A hint only — most rows won't have one. */}
                        {(() => {
                            const period = getDocumentPeriod(doc);
                            return period ? (
                                <span className="shrink-0 rounded-full bg-black/5 px-1.5 text-[11px] font-medium text-cb-ink/60">
                                    {period.label}
                                </span>
                            ) : null;
                        })()}
                        {doc.is_favorite && <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
                    </p>
                    <p className="text-xs text-cb-ink/40">
                        {format_file_size(doc.size)} · Uploaded {format_date(doc.upload_date)}
                    </p>
                </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                    type="button"
                    onClick={on_preview}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-cb-ink/40 transition-colors hover:bg-black/5 hover:text-cb-ink"
                    title="Preview"
                >
                    <Eye className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={on_rename}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-cb-ink/40 transition-colors hover:bg-black/5 hover:text-cb-ink"
                    title="Rename"
                >
                    <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={on_download}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-cb-ink/40 transition-colors hover:bg-black/5 hover:text-cb-ink"
                    title="Download"
                >
                    <Download className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={on_delete}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-cb-ink/40 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    title="Delete"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}

// ── Sub-component: category row ───────────────────────────────────────────────

function DocCategoryRow({
    doc_type,
    documents,
    approvals,
    document_groups,
    zipping,
    is_expanded,
    is_requesting_again,
    on_toggle_expand,
    on_upload,
    on_approve,
    on_reject,
    on_remove_request,
    on_request_again,
    on_preview,
    on_download,
    on_download_all,
    on_delete_file,
    on_rename,
}: {
    doc_type: { code: string; label: string };
    documents: UserDocument[];
    approvals: Set<string>;
    document_groups: DocumentGroup[];
    zipping: { completed: number; total: number } | null;
    is_expanded: boolean;
    is_requesting_again: boolean;
    on_toggle_expand: () => void;
    on_upload: () => void;
    on_approve: () => void;
    on_reject: () => void;
    on_remove_request: () => void;
    on_request_again: (statement_months?: number) => void;
    on_preview: (doc: UserDocument) => void;
    on_download: (doc: UserDocument) => void;
    on_download_all: (docs: UserDocument[]) => void;
    on_delete_file: (doc: UserDocument) => void;
    on_rename: (doc: UserDocument) => void;
}) {
    const category_docs = documents.filter((d) => d.category === doc_type.code);
    const has_docs = category_docs.length > 0;
    const is_approved = approvals.has(doc_type.code);
    const is_bank_statements = doc_type.code === BANK_STATEMENTS_DOC_CODE;
    // This field's own groups — the accounts for statements, the years for tax
    // returns, the people for licences.
    const field_groups = groupsForDocCode(document_groups, doc_type.code);
    // Section the list only once groups actually exist. A field nobody has
    // organised keeps the flat list it has always had, rather than gaining a
    // single "Ungrouped" wrapper that adds a box and says nothing.
    const is_grouped_category = field_groups.length > 0;
    // Local month picker for re-requesting bank statements (advisor may need a
    // different period than the original request).
    const [again_months, set_again_months] = useState(12);
    const is_rejected = !is_approved && isCategoryRejected(category_docs);
    const rejection_reason: string | null = is_rejected
        ? category_docs.find((d) => d.metadata?.rejection_reason)?.metadata?.rejection_reason ?? null
        : null;
    const status: "approved" | "rejected" | "uploaded" | "pending" = is_approved
        ? "approved"
        : is_rejected
        ? "rejected"
        : has_docs
        ? "uploaded"
        : "pending";

    const status_config = {
        approved: {
            border: "border-l-emerald-500",
            icon_bg: "text-emerald-600",
            label: "Approved",
            label_color: "text-emerald-700",
        },
        rejected: {
            border: "border-l-rose-400",
            icon_bg: "text-rose-600",
            label: "Rejected · waiting for a replacement",
            label_color: "text-rose-700",
        },
        uploaded: {
            border: "border-l-amber-400",
            icon_bg: "text-amber-600",
            label: "Ready for review",
            label_color: "text-amber-700",
        },
        pending: {
            border: "border-l-black/10",
            icon_bg: "text-cb-ink/30",
            label: "Awaiting upload",
            label_color: "text-cb-ink/40",
        },
    };
    const config = status_config[status];

    return (
        <div
            id={`category-${doc_type.code}`}
            className={clsx(
                "overflow-hidden rounded-2xl border border-black/5 border-l-2 bg-white transition-all",
                config.border
            )}
        >
            {/* Header row. Below sm the title/status block takes the full
                first line and the actions wrap onto a second one, so a long
                label is never squeezed a word per line; the chevron stays
                top-right. From sm up it's one line: title left, actions right. */}
            <div
                className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-black/[0.02] sm:items-center sm:px-5"
                onClick={on_toggle_expand}
            >
                <div className={clsx("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-black/[0.03]", config.icon_bg)}>
                    {status === "approved" ? (
                        <ShieldCheck className="h-4 w-4" />
                    ) : status === "rejected" ? (
                        <XCircle className="h-4 w-4" />
                    ) : status === "uploaded" ? (
                        <CheckCircle2 className="h-4 w-4" />
                    ) : (
                        <AlertCircle className="h-4 w-4" />
                    )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-cb-ink">{doc_type.label}</p>
                        <p className="mt-0.5 text-xs">
                            <span className={config.label_color}>{config.label}</span>
                            {has_docs && (
                                <span className="text-cb-ink/40">
                                    <span aria-hidden className="mx-1.5 text-cb-ink/25">·</span>
                                    {category_docs.length} file{category_docs.length > 1 ? "s" : ""}
                                </span>
                            )}
                        </p>
                        {rejection_reason && (
                            <p className="mt-0.5 break-words text-xs text-cb-ink/50">Reason: {rejection_reason}</p>
                        )}
                    </div>

                <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0 sm:flex-nowrap">
                    {/* Approve / Reject. A rejected category keeps Approve so a
                        mistaken reject can be undone without a re-upload. */}
                    {(status === "uploaded" || status === "rejected") && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); on_approve(); }}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
                        >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Approve
                        </button>
                    )}
                    {status === "uploaded" && (
                        <>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); on_reject(); }}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50"
                            >
                                <XCircle className="h-3.5 w-3.5" />
                                Reject
                            </button>
                        </>
                    )}

                    {/* Upload for advisor */}
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); on_upload(); }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink transition-colors hover:bg-cb-cream"
                    >
                        <UploadCloud className="h-3.5 w-3.5" />
                        Upload
                    </button>

                    {/* Request again — re-asks the client for more on this same
                        field (e.g. additional tax returns / bank statements),
                        even after the file has been submitted to UW. Re-notifies
                        the client and reopens the requirement. */}
                    {is_bank_statements && (
                        <select
                            value={again_months}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => set_again_months(parseInt(e.target.value))}
                            className="h-8 shrink-0 rounded-lg border border-black/10 bg-white px-2 text-xs font-medium text-cb-ink"
                            title="Months to request"
                        >
                            {[6, 12, 18, 24].map((m) => (
                                <option key={m} value={m}>{m} mo</option>
                            ))}
                        </select>
                    )}
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); on_request_again(is_bank_statements ? again_months : undefined); }}
                        disabled={is_requesting_again}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink transition-colors hover:bg-cb-cream disabled:opacity-60"
                        title="Re-request this document from the client"
                    >
                        {is_requesting_again ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Request again
                    </button>

                    {/* Remove request (only if no docs) */}
                    {!has_docs && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); on_remove_request(); }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-cb-ink/40 transition-colors hover:bg-black/5 hover:text-cb-ink"
                            title="Remove request"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                </div>

                {/* Expand toggle */}
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-cb-ink/40">
                    {is_expanded ? (
                        <ChevronUp className="h-4 w-4" />
                    ) : (
                        <ChevronDown className="h-4 w-4" />
                    )}
                </div>
            </div>

            {/* Expanded file list */}
            {is_expanded && has_docs && (
                <div className="space-y-2 border-t border-black/5 px-4 pb-4 pt-3 sm:px-5">
                    {category_docs.length > 1 && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() => on_download_all(category_docs)}
                                disabled={!!zipping}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink transition-colors hover:bg-cb-cream disabled:opacity-50"
                            >
                                {zipping ? (
                                    <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        {zipping.completed}/{zipping.total}
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-3.5 w-3.5" />
                                        Zip all ({category_docs.length})
                                    </>
                                )}
                            </button>
                        </div>
                    )}

                    {/* An organised field renders one section per group; every
                        other keeps the flat list. Grouping is read-only here —
                        sorting the backlog of already-uploaded files is done
                        from the underwriting view, which has the bulk assign. */}
                    {is_grouped_category
                        ? groupDocuments(category_docs, field_groups).map((group) => (
                            <div
                                key={group.key}
                                className={clsx(
                                    "overflow-hidden rounded-xl border",
                                    group.key === UNGROUPED_KEY
                                        ? "border-dashed border-black/10"
                                        : "border-black/5"
                                )}
                            >
                                <div className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-xs font-semibold text-cb-ink">{group.label}</p>
                                        <p className="text-xs text-cb-ink/40">
                                            {group.documents.length} file{group.documents.length === 1 ? "" : "s"}
                                        </p>
                                    </div>
                                    {group.documents.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => on_download_all(group.documents)}
                                            disabled={!!zipping}
                                            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-cb-ink/60 transition-colors hover:bg-black/5 hover:text-cb-ink disabled:opacity-50"
                                        >
                                            {zipping ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Download className="h-3.5 w-3.5" />
                                            )}
                                            Zip {group.documents.length}
                                        </button>
                                    )}
                                </div>
                                <div className="space-y-2 p-2.5">
                                    {group.documents.map((doc) => (
                                        <DocumentFileRow
                                            key={doc.id}
                                            doc={doc}
                                            on_preview={() => on_preview(doc)}
                                            on_rename={() => on_rename(doc)}
                                            on_download={() => on_download(doc)}
                                            on_delete={() => on_delete_file(doc)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))
                        : category_docs.map((doc) => (
                            <DocumentFileRow
                                key={doc.id}
                                doc={doc}
                                on_preview={() => on_preview(doc)}
                                on_rename={() => on_rename(doc)}
                                on_download={() => on_download(doc)}
                                on_delete={() => on_delete_file(doc)}
                            />
                        ))}
                </div>
            )}
        </div>
    );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function DocumentUploadStatus({
    required_docs,
    documents,
    approvals,
    expanded_categories,
    completion_percentage,
    document_groups = [],
    zipping = null,
    requesting_again_code,
    on_toggle_expand,
    on_request_docs,
    on_request_again,
    on_upload,
    on_approve,
    on_reject,
    on_remove_request,
    on_preview,
    on_download,
    on_download_all,
    on_delete_file,
    on_rename,
    on_download_packet,
    embedded = false,
}: DocumentUploadStatusProps) {
    const total = required_docs.length;
    const completed = required_docs.filter((d) => approvals.has(d.code)).length;

    const additional_docs = documents.filter(
        (doc) => !required_docs.some((type) => type.code === doc.category)
    );

    return (
        <section
            className={
                embedded
                    ? "rounded-2xl border border-black/5 bg-white p-4 sm:p-5 shadow-sm"
                    : "rounded-2xl border border-black/5 bg-white p-8 shadow-sm"
            }
        >
            {embedded ? (
            <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm text-cb-ink/60">{completed} of {total} approved</p>
                {on_download_packet && documents.length > 1 && (
                    <button
                        type="button"
                        onClick={on_download_packet}
                        disabled={!!zipping}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream disabled:opacity-50"
                    >
                        {zipping ? (
                            <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {zipping.completed}/{zipping.total}
                            </>
                        ) : (
                            <>
                                <Download className="h-3.5 w-3.5" />
                                Download all ({documents.length})
                            </>
                        )}
                    </button>
                )}
            </div>
            ) : (
            <>
            {/* Section header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="font-manrope text-base font-bold text-cb-ink">Document upload status</h3>
                    <p className="mt-0.5 text-xs text-cb-ink/40">{completed} of {total} categories approved</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className={clsx(
                        "rounded-full px-2.5 py-1 text-xs font-medium",
                        completion_percentage >= 100 ? "bg-emerald-100 text-emerald-700" :
                            completion_percentage >= 50 ? "bg-amber-100 text-amber-700" :
                                "bg-red-100 text-red-700"
                    )}>
                        {completed}/{total} complete
                    </span>
                    {/* Whole packet in one archive — the per-category buttons
                        below each cover one section, which on a full file means
                        15 separate zips to merge by hand. */}
                    {on_download_packet && documents.length > 1 && (
                        <button
                            type="button"
                            onClick={on_download_packet}
                            disabled={!!zipping}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink transition-colors hover:bg-cb-cream disabled:opacity-50"
                        >
                            {zipping ? (
                                <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    {zipping.completed}/{zipping.total}
                                </>
                            ) : (
                                <>
                                    <Download className="h-3.5 w-3.5" />
                                    Zip packet ({documents.length})
                                </>
                            )}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={on_request_docs}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Request doc
                    </button>
                </div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-slate-100 rounded-full mb-6 overflow-hidden">
                <div
                    className={clsx(
                        "h-full rounded-full transition-all duration-700",
                        completion_percentage >= 100 ? "bg-emerald-500" :
                            completion_percentage >= 50 ? "bg-amber-400" : "bg-red-400"
                    )}
                    style={{ width: `${Math.min(completion_percentage, 100)}%` }}
                />
            </div>
            </>
            )}

            {/* Required document categories */}
            <div className="space-y-3">
                {required_docs.map((doc_type) => (
                    <DocCategoryRow
                        key={doc_type.code}
                        doc_type={doc_type}
                        documents={documents}
                        approvals={approvals}
                        document_groups={document_groups}
                        zipping={zipping}
                        is_expanded={expanded_categories.has(doc_type.code)}
                        is_requesting_again={requesting_again_code === doc_type.code}
                        on_toggle_expand={() => on_toggle_expand(doc_type.code)}
                        on_upload={() => on_upload(doc_type.code, doc_type.label)}
                        on_approve={() => on_approve(doc_type)}
                        on_reject={() => on_reject(doc_type)}
                        on_remove_request={() => on_remove_request(doc_type)}
                        on_request_again={(months) => on_request_again(doc_type, months)}
                        on_preview={on_preview}
                        on_download={on_download}
                        on_download_all={on_download_all}
                        on_delete_file={on_delete_file}
                        on_rename={on_rename}
                    />
                ))}
            </div>

            {/* Additional documents */}
            {additional_docs.length > 0 && (
                <div className="mt-6 border-t border-black/5 pt-5">
                    <h4 className="mb-3 font-manrope text-sm font-bold text-cb-ink">Additional documents</h4>
                    <div className="space-y-2">
                        {additional_docs.map((doc) => (
                            <DocumentFileRow
                                key={doc.id}
                                doc={doc}
                                on_preview={() => on_preview(doc)}
                                on_rename={() => on_rename(doc)}
                                on_download={() => on_download(doc)}
                                on_delete={() => on_delete_file(doc)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Empty state */}
            {documents.length === 0 && (
                <p className="py-3 text-sm text-cb-ink/40">No documents uploaded yet</p>
            )}
        </section>
    );
}
