"use client";

import { useState } from "react";
import { FileText, Pencil, Check, X, Send, Loader2, Plus } from "lucide-react";
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
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            {/* Header */}
            <div className="flex items-center gap-2 mb-5">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <FileText className="h-4 w-4 text-emerald-700" />
                </div>
                <h3 className="text-base font-extrabold text-slate-900">Client Notes</h3>
            </div>

            {/* Section A — Signup Notes (inline editable) */}
            <div className="space-y-4">
                <SignupNoteField
                    label="Loan Purpose"
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
                    label="Additional Notes"
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

            {/* Divider */}
            <div className="my-6 border-t border-slate-100" />

            {/* Section B — File Notes Timeline */}
            <div className="flex items-center gap-2 mb-4">
                <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">
                    File Notes
                </h4>
                <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    {file_notes.length}
                </span>
            </div>

            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1 mb-4">
                {file_notes.length === 0 ? (
                    <div className="text-sm text-slate-400 italic py-6 text-center">
                        No file notes yet. Add the first one below.
                    </div>
                ) : (
                    file_notes.map((note) => (
                        <div
                            key={note.id}
                            className="bg-slate-50 border border-slate-100 rounded-xl p-3.5"
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <div className="w-6 h-6 rounded-full bg-emerald-700 text-white flex items-center justify-center text-[9px] font-black">
                                    {note.author_name
                                        .split(" ")
                                        .map((n) => n[0])
                                        .join("")
                                        .toUpperCase()
                                        .slice(0, 2)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-slate-800 leading-tight">
                                        {note.author_name}
                                        <span className="font-normal text-slate-400 ml-1 capitalize">
                                            · {note.author_role}
                                        </span>
                                    </p>
                                    <p className="text-[10px] text-slate-400">
                                        {format(new Date(note.created_at), "MMM d, h:mm a")}
                                    </p>
                                </div>
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                {note.content}
                            </p>
                        </div>
                    ))
                )}
            </div>

            {/* Add note input */}
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                <textarea
                    value={new_file_note}
                    onChange={(e) => on_new_file_note_change(e.target.value)}
                    placeholder="Add a note to this client file..."
                    rows={3}
                    className="w-full bg-transparent border-none outline-none resize-none text-sm text-slate-700 placeholder:text-slate-400 focus:ring-0"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            if (new_file_note.trim()) on_add_file_note();
                        }
                    }}
                />
                <div className="flex justify-end items-center pt-2 border-t border-slate-200">
                    <button
                        onClick={on_add_file_note}
                        disabled={is_adding_file_note || !new_file_note.trim()}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-700/20"
                    >
                        {is_adding_file_note ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Send className="h-3.5 w-3.5" />
                        )}
                        {is_adding_file_note ? "Adding…" : "Add Note"}
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
        <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
            <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                    <p className="text-xs font-black uppercase tracking-wider text-slate-700">
                        {label}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{description}</p>
                </div>
                {!is_editing && (
                    <button
                        onClick={on_edit}
                        className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 px-2 py-1 rounded-lg hover:bg-emerald-50 transition-colors"
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
                <div className="space-y-2">
                    <textarea
                        value={draft}
                        onChange={(e) => on_draft_change(e.target.value)}
                        rows={4}
                        autoFocus
                        className="w-full bg-white border border-slate-200 rounded-lg p-3 text-sm text-slate-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 resize-y"
                        placeholder={`Enter ${label.toLowerCase()}...`}
                    />
                    <div className="flex items-center justify-end gap-2">
                        <button
                            onClick={on_cancel}
                            disabled={saving}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                        >
                            <X className="h-3.5 w-3.5" />
                            Cancel
                        </button>
                        <button
                            onClick={on_save}
                            disabled={saving}
                            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
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
                        "text-sm whitespace-pre-wrap leading-relaxed",
                        value ? "text-slate-700" : "text-slate-400 italic"
                    )}
                >
                    {value || `No ${label.toLowerCase()} captured.`}
                </p>
            )}
        </div>
    );
}
