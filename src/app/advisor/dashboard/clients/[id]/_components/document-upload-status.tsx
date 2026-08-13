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
    getDocumentStatementPeriod,
    groupDocumentsByBankAccount,
    isAccountScopedDoc,
    UNASSIGNED_ACCOUNT_KEY,
    type BankAccount,
} from "@/lib/bank-accounts";

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
    /** Set on bank statements filed onto an account. */
    bank_account_id?: string | null;
    /** Carries metadata.original_file_name, which dates a statement. */
    metadata?: any;
}

interface DocumentUploadStatusProps {
    required_docs: { code: string; label: string }[];
    documents: UserDocument[];
    approvals: Set<string>;
    expanded_categories: Set<string>;
    completion_percentage: number;
    /** Accounts on the active business. Statements group under these; every
     *  other category ignores them. Empty is fine — everything then renders in
     *  a single "Unassigned" group, which is what a file looks like before
     *  anyone has sorted it. */
    bank_accounts?: BankAccount[];
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
        <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100 hover:border-slate-200 transition-colors group">
            <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-4 w-4 text-slate-400" />
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate flex items-center gap-1.5">
                        {doc.custom_label || doc.name}
                        {/* Statement month, when the bank's own filename gave it
                            up. A hint only — most rows won't have one. */}
                        {(() => {
                            const period = getDocumentStatementPeriod(doc);
                            return period ? (
                                <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-indigo-500">
                                    {period.label}
                                </span>
                            ) : null;
                        })()}
                        {doc.is_favorite && <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
                    </p>
                    <p className="text-[11px] text-slate-400">
                        {format_file_size(doc.size)} · Uploaded {format_date(doc.upload_date)}
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={on_preview}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                    title="Preview"
                >
                    <Eye className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={on_rename}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    title="Rename"
                >
                    <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={on_download}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    title="Download"
                >
                    <Download className="h-3.5 w-3.5" />
                </button>
                <button
                    onClick={on_delete}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
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
    bank_accounts,
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
    bank_accounts: BankAccount[];
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
    // Statements render one section per bank account instead of a flat list.
    const is_statement_category = isAccountScopedDoc(doc_type.code);
    // Local month picker for re-requesting bank statements (advisor may need a
    // different period than the original request).
    const [again_months, set_again_months] = useState(12);
    const status: "approved" | "uploaded" | "pending" = is_approved
        ? "approved"
        : has_docs
        ? "uploaded"
        : "pending";

    const status_config = {
        approved: {
            border: "border-l-emerald-500",
            icon_bg: "bg-emerald-100 text-emerald-700",
            label: "Advisor Approved",
            label_color: "text-emerald-600",
        },
        uploaded: {
            border: "border-l-amber-400",
            icon_bg: "bg-amber-100 text-amber-700",
            label: "Ready for Review",
            label_color: "text-amber-600",
        },
        pending: {
            border: "border-l-slate-200",
            icon_bg: "bg-slate-100 text-slate-400",
            label: "Awaiting Upload",
            label_color: "text-slate-400",
        },
    };
    const config = status_config[status];

    return (
        <div
            id={`category-${doc_type.code}`}
            className={clsx(
                "bg-white rounded-2xl border border-slate-100 border-l-4 shadow-sm overflow-hidden transition-all",
                config.border
            )}
        >
            {/* Header row */}
            <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50/50 transition-colors"
                onClick={on_toggle_expand}
            >
                <div className="flex items-center gap-4">
                    <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", config.icon_bg)}>
                        {status === "approved" ? (
                            <ShieldCheck className="h-5 w-5" />
                        ) : status === "uploaded" ? (
                            <CheckCircle2 className="h-5 w-5" />
                        ) : (
                            <AlertCircle className="h-5 w-5" />
                        )}
                    </div>
                    <div>
                        <p className="text-sm font-bold text-slate-900">{doc_type.label}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className={clsx("text-[10px] font-black uppercase tracking-wider", config.label_color)}>
                                {config.label}
                            </span>
                            {has_docs && (
                                <>
                                    <div className="w-1 h-1 rounded-full bg-slate-300" />
                                    <span className="text-[10px] font-bold text-slate-500">
                                        {category_docs.length} file{category_docs.length > 1 ? "s" : ""}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Approve / Reject */}
                    {status === "uploaded" && (
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={(e) => { e.stopPropagation(); on_approve(); }}
                                className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors flex items-center gap-1"
                            >
                                <ShieldCheck className="h-3 w-3" />
                                Approve
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); on_reject(); }}
                                className="h-8 px-3 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors flex items-center gap-1"
                            >
                                <XCircle className="h-3 w-3" />
                                Reject
                            </button>
                        </div>
                    )}

