// src/app/admin/resources/_components/resource-upload-form.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import {
  PARTNER_RESOURCES_BUCKET,
  RESOURCE_ACCEPT,
  RESOURCE_TITLE_MAX,
  formatFileSize,
  resourceMimeType,
  resourceStoragePath,
  titleFromFileName,
  validateResourceFields,
  validateResourceFile,
} from "@/lib/partner-resources-shared";
import { createResource } from "../actions";

export function ResourceUploadForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onPick(f: File | null) {
    setFile(f);
    setFormError(null);
    setFileError(f ? validateResourceFile(f) : null);
    // Start the title from the file name; never overwrite one already typed.
    if (f && !title.trim()) setTitle(titleFromFileName(f.name));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setFileError("Choose a file.");
    const fe = validateResourceFile(file);
    if (fe) return setFileError(fe);
    const fields = validateResourceFields({ title, description });
    if (!fields.ok) return setFormError(fields.error);
    setFormError(null);
    setBusy(true);

    try {
      // Browser → Storage with the admin's own session: a server action can't
      // carry a file this size. A fresh id per attempt, so a retry never
      // collides with a half-finished upload.
      const id = crypto.randomUUID();
      const { error: upError } = await createClient()
        .storage.from(PARTNER_RESOURCES_BUCKET)
        .upload(resourceStoragePath(id, file.name), file, {
          contentType: resourceMimeType(file.name)!,
          upsert: false,
        });
      if (upError) {
        setFormError(`Upload failed: ${upError.message}`);
        return;
      }

      const res = await createResource({ id, title, description, file_name: file.name });
      if (!res.success) {
        setFormError(res.error ?? "Couldn't save the resource.");
        return;
      }

      toast.success("Resource published");
      setFile(null);
      setTitle("");
      setDescription("");
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch (err) {
      setFormError(`Couldn't save the resource — ${err instanceof Error ? err.message : String(err)}. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
      <h2 className="font-headline text-lg font-extrabold">Upload a resource</h2>

      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          File (PDF, Word, Excel, PowerPoint, CSV, TXT, PNG or JPG — up to 50 MB)
        </label>
        <input
          ref={fileInput}
          type="file"
          accept={RESOURCE_ACCEPT}
          disabled={busy}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-cb-navy file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
        />
        {file && !fileError && (
          <p className="text-xs text-cb-gray">
            {file.name} · {formatFileSize(file.size)}
          </p>
        )}
        {fileError && <p className="text-xs font-semibold text-red-600">{fileError}</p>}
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Title</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={RESOURCE_TITLE_MAX} disabled={busy} />
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

      {formError && <p className="text-sm font-semibold text-red-600">{formError}</p>}

      <Button type="submit" disabled={busy || !file || !!fileError}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {busy ? "Uploading…" : "Upload & publish"}
      </Button>
    </form>
  );
}
