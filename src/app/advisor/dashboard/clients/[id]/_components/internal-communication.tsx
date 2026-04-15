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
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center gap-2 mb-5 flex-shrink-0">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <svg className="h-4 w-4 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                    </svg>
                </div>
                <h3 className="text-base font-extrabold text-slate-900">Internal Communication</h3>
            </div>

            {/* Message feed */}
            <div className="flex-1 space-y-4 overflow-y-auto max-h-[420px] pr-1 mb-5 min-h-0">
                {notes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                            <svg className="h-6 w-6 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </div>
                        <p className="text-sm font-semibold text-slate-400">No notes yet</p>
                        <p className="text-xs text-slate-300 mt-1">Start the internal conversation below</p>
                    </div>
                ) : (
                    notes.map((note) => {
                        const is_advisor = note.author_role === "advisor";
                        return (
                            <div
                                key={note.id}
                                className={clsx("flex gap-2.5", is_advisor ? "flex-row-reverse" : "flex-row")}
                            >
                                {/* Avatar */}
                                <div className={clsx(
                                    "w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0 mt-1",
                                    is_advisor
                                        ? "bg-emerald-700 text-white"
                                        : "bg-slate-200 text-slate-600"
                                )}>
                                    {note.author_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                                </div>

                                {/* Bubble */}
                                <div className={clsx("max-w-[80%]", is_advisor ? "text-right" : "text-left")}>
                                    <div className={clsx(
                                        "px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
                                        is_advisor
                                            ? "bg-emerald-700 text-white rounded-tr-sm"
                                            : "bg-slate-100 text-slate-700 rounded-tl-sm"
                                    )}>
                                        {!is_advisor && (
                                            <p className={clsx(
                                                "text-[10px] font-black uppercase tracking-wider mb-1",
                                                "text-slate-500"
                                            )}>
                                                {note.author_name}
                                                <span className="font-normal text-slate-400 ml-1 capitalize">
                                                    · {note.author_role}
                                                </span>
                                            </p>
                                        )}
                                        <p className="whitespace-pre-wrap">{note.content}</p>
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1 px-1">
                                        {format(new Date(note.created_at), "MMM d, h:mm a")}
                                    </p>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Input area */}
            <div className="flex-shrink-0 mt-auto">
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                    <textarea
                        value={new_note}
                        onChange={(e) => on_note_change(e.target.value)}
                        placeholder="Write an internal note..."
                        rows={3}
                        className="w-full bg-transparent border-none outline-none resize-none text-sm text-slate-700 placeholder:text-slate-400 focus:ring-0"
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                if (new_note.trim()) on_add_note();
                            }
                        }}
                    />
                    <div className="flex justify-between items-center pt-2 border-t border-slate-200">

                        <button
                            onClick={on_add_note}
                            disabled={is_adding || !new_note.trim()}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-700/20"
                        >
                            {is_adding ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Send className="h-3.5 w-3.5" />
                            )}
                            {is_adding ? "Posting…" : "Post Note"}
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
