"use client";

import { useState } from "react";
import { Pencil, Check, X, Send, Loader2, Plus } from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";

export interface FileNote {
    id: string;
    author_name: string;
    author_role: string;
    content: string;
    created_at: string;
}

interface ClientNotesCardProps {
    loan_purpose: string;
    additional_notes: string;
    file_notes: FileNote[];
    new_file_note: string;
    is_adding_file_note: boolean;
    on_new_file_note_change: (value: string) => void;
    on_add_file_note: () => void;
    on_save_signup_notes: (patch: {
        loan_purpose?: string;
        additional_notes?: string;
    }) => Promise<boolean>;
}

type EditableField = "loan_purpose" | "additional_notes";

export function ClientNotesCard({
    loan_purpose,
    additional_notes,
    file_notes,
    new_file_note,
    is_adding_file_note,
    on_new_file_note_change,
    on_add_file_note,
    on_save_signup_notes,
}: ClientNotesCardProps) {
    const [editing, set_editing] = useState<EditableField | null>(null);
    const [draft, set_draft] = useState("");
    const [saving, set_saving] = useState(false);

    const start_edit = (field: EditableField, current: string) => {
        set_editing(field);
        set_draft(current || "");
    };

    const cancel_edit = () => {
        set_editing(null);
        set_draft("");
    };

    const save_edit = async () => {
        if (!editing) return;
        set_saving(true);
        const ok = await on_save_signup_notes({ [editing]: draft } as any);
        set_saving(false);
        if (ok) {
            set_editing(null);
            set_draft("");
        }
    };

    return (
        <section className="p-5">
            {/* Section A — Signup Notes (inline editable) */}
            <div className="divide-y divide-black/5">
                <SignupNoteField
                    label="Loan purpose"
                    description="Captured during client signup"
                    value={loan_purpose}
                    is_editing={editing === "loan_purpose"}
                    draft={draft}
                    saving={saving}
                    on_edit={() => start_edit("loan_purpose", loan_purpose)}
                    on_draft_change={set_draft}
                    on_save={save_edit}
                    on_cancel={cancel_edit}
                />
                <SignupNoteField
                    label="Additional notes"
                    description="Captured during client signup"
                    value={additional_notes}
                    is_editing={editing === "additional_notes"}
                    draft={draft}
                    saving={saving}
                    on_edit={() => start_edit("additional_notes", additional_notes)}
                    on_draft_change={set_draft}
                    on_save={save_edit}
                    on_cancel={cancel_edit}
                />
            </div>

            {/* Section B — File Notes Timeline */}
            <div className="mt-2 flex items-center gap-2 border-t border-black/5 pt-4">
                <h4 className="text-sm font-semibold text-cb-ink">File notes</h4>
                <span className="rounded-full bg-black/5 px-1.5 text-[11px] text-cb-ink/60 tabular-nums">
                    {file_notes.length}
                </span>
            </div>

            <div className="mb-3 max-h-[320px] divide-y divide-black/5 overflow-y-auto pr-1">
                {file_notes.length === 0 ? (
                    <p className="py-3 text-sm text-cb-ink/40">No file notes yet</p>
                ) : (
                    file_notes.map((note) => (
                        <div key={note.id} className="py-3">
                            <p className="text-xs text-cb-ink/40">
                                <span className="font-medium text-cb-ink/60">{note.author_name}</span>
                                <span className="capitalize"> · {note.author_role}</span>
                                {" · "}
                                {format(new Date(note.created_at), "MMM d, h:mm a")}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-cb-ink">
                                {note.content}
                            </p>
                        </div>
                    ))
                )}
            </div>

            {/* Add note input */}
            <div className="space-y-2">
                <textarea
                    value={new_file_note}
                    onChange={(e) => on_new_file_note_change(e.target.value)}
                    placeholder="Add a note to this client file..."
                    rows={3}
                    className="w-full resize-none rounded-xl border border-black/10 bg-white p-3 text-sm text-cb-ink outline-none placeholder:text-cb-ink/40 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            if (new_file_note.trim()) on_add_file_note();
                        }
                    }}
                />
                <div className="flex items-center justify-end">
                    <button
                        onClick={on_add_file_note}
                        disabled={is_adding_file_note || !new_file_note.trim()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {is_adding_file_note ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Send className="h-3.5 w-3.5" />
                        )}
                        {is_adding_file_note ? "Adding…" : "Add note"}
                    </button>
                </div>
            </div>
        </section>
    );
}

interface SignupNoteFieldProps {
    label: string;
    description: string;
    value: string;
    is_editing: boolean;
    draft: string;
    saving: boolean;
    on_edit: () => void;
    on_draft_change: (v: string) => void;
    on_save: () => void;
    on_cancel: () => void;
}

function SignupNoteField({
    label,
    description,
    value,
    is_editing,
    draft,
    saving,
    on_edit,
    on_draft_change,
    on_save,
    on_cancel,
}: SignupNoteFieldProps) {
    return (
        <div className="py-3 first:pt-0">
            <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-cb-ink/50" title={description}>
                    {label}
                </p>
                {!is_editing && (
                    <button
                        onClick={on_edit}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                    >
                        {value ? (
                            <>
                                <Pencil className="h-3 w-3" /> Edit
                            </>
                        ) : (
                            <>
                                <Plus className="h-3 w-3" /> Add
                            </>
                        )}
                    </button>
                )}
            </div>

            {is_editing ? (
                <div className="mt-2 space-y-2">
                    <textarea
                        value={draft}
                        onChange={(e) => on_draft_change(e.target.value)}
                        rows={4}
                        autoFocus
                        className="w-full resize-y rounded-xl border border-black/10 bg-white p-3 text-sm text-cb-ink outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                        placeholder={`Enter ${label.toLowerCase()}...`}
                    />
                    <div className="flex items-center justify-end gap-2">
                        <button
                            onClick={on_cancel}
                            disabled={saving}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-xs font-semibold text-cb-ink transition-colors hover:bg-cb-cream disabled:opacity-50"
                        >
                            <X className="h-3.5 w-3.5" />
                            Cancel
                        </button>
                        <button
                            onClick={on_save}
                            disabled={saving}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                        >
                            {saving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Check className="h-3.5 w-3.5" />
                            )}
                            {saving ? "Saving…" : "Save"}
                        </button>
                    </div>
                </div>
            ) : (
                <p
                    className={clsx(
                        "mt-0.5 whitespace-pre-wrap text-sm leading-relaxed",
                        value ? "text-cb-ink" : "text-cb-ink/40"
                    )}
                >
                    {value || "—"}
                </p>
            )}
        </div>
    );
}
