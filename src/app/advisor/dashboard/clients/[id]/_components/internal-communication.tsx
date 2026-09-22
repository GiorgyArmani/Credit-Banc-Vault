"use client";

import { Send, Loader2 } from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";

interface InternalNote {
    id: string;
    author_name: string;
    author_role: string;
    content: string;
    created_at: string;
}

interface InternalCommunicationProps {
    notes: InternalNote[];
    new_note: string;
    is_adding: boolean;
    on_note_change: (value: string) => void;
    on_add_note: () => void;
}

export function InternalCommunication({
    notes,
    new_note,
    is_adding,
    on_note_change,
    on_add_note,
}: InternalCommunicationProps) {
    return (
        <section className="flex h-full flex-col rounded-2xl border border-black/5 bg-white shadow-sm">
            {/* Header */}
            <header className="flex-shrink-0 border-b border-black/5 px-5 py-3.5">
                <h3 className="font-manrope text-sm font-bold text-cb-ink">Internal notes</h3>
            </header>

            {/* Message feed */}
            <div className="min-h-0 max-h-[420px] flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {notes.length === 0 ? (
                    <p className="py-3 text-sm text-cb-ink/40">No notes yet</p>
                ) : (
                    notes.map((note) => {
                        const is_advisor = note.author_role === "advisor";
                        return (
                            <div
                                key={note.id}
                                className={clsx("flex", is_advisor ? "justify-end" : "justify-start")}
                            >
                                <div className={clsx("max-w-[80%]", is_advisor ? "text-right" : "text-left")}>
                                    <div className={clsx(
                                        "rounded-xl px-3.5 py-2.5 text-left text-sm leading-relaxed text-cb-ink",
                                        is_advisor ? "bg-emerald-50" : "bg-black/[0.03]"
                                    )}>
                                        <p className="whitespace-pre-wrap">{note.content}</p>
                                    </div>
                                    <p className="mt-1 px-1 text-xs text-cb-ink/40">
                                        {note.author_name}
                                        <span className="capitalize"> · {note.author_role}</span>
                                        {" · "}
                                        {format(new Date(note.created_at), "MMM d, h:mm a")}
                                    </p>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Input area */}
            <div className="mt-auto flex-shrink-0 space-y-2 border-t border-black/5 px-5 py-4">
                <textarea
                    value={new_note}
                    onChange={(e) => on_note_change(e.target.value)}
                    placeholder="Write an internal note..."
                    rows={3}
                    className="w-full resize-none rounded-xl border border-black/10 bg-white p-3 text-sm text-cb-ink outline-none placeholder:text-cb-ink/40 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            if (new_note.trim()) on_add_note();
                        }
                    }}
                />
                <div className="flex items-center justify-end">
                    <button
                        onClick={on_add_note}
                        disabled={is_adding || !new_note.trim()}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {is_adding ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Send className="h-3.5 w-3.5" />
                        )}
                        {is_adding ? "Posting…" : "Post note"}
                    </button>
                </div>
            </div>
        </section>
    );
}
