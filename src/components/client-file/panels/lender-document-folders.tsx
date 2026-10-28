// src/components/client-file/panels/lender-document-folders.tsx
//
// Lender Documentation, as folders. These are papers the LENDERS send us — a
// lender's branded application, a COI naming them as certificate holder — so
// unlike every other section of the Documents tab there is nothing to request
// or approve, and the section never counts toward "docs approved". It is only a
// place to keep each lender's paperwork apart: one folder per lender, filled by
// dropping files from the desktop onto a folder or dragging a file between
// folders.
//
// Mounted by the underwriting file (inside UwDocumentPacket) and the admin
// client file (under DocumentUploadStatus). Self-contained apart from the data
// writes, which stay with the caller so each page keeps its own upload path and
// refresh.

"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { format } from "date-fns";
import {
    Check,
    ChevronDown,
    ChevronUp,
    Download,
    Eye,
    FileText,
    FolderClosed,
    FolderOpen,
    GripVertical,
    Loader2,
    Pencil,
    Trash2,
    UploadCloud,
    X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { DocumentGroupPicker } from "@/components/document-group-picker";
import {
    groupDocuments,
    groupsForDocCode,
    LENDER_DOCUMENTATION_DOC_CODE,
    UNGROUPED_KEY,
    type DocumentGroup,
} from "@/lib/document-groups";

/** The fields a file row needs. Both pages' document types satisfy it. */
export interface LenderFolderDoc {
    id: string;
    name: string;
    size: number;
    upload_date: string;
    custom_label: string | null;
    category?: string | null;
    doc_code?: string | null;
    document_group_id?: string | null;
    metadata?: Record<string, unknown> | null;
}

type Props<D extends LenderFolderDoc> = {
    /** Lender Documentation files only, already scoped to the active business. */
    documents: D[];
    /** Every group on the file; sliced to this field here. */
    document_groups: DocumentGroup[];
    active_business_id: string | null;
    client_vault_id?: string | null;
    can_manage: boolean;
    expanded: boolean;
    on_toggle_expand: () => void;
    lender_name_suggestions?: { name: string; hint?: string }[];
    zipping: { completed: number; total: number } | null;
    on_download_all: (docs: D[]) => void;
    on_preview: (doc: D) => void;
    on_download: (doc: D) => void;
    on_rename: (doc: D) => void;
    on_delete: (doc: D) => void;
    on_add_group: (group: DocumentGroup) => void;
    /** A folder was renamed or deleted: reload groups and files. */
    on_groups_changed: () => void;
    /** Move files into a folder (null = Unsorted). */
    on_move_to_group: (doc_ids: string[], group_id: string | null) => Promise<void>;
    /** Upload files straight into a folder. */
    on_upload_to_group: (group_id: string | null, files: File[]) => Promise<void>;
};

/** dataTransfer type carrying the ids of files dragged between folders. */
const DRAG_DOC_TYPE = "application/x-cb-document-ids";
const UNSORTED_FOLDER = "__unsorted__";

function format_file_size(bytes: number): string {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function LenderDocumentFolders<D extends LenderFolderDoc>({
    documents,
    document_groups,
    active_business_id,
    client_vault_id,
    can_manage,
    expanded,
    on_toggle_expand,
    lender_name_suggestions,
    zipping,
    on_download_all,
    on_preview,
    on_download,
    on_rename,
    on_delete,
    on_add_group,
    on_groups_changed,
    on_move_to_group,
    on_upload_to_group,
}: Props<D>) {
    const [drag_over_folder, set_drag_over_folder] = useState<string | null>(null);
    const [busy_folder, set_busy_folder] = useState<string | null>(null);
    // Inline folder rename / delete-confirm, one folder at a time.
    const [renaming, set_renaming] = useState<{ id: string; name: string } | null>(null);
    const [confirm_delete_id, set_confirm_delete_id] = useState<string | null>(null);
    const folder_input_ref = useRef<HTMLInputElement>(null);
    const folder_upload_target = useRef<string | null>(null);

    const field_groups = groupsForDocCode(document_groups, LENDER_DOCUMENTATION_DOC_CODE);
    const sections = groupDocuments(documents, field_groups, { includeEmptyGroups: true });
    const lender_folders = sections.filter((s) => s.key !== UNGROUPED_KEY);
    const unsorted = sections.find((s) => s.key === UNGROUPED_KEY);

    async function with_busy(folder_key: string, work: () => Promise<void>) {
        if (busy_folder) return;
        set_busy_folder(folder_key);
        try {
            await work();
        } finally {
            set_busy_folder(null);
        }
    }

    const group_id_of = (folder_key: string) => (folder_key === UNSORTED_FOLDER ? null : folder_key);

    async function save_rename() {
        if (!renaming) return;
        const name = renaming.name.trim();
        if (!name) {
            toast.error("Folder name can't be empty");
            return;
        }
        await with_busy(renaming.id, async () => {
            const res = await fetch(`/api/document-groups/${renaming.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            const result = await res.json().catch(() => null);
            if (!res.ok) {
                toast.error(result?.error || "Could not rename the folder");
                return;
            }
            set_renaming(null);
            on_groups_changed();
        });
    }

    async function delete_folder(group_id: string) {
        await with_busy(group_id, async () => {
            // force: the files are never deleted, only moved to Unsorted, and
            // the confirm the user just clicked already says so.
            const res = await fetch(`/api/document-groups/${group_id}?force=true`, { method: "DELETE" });
            const result = await res.json().catch(() => null);
            if (!res.ok) {
                toast.error(result?.message || result?.error || "Could not delete the folder");
                return;
            }
            set_confirm_delete_id(null);
            on_groups_changed();
        });
    }

    function drop_props(folder_key: string) {
        if (!can_manage) return {};
        return {
            onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
                const types = Array.from(e.dataTransfer.types);
                if (!types.includes("Files") && !types.includes(DRAG_DOC_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = types.includes("Files") ? "copy" : "move";
                if (drag_over_folder !== folder_key) set_drag_over_folder(folder_key);
            },
            onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    set_drag_over_folder((prev) => (prev === folder_key ? null : prev));
                }
            },
            onDrop: (e: React.DragEvent<HTMLDivElement>) => {
                e.preventDefault();
                set_drag_over_folder(null);
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length > 0) {
                    void with_busy(folder_key, () => on_upload_to_group(group_id_of(folder_key), files));
                    return;
                }
                const raw = e.dataTransfer.getData(DRAG_DOC_TYPE);
                if (!raw) return;
                let ids: unknown;
                try {
                    ids = JSON.parse(raw);
                } catch {
                    return;
                }
                if (!Array.isArray(ids)) return;
                // Dropping a file back on its own folder is a no-op, not a
                // round trip that "files 0 documents".
                const moving = ids.filter((id): id is string => {
                    const doc = documents.find((d) => d.id === id);
                    return !!doc && (doc.document_group_id ?? UNSORTED_FOLDER) !== folder_key;
                });
                if (moving.length > 0) {
                    void with_busy(folder_key, () => on_move_to_group(moving, group_id_of(folder_key)));
                }
            },
        };
    }

    function render_file(doc: D) {
        return (
            <div
                key={doc.id}
                draggable={can_manage}
                onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_DOC_TYPE, JSON.stringify([doc.id]));
                    e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => set_drag_over_folder(null)}
                className={clsx(
                    "flex items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2.5 transition-colors hover:border-black/10",
                    can_manage && "cursor-grab active:cursor-grabbing"
                )}
            >
                {can_manage && <GripVertical className="h-4 w-4 shrink-0 text-cb-ink/20" aria-hidden />}
                <FileText className="h-4 w-4 shrink-0 text-cb-ink/30" />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-cb-ink">{doc.custom_label || doc.name}</p>
                    <p className="truncate text-xs text-cb-ink/40">
                        {format_file_size(doc.size)} · {format(new Date(doc.upload_date), "MMM d, yyyy")}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => on_preview(doc)}
                        className="h-8 w-8 rounded-lg p-0 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                        title="Preview"
                    >
                        <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => on_download(doc)}
                        className="h-8 w-8 rounded-lg p-0 text-cb-ink/40 hover:bg-black/5 hover:text-cb-ink"
                        title="Download"
                    >
                        <Download className="h-4 w-4" />
                    </Button>
                    {can_manage && (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => on_rename(doc)}
                                className="h-8 w-8 rounded-lg p-0 text-cb-ink/40 hover:bg-black/5 hover:text-cb-ink"
                                title="Rename file"
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => on_delete(doc)}
                                className="h-8 w-8 rounded-lg p-0 text-cb-ink/40 hover:bg-rose-50 hover:text-rose-600"
                                title="Delete file"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </>
                    )}
                </div>
            </div>
        );
    }

    function render_folder(section: (typeof sections)[number]) {
        const is_unsorted = section.key === UNGROUPED_KEY;
        const group = section.group as DocumentGroup | undefined;
        const folder_key = is_unsorted || !group ? UNSORTED_FOLDER : group.id;
        const is_over = drag_over_folder === folder_key;
        const is_busy = busy_folder === folder_key;
        const count = section.documents.length;
        const is_renaming = !!group && renaming?.id === group.id;
        const is_confirming_delete = !!group && confirm_delete_id === group.id;

        return (
            <div
                key={folder_key}
                {...drop_props(folder_key)}
                className={clsx(
                    "rounded-2xl border transition-colors",
                    is_over
                        ? "border-emerald-400 bg-emerald-50/60 ring-2 ring-emerald-200"
                        : is_unsorted
                            ? "border-dashed border-black/10 bg-black/[0.02]"
                            : "border-black/5 bg-cb-cream/40"
                )}
            >
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div
                            className={clsx(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                                is_over ? "bg-emerald-500 text-white" : "bg-white text-cb-ink/60"
                            )}
                        >
                            {is_busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : is_over || count > 0 ? (
                                <FolderOpen className="h-4 w-4" />
                            ) : (
                                <FolderClosed className="h-4 w-4" />
                            )}
                        </div>
                        {is_renaming ? (
                            <div className="flex min-w-0 flex-1 items-center gap-1">
                                <input
                                    autoFocus
                                    value={renaming!.name}
                                    onChange={(e) => set_renaming({ id: group!.id, name: e.target.value })}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") void save_rename();
                                        if (e.key === "Escape") set_renaming(null);
                                    }}
                                    aria-label="Folder name"
                                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-slate-400"
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void save_rename()}
                                    className="h-8 w-8 rounded-lg p-0 text-emerald-600 hover:bg-emerald-50"
                                    title="Save"
                                >
                                    <Check className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => set_renaming(null)}
                                    className="h-8 w-8 rounded-lg p-0 text-cb-ink/40 hover:bg-black/5"
                                    title="Cancel"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <div className="min-w-0">
                                <p className={clsx("truncate text-sm font-semibold", is_unsorted ? "text-cb-ink/60" : "text-cb-ink")}>
                                    {is_unsorted ? "Unsorted" : section.label}
                                </p>
                                <p className="text-xs text-cb-ink/40">
                                    {count === 0 ? "Empty" : `${count} file${count === 1 ? "" : "s"}`}
                                    {is_unsorted && " · drag each into its lender's folder"}
                                </p>
                            </div>
                        )}
                    </div>

                    {is_confirming_delete ? (
                        <div className="flex shrink-0 items-center gap-2">
                            <span className="text-xs text-cb-ink/60">
                                Delete folder?{count > 0 && " Files move to Unsorted."}
                            </span>
                            <Button
                                size="sm"
                                disabled={is_busy}
                                onClick={() => void delete_folder(group!.id)}
                                className="h-8 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
                            >
                                Delete
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => set_confirm_delete_id(null)}
                                className="h-8 rounded-lg px-3 text-xs font-semibold text-cb-ink/60"
                            >
                                Cancel
                            </Button>
                        </div>
                    ) : (
                        !is_renaming && (
                            <div className="flex shrink-0 items-center gap-1.5">
                                {count > 1 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={!!zipping}
                                        onClick={() => on_download_all(section.documents as D[])}
                                        className="h-8 gap-1.5 rounded-lg border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream disabled:opacity-50"
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        Zip {count}
                                    </Button>
                                )}
                                {can_manage && !is_unsorted && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={!!busy_folder}
                                        onClick={() => {
                                            folder_upload_target.current = folder_key;
                                            if (folder_input_ref.current) {
                                                folder_input_ref.current.value = "";
                                                folder_input_ref.current.click();
                                            }
                                        }}
                                        className="h-8 gap-1.5 rounded-lg border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream"
                                    >
                                        <UploadCloud className="h-3.5 w-3.5" />
                                        Upload
                                    </Button>
                                )}
                                {can_manage && group && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                set_confirm_delete_id(null);
                                                set_renaming({ id: group.id, name: group.name });
                                            }}
                                            className="h-8 w-8 rounded-lg p-0 text-cb-ink/40 hover:bg-black/5 hover:text-cb-ink"
                                            title="Rename folder"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                set_renaming(null);
                                                set_confirm_delete_id(group.id);
                                            }}
                                            className="h-8 w-8 rounded-lg p-0 text-cb-ink/40 hover:bg-rose-50 hover:text-rose-600"
                                            title="Delete folder (files move to Unsorted)"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </>
                                )}
                            </div>
                        )
                    )}
                </div>

                <div className="space-y-2 px-4 pb-4">
                    {(section.documents as D[]).map(render_file)}
                    {count === 0 && can_manage && (
                        <div
                            className={clsx(
                                "rounded-xl border border-dashed px-4 py-3 text-center text-xs",
                                is_over ? "border-emerald-400 text-emerald-700" : "border-black/10 text-cb-ink/40"
                            )}
                        >
                            Drop {section.label}&apos;s documents here
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            id={`category-${LENDER_DOCUMENTATION_DOC_CODE}`}
            className="overflow-hidden rounded-2xl border border-black/5 bg-white"
        >
            {/* Backs each folder's Upload button. */}
            <input
                ref={folder_input_ref}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    const target = folder_upload_target.current;
                    folder_upload_target.current = null;
                    if (target && files.length > 0) {
                        void with_busy(target, () => on_upload_to_group(group_id_of(target), files));
                    }
                }}
            />

            <div
                className="flex cursor-pointer items-center justify-between p-5 transition-colors hover:bg-black/[0.02]"
                onClick={on_toggle_expand}
            >
                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cb-ink/5 text-cb-ink/70">
                        <FolderOpen className="h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="font-manrope font-bold leading-tight text-cb-ink">Lender Documentation</h3>
                        <p className="mt-1 text-xs text-cb-ink/40">
                            Received from lenders
                            {lender_folders.length > 0 &&
                                ` · ${lender_folders.length} folder${lender_folders.length === 1 ? "" : "s"}`}
                            {documents.length > 0 && ` · ${documents.length} file${documents.length === 1 ? "" : "s"}`}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {documents.length > 1 && (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!!zipping}
                            onClick={(e) => {
                                e.stopPropagation();
                                on_download_all(documents);
                            }}
                            className="h-8 gap-1.5 rounded-lg border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink hover:bg-cb-cream disabled:opacity-50"
                        >
                            {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            Zip all ({documents.length})
                        </Button>
                    )}
                    {expanded ? (
                        <ChevronUp className="h-5 w-5 text-cb-ink/40" />
                    ) : (
                        <ChevronDown className="h-5 w-5 text-cb-ink/40" />
                    )}
                </div>
            </div>

            {expanded && (
                <div className="space-y-3 px-5 pb-5">
                    {can_manage && (
                        <p className="text-xs text-cb-ink/50">
                            Drag files from your computer onto a lender&apos;s folder, or drag a file from one folder to another.
                        </p>
                    )}
                    {lender_folders.map(render_folder)}
                    {unsorted && unsorted.documents.length > 0 && render_folder(unsorted)}
                    {lender_folders.length === 0 && (
                        <p className="rounded-2xl border border-dashed border-black/10 px-4 py-6 text-center text-xs text-cb-ink/40">
                            No lender folders yet.
                        </p>
                    )}
                    {can_manage && (
                        <DocumentGroupPicker
                            docCode={LENDER_DOCUMENTATION_DOC_CODE}
                            businessProfileId={active_business_id}
                            clientVaultId={client_vault_id}
                            groups={document_groups}
                            value={null}
                            onChange={() => {}}
                            onGroupCreated={on_add_group}
                            tone="slate"
                            addOnly
                            addLabel="New lender folder"
                            nameSuggestions={lender_name_suggestions}
                            helpText={null}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
