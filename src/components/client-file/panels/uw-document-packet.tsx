// src/components/client-file/panels/uw-document-packet.tsx
//
// The underwriting document packet: one card per required category, each
// expanding into either a flat list of files or — on a field that subdivides —
// one section per group, plus the viewport-pinned bulk-assign bar and a
// Miscellaneous Files block for anything filed outside the required set.
//
// Lifted verbatim out of the underwriting client page's `render_document_card`,
// `render_group_sections` and `render_document_category` so the same packet can
// be mounted on the admin client file in phase 3. Presentational: every value
// the three helpers used to close over is a prop, so it never reads `pathname`,
// `router` or page state. Every dialog it can open (rename, delete file, edit
// group, delete group, preview) stays with the caller — this only raises the
// intent.
//
// Scoping is the caller's job: `documents` and `required_docs` arrive already
// filtered to the active business and funding round.

"use client";

import {
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Clock,
    Download,
    Eye,
    FileText,
    Loader2,
    Pencil,
    Send,
    ShieldCheck,
    Trash2,
    UploadCloud,
    XCircle,
} from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DocumentGroupPicker } from "@/components/document-group-picker";
import type { useDocumentGroups } from "@/hooks/use-document-groups";
import {
    formatGroupLabel,
    getGroupConfig,
    getDocumentPeriod,
    groupDocuments,
    groupsForDocCode,
    offersGrouping,
    UNGROUPED_KEY,
    type DocumentGroup,
} from "@/lib/document-groups";

/** A file on the client vault, as the staff document surfaces read it. */
export interface UserDocument {
    id: string;
    name: string;
    size: number;
    type: string;
    category: string | null;
    doc_code?: string | null;
    custom_label: string | null;
    upload_date: string;
    storage_path: string;
    viewed_at: string | null;
    uploaded_by_role?: 'advisor' | 'client';
    business_profile_id?: string | null;
    /** Set on files that have been filed into a group within their own field. */
    document_group_id?: string | null;
    /** Carries metadata.original_file_name, which dates a periodic file. */
    metadata?: Record<string, unknown> | null;
}

export type UwDocumentPacketProps = {
    /** Already scoped to the active business + round by the caller. */
    required_docs: { code: string; label: string }[];
    /** Already scoped to the active business + round by the caller. */
    documents: UserDocument[];
    /** Docs whose category isn't in `required_docs`. */
    misc_documents: UserDocument[];
    approvals: Set<string>;
    expanded_categories: Set<string>;
    on_toggle_expand: (code: string) => void;
    document_groups: DocumentGroup[];
    active_business_id: string | null;
    can_upload: boolean;
    // per-category actions
    approving_code: string | null;
    on_approve: (doc_type: { code: string; label: string }) => void;
    on_reject: (doc_type: { code: string; label: string }) => void;
    requesting_again_code: string | null;
    on_request_again: (doc_type: { code: string; label: string }) => void;
    inline_uploading_code: string | null;
    on_inline_upload: (code: string) => void;
    zipping: { completed: number; total: number } | null;
    on_download_all: (docs: UserDocument[]) => void;
    // file actions
    on_preview: (doc: UserDocument) => void;
    on_download: (doc: UserDocument) => void;
    on_rename: (doc: UserDocument) => void;
    on_delete: (doc: UserDocument) => void;
    // groups
    upload_group_id: string | null;
    on_upload_group_change: (id: string | null) => void;
    on_add_group: ReturnType<typeof useDocumentGroups>["addGroup"];
    selected_document_ids: Set<string>;
    on_toggle_selection: (doc_id: string) => void;
    on_toggle_section: (doc_ids: string[], select: boolean) => void;
    on_clear_selection: () => void;
    assign_target_group_id: string | null;
    on_assign_target_change: (id: string | null) => void;
    is_assigning: boolean;
    on_assign: (target_group_id: string | null) => void;
    on_edit_group: (group: { id: string; label: string;[k: string]: unknown }) => void;
    on_delete_group: (group_id: string, label: string) => void;
};

