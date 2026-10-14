// src/app/admin/webinars/_components/webinar-upload-form.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { createClient } from "@/lib/supabase/client";
import {
  WEBINARS_BUCKET,
  formatBytes,
  validateWebinarFields,
  validateWebinarFile,
  webinarThumbnailPath,
} from "@/lib/webinars-shared";
import { createWebinar } from "../actions";
import { useTusUpload } from "./use-tus-upload";
import { captureThumbnail } from "./capture-thumbnail";

export function WebinarUploadForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { state, start, pause, resume, cancel, reset: resetUpload } = useTusUpload();

  const busy = state.status === "uploading" || state.status === "paused" || state.status === "error" || saving;
  const pct = state.bytesTotal ? Math.round((state.bytesSent / state.bytesTotal) * 100) : 0;

  function onPick(f: File | null) {
    setFile(f);
    setFormError(null);
    setFileError(f ? validateWebinarFile(f) : null);
  }

  function reset() {
    setFile(null);
    setFileError(null);
    setTitle("");
    setDescription("");
    setSessionDate("");
    setFormError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setFileError("Choose an MP4 file.");
    const fe = validateWebinarFile(file);
    if (fe) return setFileError(fe);
    const fields = validateWebinarFields({ title, description, session_date: sessionDate });
    if (!fields.ok) return setFormError(fields.error);
    setFormError(null);

    const id = crypto.randomUUID();
    const thumbPromise = captureThumbnail(file);

    const ok = await start(file, id);
    if (!ok) return; // cancelled — the hook already reset its state

    setSaving(true);
    try {
      let has_thumbnail = false;
      const thumb = await thumbPromise;
      if (thumb) {
        const { error } = await createClient()
          .storage.from(WEBINARS_BUCKET)
          .upload(webinarThumbnailPath(id), thumb, { contentType: "image/jpeg", upsert: false });
        if (error) toast.warning(`Saved without a thumbnail: ${error.message}`);
        else has_thumbnail = true;
      } else {
        toast.warning("Couldn't capture a thumbnail — the video will show a placeholder.");
      }

      const res = await createWebinar({
        id,
        title,
        description,
        session_date: sessionDate,
        size_bytes: file.size,
        has_thumbnail,
      });
      if (!res.success) {
        setFormError(res.error ?? "Couldn't save the webinar.");
        // Back to idle so the admin can retry with fields preserved.
        resetUpload();
        return;
      }
      toast.success("Webinar published");
      resetUpload();
      reset();
      router.refresh();
    } catch (err) {
      // A thrown server action (network drop, deploy mid-request) must not be
      // silent after a 2 GB upload. The file stays in the bucket as an orphan.
      setFormError(
        `Couldn't save the webinar — ${err instanceof Error ? err.message : String(err)}. Try again.`
      );
      resetUpload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
      <h2 className="font-headline text-lg font-extrabold">Upload a recording</h2>

      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Video (MP4, up to 2 GB)</label>
        <input
          ref={fileInput}
          type="file"
          accept="video/mp4,.mp4"
          disabled={busy}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-cb-navy file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
        />
        {file && !fileError && <p className="text-xs text-cb-gray">{file.name} · {formatBytes(file.size)}</p>}
        {fileError && <p className="text-xs font-semibold text-red-600">{fileError}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Session date</label>
          <Input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} disabled={busy} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={busy}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      {state.status !== "idle" && state.status !== "done" && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <Progress value={pct} />
          <p className="text-xs text-cb-gray">
            {pct}% · {formatBytes(state.bytesSent)} of {formatBytes(state.bytesTotal)}
            {state.status === "paused" && " · paused"}
          </p>
          {state.error && <p className="text-xs font-semibold text-red-600">{state.error}</p>}
          <div className="flex gap-2">
            {state.status === "uploading" && <Button type="button" variant="outline" size="sm" onClick={pause}>Pause</Button>}
            {(state.status === "paused" || state.status === "error") && (
              <Button type="button" variant="outline" size="sm" onClick={resume}>Resume</Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
          </div>
        </div>
      )}

      {formError && <p className="text-sm font-semibold text-red-600">{formError}</p>}

      <Button type="submit" disabled={busy || !file || !!fileError}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {saving ? "Saving…" : "Upload & publish"}
      </Button>
    </form>
  );
}
