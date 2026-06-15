"use client";

// Lender response panel — UW records what came back from a lender on one
// assignment: a typed note (offer / stips / requested docs when approved, or
// decline reasons when declined) plus screenshots evidencing it. Self-contained:
// fetches its own note + attachments lazily on first expand, so dropping it into
// a list of lender rows costs nothing until opened.

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  MessageSquare,
  Loader2,
  ImagePlus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Save,
} from "lucide-react";
import clsx from "clsx";
import { FilePreviewModal } from "@/components/file-preview-modal";

interface Attachment {
  id: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
  view_url: string;
}

interface Props {
  assignmentId: string;
  /** Drives the note label: approved → offer/stips, declined → decline reasons. */
  status: string;
}

const NOTE_BUCKET = "user-documents";

function note_label(status: string): { title: string; placeholder: string } {
  if (status === "approved_by_lender")
    return {
      title: "Offer / stips / requested documents",
      placeholder: "Approved terms, stipulations, and any documents the lender requested…",
    };
  if (status === "declined_by_lender")
    return {
      title: "Decline reasons",
      placeholder: "Why the lender declined this file…",
    };
  return {
    title: "Lender response note",
    placeholder: "Anything the lender said about this file…",
  };
}

export function LenderResponsePanel({ assignmentId, status }: Props) {
  const supabase = createClient();
  const [open, set_open] = useState(false);
  const [loaded, set_loaded] = useState(false);
  const [loading, set_loading] = useState(false);
  const [notes, set_notes] = useState("");
  const [saved_notes, set_saved_notes] = useState("");
  const [saving, set_saving] = useState(false);
  const [attachments, set_attachments] = useState<Attachment[]>([]);
  const [uploading, set_uploading] = useState(false);
  const [deleting_id, set_deleting_id] = useState<string | null>(null);
  const [preview, set_preview] = useState<Attachment | null>(null);

  const { title, placeholder } = note_label(status);
  const dirty = notes.trim() !== saved_notes.trim();

  async function load() {
    set_loading(true);
    try {
      const res = await fetch(`/api/lender-assignments/${assignmentId}/response-detail`);
      const data = await res.json();
      if (res.ok && data.success) {
        set_notes(data.response_notes ?? "");
        set_saved_notes(data.response_notes ?? "");
        set_attachments(data.attachments ?? []);
        set_loaded(true);
      }
    } catch (err) {
      console.error("load lender response error:", err);
    } finally {
      set_loading(false);
    }
  }

  function toggle() {
    const next = !open;
    set_open(next);
    if (next && !loaded) load();
  }

  async function save_notes() {
    set_saving(true);
    try {
      const res = await fetch(`/api/lender-assignments/${assignmentId}/response-detail`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_notes: notes }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data?.error || "Failed to save note");
        return;
      }
      set_saved_notes(notes.trim());
      toast.success("Response note saved");
    } catch (err) {
      console.error("save lender note error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      set_saving(false);
    }
  }

  async function on_file(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    set_uploading(true);
    try {
      // 1. Sign
      const sign_res = await fetch(
        `/api/lender-assignments/${assignmentId}/attachments/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: file.name }),
        }
      );
      const sign = await sign_res.json();
      if (!sign_res.ok || !sign.success) {
        toast.error(sign?.error || "Couldn't start upload");
        return;
      }
      // 2. Upload straight to storage
      const { error: up_err } = await supabase.storage
        .from(NOTE_BUCKET)
        .uploadToSignedUrl(sign.file_path, sign.token, file);
      if (up_err) {
        console.error("upload error:", up_err);
        toast.error("Upload failed");
        return;
      }
      // 3. Register
      const reg_res = await fetch(
        `/api/lender-assignments/${assignmentId}/attachments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storage_path: sign.file_path,
            file_name: file.name,
            file_type: file.type,
            file_size: file.size,
          }),
        }
      );
      const reg = await reg_res.json();
      if (!reg_res.ok || !reg.success) {
        toast.error(reg?.error || "Couldn't save screenshot");
        return;
      }
      set_attachments(reg.attachments ?? []);
      toast.success("Screenshot added");
    } catch (err) {
      console.error("attachment upload error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      set_uploading(false);
    }
  }

  async function remove(attachment_id: string) {
    set_deleting_id(attachment_id);
    try {
      const res = await fetch(
        `/api/lender-assignments/${assignmentId}/attachments?attachment_id=${attachment_id}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data?.error || "Failed to remove");
        return;
      }
      set_attachments(data.attachments ?? []);
    } catch (err) {
      console.error("delete attachment error:", err);
      toast.error("An unexpected error occurred");
    } finally {
      set_deleting_id(null);
    }
  }

  const summary_count =
    (saved_notes.trim() ? 1 : 0) + attachments.length; // hint shown on the toggle

  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-emerald-600 transition-colors"
      >
        <MessageSquare className="h-3 w-3" />
        Lender response
        {loaded && summary_count > 0 && (
          <span className="text-emerald-600">· {summary_count}</span>
        )}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
          {loading ? (
            <div className="py-4 text-center">
              <Loader2 className="h-4 w-4 text-emerald-500 animate-spin mx-auto" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {title}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => set_notes(e.target.value)}
                  placeholder={placeholder}
                  rows={3}
                  maxLength={5000}
                  className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-emerald-400 resize-y"
                />
                <div className="flex justify-end">
                  <button
                    onClick={save_notes}
                    disabled={saving || !dirty}
                    className={clsx(
                      "inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-colors",
                      dirty
                        ? "bg-emerald-500 hover:bg-emerald-600 text-white"
                        : "bg-slate-100 text-slate-400 cursor-default"
                    )}
                  >
                    {saving ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    Save note
                  </button>
                </div>
              </div>

              {/* Screenshots */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    Screenshots
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700 cursor-pointer">
                    {uploading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ImagePlus className="h-3 w-3" />
                    )}
                    Add image
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      disabled={uploading}
                      onChange={on_file}
                    />
                  </label>
                </div>
                {attachments.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No screenshots yet.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {attachments.map((a) => {
                      const is_image = (a.file_type ?? "").startsWith("image/");
                      return (
                        <div
                          key={a.id}
                          className="relative group rounded-lg border border-slate-200 overflow-hidden bg-white"
                        >
                          <button
                            type="button"
                            onClick={() => set_preview(a)}
                            className="block w-full"
                            title="Preview"
                          >
                            {is_image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={a.view_url}
                                alt={a.file_name ?? "screenshot"}
                                className="h-20 w-full object-cover"
                              />
                            ) : (
                              <div className="h-20 w-full flex items-center justify-center text-[10px] font-bold text-slate-500 px-2 text-center">
                                {a.file_name ?? "File"}
                              </div>
                            )}
                          </button>
                          <button
                            onClick={() => remove(a.id)}
                            disabled={deleting_id === a.id}
                            title="Remove"
                            className="absolute top-1 right-1 w-6 h-6 rounded-md bg-white/90 flex items-center justify-center text-slate-400 hover:text-red-600 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-100"
                          >
                            {deleting_id === a.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <FilePreviewModal
        isOpen={!!preview}
        onClose={() => set_preview(null)}
        name={preview?.file_name ?? "Screenshot"}
        url={preview?.view_url ?? null}
        fileType={preview?.file_type}
      />
    </div>
  );
}