                    {/* Upload for advisor */}
                    <button
                        onClick={(e) => { e.stopPropagation(); on_upload(); }}
                        className="h-8 px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors flex items-center gap-1"
                    >
                        <UploadCloud className="h-3 w-3" />
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
                            className="h-8 text-[10px] font-bold border border-slate-200 rounded-lg px-2 bg-white text-slate-600 shrink-0"
                            title="Months to request"
                        >
                            {[6, 12, 18, 24].map((m) => (
                                <option key={m} value={m}>{m} mo</option>
                            ))}
                        </select>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); on_request_again(is_bank_statements ? again_months : undefined); }}
                        disabled={is_requesting_again}
                        className="h-8 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors flex items-center gap-1 disabled:opacity-60"
                        title="Re-request this document from the client"
                    >
                        {is_requesting_again ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <RefreshCw className="h-3 w-3" />
                        )}
                        Request Again
                    </button>

                    {/* Remove request (only if no docs) */}
                    {!has_docs && (
                        <button
                            onClick={(e) => { e.stopPropagation(); on_remove_request(); }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Remove request"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}

                    {/* Expand toggle */}
                    <div className="w-px h-5 bg-slate-200 mx-1" />
                    {is_expanded ? (
                        <ChevronUp className="h-4 w-4 text-slate-400" />
                    ) : (
                        <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                </div>
            </div>

            {/* Expanded file list */}
            {is_expanded && has_docs && (
                <div className="px-5 pb-5 space-y-2 border-t border-slate-100 pt-4">
                    {category_docs.length > 1 && (
                        <div className="flex justify-end mb-1">
                            <button
                                onClick={() => on_download_all(category_docs)}
                                disabled={!!zipping}
                                className="text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 flex items-center gap-1 px-3 py-1 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                            >
                                {zipping ? (
                                    <>
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        {zipping.completed}/{zipping.total}
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-3 w-3" />
                                        Zip All ({category_docs.length})
                                    </>
                                )}
                            </button>
                        </div>
                    )}

                    {/* Statements group by account; every other category keeps
                        the flat list. Grouping is read-only here — sorting the
                        backlog of already-uploaded files is done from the
                        underwriting view, which has the bulk assign. */}
                    {is_statement_category
                        ? groupDocumentsByBankAccount(category_docs, bank_accounts).map((group) => (
                            <div
                                key={group.key}
                                className={clsx(
                                    "rounded-xl border overflow-hidden",
                                    group.key === UNASSIGNED_ACCOUNT_KEY
                                        ? "border-dashed border-slate-200 bg-slate-50/60"
                                        : "border-slate-100"
                                )}
                            >
                                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-700 truncate">{group.label}</p>
                                        <p className="text-[10px] font-bold text-slate-400">
                                            {group.documents.length} file{group.documents.length === 1 ? "" : "s"}
                                        </p>
                                    </div>
                                    {group.documents.length > 1 && (
                                        <button
                                            onClick={() => on_download_all(group.documents)}
                                            disabled={!!zipping}
                                            className="shrink-0 text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                                        >
                                            {zipping ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <Download className="h-3 w-3" />
                                            )}
                                            Zip {group.documents.length}
                                        </button>
                                    )}
                                </div>
                                <div className="p-3 space-y-2">
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
    bank_accounts = [],
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
}: DocumentUploadStatusProps) {
    const total = required_docs.length;
    const completed = required_docs.filter((d) => approvals.has(d.code)).length;

    const additional_docs = documents.filter(
        (doc) => !required_docs.some((type) => type.code === doc.category)
    );

    return (
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
            {/* Section header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-base font-extrabold text-slate-900">Document Upload Status</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{completed} of {total} categories approved</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className={clsx(
                        "px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-full",
                        completion_percentage >= 100 ? "bg-emerald-100 text-emerald-700" :
                            completion_percentage >= 50 ? "bg-amber-100 text-amber-700" :
                                "bg-red-100 text-red-700"
                    )}>
                        {completed}/{total} Complete
                    </span>
                    {/* Whole packet in one archive — the per-category buttons
                        below each cover one section, which on a full file means
                        15 separate zips to merge by hand. */}
                    {on_download_packet && documents.length > 1 && (
                        <button
                            onClick={on_download_packet}
                            disabled={!!zipping}
                            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors disabled:opacity-50"
                        >
                            {zipping ? (
                                <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    {zipping.completed}/{zipping.total}
                                </>
                            ) : (
                                <>
                                    <Download className="h-3.5 w-3.5" />
                                    Zip Packet ({documents.length})
                                </>
                            )}
                        </button>
                    )}
                    <button
                        onClick={on_request_docs}
                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors shadow-lg shadow-emerald-600/20"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Request Doc
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

            {/* Required document categories */}
            <div className="space-y-3">
                {required_docs.map((doc_type) => (
                    <DocCategoryRow
                        key={doc_type.code}
                        doc_type={doc_type}
                        documents={documents}
                        approvals={approvals}
                        bank_accounts={bank_accounts}
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
                <div className="mt-8 pt-6 border-t border-slate-100">
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Additional Documents</h4>
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
                <div className="text-center py-12">
                    <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-slate-500">No documents uploaded yet</p>
                    <p className="text-xs text-slate-400 mt-1">The client will see their required documents in their vault</p>
                </div>
            )}
        </section>
    );
}
