// src/app/admin/webinars/_components/webinar-upload-form.tsx
"use client";

import { useEffect, useRef, useState } from "react";
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
import { useDirectUpload } from "./use-direct-upload";
import { captureThumbnail } from "./capture-thumbnail";
import { prepareThumbnail } from "./prepare-thumbnail";

export function WebinarUploadForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const thumbInput = useRef<HTMLInputElement>(null);
  // Optional admin-chosen thumbnail; without one we capture a frame from the video.
  const [thumbBlob, setThumbBlob] = useState<Blob | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { state, start, cancel, reset: resetUpload } = useDirectUpload();

  // An error is NOT busy: the fields stay editable and Upload retries with a fresh id.
  const busy = state.status === "uploading" || saving;

  useEffect(
    () => () => {
      if (thumbPreview) URL.revokeObjectURL(thumbPreview);
    },
    [thumbPreview]
  );

  async function onPickThumb(f: File | null) {
    setThumbError(null);
    setThumbBlob(null);
    setThumbPreview(null);
    if (!f) return;
    setThumbBusy(true);
    const res = await prepareThumbnail(f);
    setThumbBusy(false);
    if ("error" in res) {
      setThumbError(res.error);
      return;
    }
    setThumbBlob(res.blob);
    setThumbPreview(URL.createObjectURL(res.blob));
  }

  function clearThumb() {
    setThumbBlob(null);
    setThumbPreview(null);
    setThumbError(null);
    if (thumbInput.current) thumbInput.current.value = "";
  }
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
    clearThumb();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setFileError("Choose an MP4 file.");
    const fe = validateWebinarFile(file);
    if (fe) return setFileError(fe);
    const fields = validateWebinarFields({ title, description, session_date: sessionDate });
    if (!fields.ok) return setFormError(fields.error);
    if (thumbError) return setFormError("Fix or remove the thumbnail image first.");
    if (thumbBusy) return setFormError("The thumbnail is still being prepared — try again in a moment.");
    setFormError(null);

    const id = crypto.randomUUID();
    const customThumb = thumbBlob;
    const thumbPromise = customThumb ? Promise.resolve(customThumb) : captureThumbnail(file);

    const ok = await start(file, id);
    if (!ok) return; // failed (error shown in the progress panel) or cancelled

    setSaving(true);
    try {
      let has_thumbnail = false;
      const thumb = await thumbPromise;
      if (thumb) {
        const { error } = await createClient()
          .storage.from(WEBINARS_BUCKET)
          .upload(webinarThumbnailPath(id), thumb, { contentType: "image/jpeg", upsert: false });
        if (error) {
          toast.warning(
            customThumb
              ? `Saved without your thumbnail (${error.message}) — use "Change thumbnail" on the webinar to add it.`
              : `Saved without a thumbnail: ${error.message}`
          );
        } else has_thumbnail = true;
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
        <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          Thumbnail image (optional — JPG, PNG or WebP)
        </label>
        <div className="flex items-start gap-3">
          <div className="h-20 w-36 shrink-0 overflow-hidden rounded-lg bg-slate-100">
            {thumbPreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob preview
              <img src={thumbPreview} alt="Thumbnail preview" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-cb-gray">
                {thumbBusy ? "Preparing…" : "A frame from the video"}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <input
              ref={thumbInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              disabled={busy}
              onChange={(e) => void onPickThumb(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-sm file:font-semibold"
            />
            {(thumbBlob || thumbError) && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={clearThumb}>
                Use a frame from the video instead
              </Button>
            )}
            {thumbError && <p className="text-xs font-semibold text-red-600">{thumbError}</p>}
          </div>
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
          </p>
          {state.error && <p className="text-xs font-semibold text-red-600">{state.error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              {state.status === "error" ? "Dismiss" : "Cancel"}
            </Button>
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