function format_file_size(bytes: number): string {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function UwDocumentPacket({
    required_docs,
    documents,
    misc_documents,
    approvals,
    expanded_categories,
    on_toggle_expand,
    document_groups,
    active_business_id,
    can_upload,
    approving_code,
    on_approve,
    on_reject,
    requesting_again_code,
    on_request_again,
    inline_uploading_code,
    on_inline_upload,
    zipping,
    on_download_all,
    on_preview,
    on_download,
    on_rename,
    on_delete,
    upload_group_id,
    on_upload_group_change,
    on_add_group,
    selected_document_ids,
    on_toggle_selection,
    on_toggle_section,
    on_clear_selection,
    assign_target_group_id,
    on_assign_target_change,
    is_assigning,
    on_assign,
    on_edit_group,
    on_delete_group,
}: UwDocumentPacketProps) {
    /**
     * render_document_card: Renders individual document card with download/preview for underwriting
     */
    function render_document_card(doc: UserDocument, options?: { selectable?: boolean }) {
        const is_selectable = options?.selectable ?? false;
        const is_selected = selected_document_ids.has(doc.id);
        // Only ever a hint — it comes from parsing the original filename, and
        // every document uploaded before that name was recorded returns null.
        const period = getDocumentPeriod(doc);

        return (
            <Card
                key={doc.id}
                className={clsx(
                    "group bg-white transition-colors hover:border-black/10",
                    is_selected ? "border-emerald-300 ring-1 ring-emerald-200" : "border-black/5"
                )}
            >
                <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                                {is_selectable && (
                                    <Checkbox
                                        checked={is_selected}
                                        onCheckedChange={() => on_toggle_selection(doc.id)}
                                        aria-label={`Select ${doc.custom_label || doc.name}`}
                                        className="flex-shrink-0"
                                    />
                                )}
                                <FileText className="h-5 w-5 shrink-0 text-cb-ink/30" />
                                <h4 className="truncate text-sm font-medium text-cb-ink">
                                    {doc.custom_label || doc.name}
                                </h4>
                                {period && (
                                    <Badge variant="outline" className="h-4 shrink-0 rounded-full border-none bg-indigo-50 px-2 text-[11px] font-semibold text-indigo-500">
                                        {period.label}
                                    </Badge>
                                )}
                                {doc.uploaded_by_role && (
                                    <Badge variant="outline" className={clsx(
                                        "h-4 shrink-0 rounded-full border-none px-2 text-[11px] font-semibold",
                                        doc.uploaded_by_role === 'advisor' ? "bg-blue-50 text-blue-600" : "bg-black/5 text-cb-ink/40"
                                    )}>
                                        {doc.uploaded_by_role === 'advisor' ? "By advisor" : "By client"}
                                    </Badge>
                                )}
                                {!doc.viewed_at && (
                                    <Badge className="h-4 shrink-0 scale-90 origin-left animate-pulse rounded-full border-none bg-emerald-500 px-2 text-[11px] font-semibold text-white">
                                        New
                                    </Badge>
                                )}
                            </div>

                            <div className="space-y-1 text-xs text-cb-ink/60">
                                <p className="truncate">{doc.name}</p>
                                <div className="flex items-center gap-3 text-cb-ink/40">
                                    <span>{format_file_size(doc.size)}</span>
                                    <span>•</span>
                                    <span>Uploaded {format(new Date(doc.upload_date), "MMM d, yyyy")}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => on_preview(doc)}
                                className="h-8 w-8 p-0 rounded-lg text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                                title="Preview document"
                            >
                                <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => on_download(doc)}
                                className="h-8 w-8 p-0 rounded-lg text-cb-ink/40 hover:bg-black/5 hover:text-cb-ink"
                                title="Download file"
                            >
                                <Download className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => on_rename(doc)}
                                className="h-8 w-8 p-0 rounded-lg text-cb-ink/40 hover:bg-black/5 hover:text-cb-ink"
                                title="Rename document"
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {can_upload && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => on_delete(doc)}
                                    className="h-8 w-8 p-0 rounded-lg text-cb-ink/40 hover:bg-rose-50 hover:text-rose-600"
                                    title="Delete document"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    /**
     * render_group_sections: a category body, cut into one section per group.
     *
     * This is the whole point of the feature for underwriting. Flat, a funded
     * file's statements are one undifferentiated scroll (124 rows on the
     * O'Rourke file) with no way to tell which account any given PDF is from —
     * and its 132 tax returns are the same problem wearing a different hat.
     * Sectioned, that list reads as four runs of twelve (or five years of
     * returns), each downloadable on its own — which is also the shape a lender
     * wants the packet in.
     *
     * The Ungrouped section is where every pre-existing file starts, so it
     * renders with its checkboxes ready.
     */
    function render_group_sections(doc_code: string, category_docs: UserDocument[]) {
        const field_groups = groupsForDocCode(document_groups, doc_code);
        const config = getGroupConfig(doc_code);
        // includeEmptyGroups: this is the management surface. A group with
        // nothing filed under it still has to be visible, because invisible
        // here means undeletable — which is exactly how a mistyped or test
        // group becomes permanent.
        const sections = groupDocuments(category_docs, field_groups, {
            includeEmptyGroups: can_upload,
        });
        const selected_count = selected_document_ids.size;

        return (
            <div className="space-y-4">
                {/* Where the next upload goes. Set before hitting Upload, so a
                    twelve-file drop lands sorted instead of needing a second pass. */}
                {can_upload && (
                    <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                        <DocumentGroupPicker
                            docCode={doc_code}
                            businessProfileId={active_business_id}
                            groups={document_groups}
                            value={upload_group_id}
                            onChange={on_upload_group_change}
                            onGroupCreated={on_add_group}
                            tone="slate"
                            helpText={`New uploads in this category are filed under this ${config.noun.toLowerCase()}. Upload one at a time.`}
                        />
                    </div>
                )}

                {sections.map(group => {
                    const group_ids = group.documents.map(d => d.id);
                    const all_selected = group_ids.every(id => selected_document_ids.has(id));
                    const is_unassigned = group.key === UNGROUPED_KEY;

                    return (
                        <div
                            key={group.key}
                            className={clsx(
                                "overflow-hidden rounded-2xl border",
                                // Ungrouped is the work queue, so it reads as
                                // something to act on rather than as a peer of
                                // the organised sections.
                                is_unassigned
                                    ? "border-dashed border-black/10 bg-black/[0.02]"
                                    : "border-black/5 bg-white"
                            )}
                        >
                            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-black/5">
                                <div className="flex items-center gap-3 min-w-0">
                                    {/* An empty group has nothing to select. */}
                                    {can_upload && group_ids.length > 0 && (
                                        <Checkbox
                                            checked={all_selected}
                                            onCheckedChange={(checked) =>
                                                on_toggle_section(group_ids, checked === true)
                                            }
                                            aria-label={`Select all in ${group.label}`}
                                        />
                                    )}
                                    <div className="min-w-0">
                                        <p className={clsx(
                                            "truncate text-sm font-semibold",
                                            is_unassigned ? "text-cb-ink/60" : "text-cb-ink"
                                        )}>
                                            {group.label}
                                        </p>
                                        <p className="text-xs text-cb-ink/40">
                                            {group.documents.length === 0
                                                ? 'Empty · no files yet'
                                                : `${group.documents.length} file${group.documents.length === 1 ? '' : 's'}`}
                                            {group.group?.subtype && ` · ${group.group.subtype}`}
                                            {is_unassigned && ' · needs sorting'}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    {group.documents.length > 1 && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={!!zipping}
                                            onClick={() => on_download_all(group.documents)}
                                            className="h-8 gap-1.5 rounded-lg border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream disabled:opacity-50"
                                        >
                                            {zipping ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                                <Download className="h-3.5 w-3.5" />
                                            )}
                                            Zip {group.documents.length}
                                        </Button>
                                    )}

                                    {/* Fix a typo in the name or the identifier.
                                        The API re-labels this group's files too,
                                        so the correction reaches the download
                                        name and the lender page. */}
                                    {can_upload && group.group && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                const g = group.group as DocumentGroup;
                                                on_edit_group({ ...g, label: group.label });
                                            }}
                                            className="h-8 w-8 p-0 rounded-lg text-cb-ink/40 hover:bg-black/5 hover:text-cb-ink"
                                            title={`Edit this ${config.noun.toLowerCase()}`}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                    )}

                                    {/* Delete the GROUP, never the files. On a
                                        loaded group the API answers 409 with
                                        the real count, which opens the confirm
                                        below — nothing is deleted on this click. */}
                                    {can_upload && group.group && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                on_delete_group(group.group!.id, group.label)
                                            }
                                            className="h-8 w-8 p-0 rounded-lg text-cb-ink/40 hover:bg-rose-50 hover:text-rose-600"
                                            title={`Delete this ${config.noun.toLowerCase()} (files move to Ungrouped)`}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {group.documents.length > 0 && (
                                <div className="p-4 space-y-3">
                                    {group.documents.map(doc =>
                                        render_document_card(doc, { selectable: can_upload })
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* The assign bar, pinned to the VIEWPORT.
                    Not `sticky`: the category card wrapping this is
                    `overflow-hidden`, which resolves sticky against a box that
                    never scrolls — the bar then sits in normal flow at the
                    bottom of a 133-row list, i.e. nowhere the user can see it.
                    `fixed` is correct here anyway: the selection is made while
                    scrolling a long list, so the action has to follow the eye.
                    Nothing in the ancestor chain sets transform/filter, so no
                    containing block hijacks it. */}
                {can_upload && selected_count > 0 && (
                    <div className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,44rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl bg-cb-ink px-4 py-3 shadow-lg">
                        <span className="shrink-0 text-xs font-semibold text-white">
                            {selected_count} selected
                        </span>
                        <span className="shrink-0 text-xs text-white/40">
                            Move to
                        </span>
                        <select
                            value={assign_target_group_id ?? ""}
                            onChange={(e) => on_assign_target_change(e.target.value || null)}
                            disabled={is_assigning}
                            className="min-w-[12rem] flex-1 rounded-lg border-0 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white outline-none disabled:opacity-60"
                        >
                            {/* Listed first so the dropdown always has a valid
                                option, but it is the un-do, not the default —
                                the target is seeded from the group picker above
                                the moment a selection starts. */}
                            <option value="" className="text-cb-ink">Ungrouped (remove from group)</option>
                            {/* This FIELD's groups only. Offering another
                                field's would be an assign the API rejects as
                                wrong_field. */}
                            {field_groups.filter(g => g.is_active).map(group_option => (
                                <option key={group_option.id} value={group_option.id} className="text-cb-ink">
                                    {formatGroupLabel(group_option)}
                                </option>
                            ))}
                        </select>
                        <Button
                            size="sm"
                            disabled={is_assigning}
                            onClick={() => on_assign(assign_target_group_id)}
                            className="h-8 shrink-0 gap-1.5 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                            {is_assigning
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : `Move ${selected_count} file${selected_count === 1 ? '' : 's'}`}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={is_assigning}
                            onClick={on_clear_selection}
                            className="h-8 shrink-0 rounded-lg px-3 text-xs font-semibold text-white/60 hover:bg-white/10 hover:text-white"
                        >
                            Clear
                        </Button>
                    </div>
                )}
            </div>
        );
    }

    /**
     * render_document_category: Renders a category section with its documents for underwriting
     */
    function render_document_category(doc_type: { code: string; label: string }) {
        const category_docs = documents.filter(d => d.category === doc_type.code);
        const has_docs = category_docs.length > 0;
        const is_approved = approvals.has(doc_type.code);
        const is_expanded = expanded_categories.has(doc_type.code);
        // A field that subdivides renders as sections; everything else stays the
        // flat list it has always been. This is the MANAGEMENT surface, so the
        // sectioned view also appears on a field with no groups yet — that empty
        // state is where the group picker and the bulk-file bar live, and
        // without it there is nowhere to start organising from.
        const is_grouped_category = offersGrouping(doc_type.code, {
            groupCount: groupsForDocCode(document_groups, doc_type.code).length,
        });

        // Define status theme
        const status = is_approved ? 'approved' : has_docs ? 'uploaded' : 'pending';

        const themes = {
            approved: "border-l-emerald-500",
            uploaded: "border-l-amber-400",
            pending: "border-l-black/10 opacity-60",
        };

        return (
            <div
                key={doc_type.code}
                id={`category-${doc_type.code}`}
                className={clsx(
                    "overflow-hidden rounded-2xl border border-black/5 border-l-2 bg-white transition-all",
                    themes[status]
                )}
            >
                {/* Category Header */}
                <div
                    className="flex items-center justify-between p-5 cursor-pointer hover:bg-black/[0.02] active:scale-[0.995] transition-all"
                    onClick={() => on_toggle_expand(doc_type.code)}
                >
                    <div className="flex items-center gap-4">
                        <div className={clsx(
                            "flex h-12 w-12 items-center justify-center rounded-2xl transition-colors",
                            status === 'approved' ? "bg-emerald-500 text-white" :
                                status === 'uploaded' ? "bg-amber-500 text-white" : "bg-black/[0.03] text-cb-ink/30"
                        )}>
                            {status === 'approved' ? <ShieldCheck className="h-6 w-6" /> :
                                status === 'uploaded' ? <CheckCircle2 className="h-6 w-6" /> : <Clock className="h-6 w-6" />}
                        </div>
                        <div>
                            <h3 className="font-manrope font-bold leading-tight text-cb-ink">{doc_type.label}</h3>
                            <div className="flex items-center gap-2 mt-1">
                                {/* "Verified", not "Advisor Verified": UW and admin
                                    approve here too, and a staff upload is approved
                                    on the spot. The approvals table records who
                                    (approved_by) but not their role, so naming one
                                    role in the badge was already a guess. */}
                                <p className="text-xs text-cb-ink/40">
                                    {status === 'approved' ? 'Verified' :
                                        status === 'uploaded' ? 'Ready for audit' : 'Awaiting submission'}
                                </p>
                                {has_docs && (
                                    <>
                                        <div className="h-1 w-1 rounded-full bg-cb-ink/20" />
                                        <p className="text-xs text-cb-ink/60">
                                            {category_docs.length} file{category_docs.length > 1 ? 's' : ''}
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Approve — only while files are sitting unreviewed. */}
                        {can_upload && status === 'uploaded' && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={approving_code === doc_type.code}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    on_approve(doc_type);
                                }}
                                className="h-8 gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                            >
                                {approving_code === doc_type.code ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <ShieldCheck className="h-3.5 w-3.5" />
                                )}
                                Approve
                            </Button>
                        )}
                        {/* Reject — the other half of the same decision, so it
                            appears in exactly the states Approve does. The
                            handler is wired in a later task. */}
                        {can_upload && status === 'uploaded' && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={approving_code === doc_type.code}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    on_reject(doc_type);
                                }}
                                className="h-8 gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                            >
                                <XCircle className="h-3.5 w-3.5" />
                                Reject
                            </Button>
                        )}
                        {/* Request this doc from the client + upload it (admin + UW),
                            mirroring the advisor view */}
                        {can_upload && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={requesting_again_code === doc_type.code}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    on_request_again(doc_type);
                                }}
                                className="h-8 gap-1.5 rounded-lg border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream"
                            >
                                {requesting_again_code === doc_type.code ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Send className="h-3.5 w-3.5" />
                                )}
                                Request
                            </Button>
                        )}
                        {can_upload && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={inline_uploading_code === doc_type.code}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    on_inline_upload(doc_type.code);
                                }}
                                className="h-8 gap-1.5 rounded-lg border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream"
                            >
                                {inline_uploading_code === doc_type.code ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <UploadCloud className="h-3.5 w-3.5" />
                                )}
                                Upload
                            </Button>
                        )}

                        {/* Download All — one ZIP, not N browser downloads. */}
                        {has_docs && category_docs.length > 1 && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={!!zipping}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    on_download_all(category_docs);
                                }}
                                className="h-8 gap-1.5 rounded-lg border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream disabled:opacity-50"
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
                            </Button>
                        )}

                        <div className="w-px h-6 bg-black/10 mx-1" />

                        {is_expanded ? <ChevronUp className="h-5 w-5 text-cb-ink/40" /> : <ChevronDown className="h-5 w-5 text-cb-ink/40" />}
                    </div>
                </div>

                {/* Docs List if expanded */}
                {is_expanded && has_docs && (
                    <div className="px-5 pb-5 space-y-3">
                        {is_grouped_category
                            ? render_group_sections(doc_type.code, category_docs)
                            : category_docs.map(doc => render_document_card(doc))}
                    </div>
                )}

                {/* The group picker is the only thing worth showing in an empty
                    subdividable category — it lets UW set the groups up before
                    the client uploads anything. */}
                {is_expanded && !has_docs && is_grouped_category && can_upload && (
                    <div className="px-5 pb-5">
                        <div className="rounded-2xl border border-black/10 bg-white/70 p-4">
                            <DocumentGroupPicker
                                docCode={doc_type.code}
                                businessProfileId={active_business_id}
                                groups={document_groups}
                                value={upload_group_id}
                                onChange={on_upload_group_change}
                                onGroupCreated={on_add_group}
                                tone="slate"
                                helpText="Set these up now and uploads will file themselves."
                            />
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <>
            <div className="space-y-4 p-6">
                {required_docs.map((doc_type) => render_document_category(doc_type))}
            </div>

            {/* Anything filed outside the required set. Its own block rather
                than its own card, because the packet is one panel now. */}
            {misc_documents.length > 0 && (
                <div className="px-6 pb-6">
                    <h3 className="mb-3 font-manrope text-sm font-bold text-cb-ink">
                        Miscellaneous files
                    </h3>
                    <div className="grid grid-cols-1 gap-4">
                        {misc_documents.map(doc => render_document_card(doc))}
                    </div>
                </div>
            )}
        </>
    );
}
