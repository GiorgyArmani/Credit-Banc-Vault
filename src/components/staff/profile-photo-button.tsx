"use client";

// The topbar identity chip for advisors and admins — and the only place either
// can set the photo their clients actually see.
//
// It lives in the topbar rather than behind a Settings page on purpose: the
// problem being solved is that people finish signup without a photo and never
// think about it again. A grey circle they look at all day, that turns into a
// file picker when clicked, is the nudge. A settings page nobody opens is not.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { updateStaffProfilePhoto } from "@/app/actions/staff-profile";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function ProfilePhotoButton({
  name,
  photoUrl,
  roleLabel,
  showDetails = true,
}: {
  name: string;
  photoUrl: string | null;
  roleLabel: string;
  /** Hide the name/role text on cramped bars (mobile). */
  showDetails?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(photoUrl);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The parent fetches this on the server; keep in step when it re-renders.
  useEffect(() => setCurrent(photoUrl), [photoUrl]);

  // Object URLs leak until revoked, and this dialog can be opened repeatedly.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function reset() {
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    setError(null);
    if (!chosen) return setFile(null);

    // Check here as well as on the server so the common mistake costs nothing —
    // a 6MB phone photo shouldn't have to make the round trip to be rejected.
    if (chosen.size > MAX_BYTES) {
      setFile(null);
      setError("That image is over 2MB. Try a smaller one.");
      return;
    }
    setFile(chosen);
  }

  async function save() {
    if (!file) return;
    setSaving(true);
    setError(null);

    const formData = new FormData();
    formData.append("photo", file);

    const res = await updateStaffProfilePhoto(formData);
    setSaving(false);

    if (!res.success) {
      setError(res.error || "That didn't work. Try again.");
      return;
    }

    setCurrent(res.url ?? null);
    setOpen(false);
    reset();
    // Repaint the shell and anything else showing the old photo.
    router.refresh();
  }

  const shown = preview ?? current;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex items-center gap-3 rounded-full px-1 py-1 transition-colors hover:bg-slate-100"
        title="Change your profile photo"
      >
        <span className="relative">
          {current ? (
            <img
              className="h-9 w-9 rounded-full border-2 border-primary-container object-cover"
              alt={name || "Profile"}
              src={current}
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary-container bg-emerald-500 text-xs font-bold text-white">
              {name ? initials(name) : <User className="h-4 w-4" />}
            </span>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera className="h-2.5 w-2.5 text-white" />
          </span>
          {/* Nobody goes looking for a photo they forgot to add. A dot on an
              empty avatar is what makes them notice it's empty. */}
          {!current && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-400"
            />
          )}
        </span>

        {showDetails && (
          <span className="hidden text-left lg:block">
            <span className="block text-xs font-bold leading-none text-slate-900">
              {name || "Loading…"}
            </span>
            <span className="block text-[10px] uppercase tracking-tighter text-slate-500">
              {roleLabel}
            </span>
          </span>
        )}
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your profile photo</DialogTitle>
            <DialogDescription>
              This is what your clients see on their dashboard next to your name. A real
              photo does more for a first call than anything else on the page.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-5 py-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
            >
              {shown ? (
                <img
                  src={shown}
                  alt="Profile preview"
                  className="h-32 w-32 rounded-full border-4 border-white object-cover shadow-lg transition-transform group-hover:scale-105"
                />
              ) : (
                <span className="flex h-32 w-32 items-center justify-center rounded-full border-4 border-white bg-emerald-100 shadow-lg transition-transform group-hover:scale-105">
                  <User className="h-12 w-12 text-emerald-600" />
                </span>
              )}
              <span className="absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full border-4 border-white bg-emerald-500 shadow">
                <Camera className="h-4 w-4 text-white" />
              </span>
            </button>

            <p className="text-xs text-slate-400">JPG, PNG or WEBP. Max 2MB.</p>

            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              onChange={pick}
              className="hidden"
            />

            {error && (
              <p className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-sm font-medium text-rose-700">
                {error}
              </p>
            )}

            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
              >
                {current || file ? "Choose another" : "Choose a photo"}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!file || saving}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Saving…" : "Save photo"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
