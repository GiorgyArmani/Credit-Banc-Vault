"use client";

// The profile-photo onboarding step.
//
// Written as a shared onboarding step (alongside w9-sign-step and
// voided-check-step) rather than living inside the Partner+ wizard, because
// advisors and partner advisors owe the same photo and their wizards will want
// this same screen. It takes its upload action as a prop for that reason.
//
// Why a whole step for a picture: components/advisor-display.tsx renders
// advisors.profile_pic_url on the borrower's "Your Advisor" card. With no photo
// the borrower gets a grey initials circle in the one place the product claims
// a person is on the other end of their deal. staff-profile.ts records that
// while this was optional at signup, it was skipped every time.
//
// The preview is masked to a circle at the size the borrower actually sees it,
// so a rep framing a photo is looking at the real output, not a rectangle that
// gets cropped into something unflattering later.

import { useEffect, useRef, useState } from "react";
import { Camera, ImageUp, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

/** Matches updateStaffProfilePhoto's own limit and the copy below. */
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function ProfilePhotoStep({
  name,
  existingUrl,
  onSaved,
  upload,
}: {
  name: string;
  existingUrl: string | null;
  onSaved: (url: string) => void;
  upload: (formData: FormData) => Promise<{ success: boolean; url?: string; error?: string }>;
}) {
  const [saved, setSaved] = useState<string | null>(existingUrl);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Object URLs leak until revoked, and a rep can re-pick repeatedly.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Validated here as well as in the action: the point is a useful message
  // before a 2MB upload, not a second line of defence.
  const accept = (picked: File | undefined) => {
    if (!picked) return;
    if (!ACCEPT.split(",").includes(picked.type)) {
      toast.error("Use a JPG, PNG or WEBP image.");
      return;
    }
    if (picked.size > MAX_BYTES) {
      toast.error("That image is over 2MB. Try a smaller one.");
      return;
    }
    setFile(picked);
  };

  const save = async () => {
    if (!file || saving) return;
    setSaving(true);
    try {
      const data = new FormData();
      data.append("photo", file);
      const res = await upload(data);
      if (!res.success || !res.url) {
        toast.error(res.error ?? "The upload failed. Try again.");
        return;
      }
      setSaved(res.url);
      setFile(null);
      onSaved(res.url);
    } finally {
      setSaving(false);
    }
  };

  const shown = preview ?? saved;

  return (
    <div className="space-y-7">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-center gap-5 rounded-3xl border-2 border-dashed px-6 py-9 transition-colors sm:flex-row sm:gap-7 sm:px-9 ${
          dragging ? "border-cb-mint bg-cb-mint/5" : "border-black/10 bg-white"
        }`}
      >
        <div className="relative shrink-0">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: preview URLs can't go through next/image
            <img
              src={shown}
              alt="Your profile photo"
              className="h-28 w-28 rounded-full object-cover ring-4 ring-cb-mint/25"
            />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-cb-cream text-2xl font-extrabold text-cb-ink/25 ring-4 ring-black/5">
              {initials(name)}
            </div>
          )}
        </div>

        <div className="min-w-0 text-center sm:text-left">
          <p className="font-semibold text-cb-ink">
            {shown ? "This is what your clients will see." : "No photo yet."}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-cb-ink/60">
            Drag an image here, or pick one below. A clear headshot works best. JPG, PNG or WEBP, up
            to 2MB.
          </p>

          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-cb-ink transition-colors hover:bg-cb-cream"
            >
              <ImageUp className="h-4 w-4 text-cb-ink/40" />
              {shown ? "Choose another" : "Choose a photo"}
            </button>
            {/* Distinct from the picker above: on a phone this opens the camera
                straight away, which is how most reps will actually do this. */}
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-cb-ink transition-colors hover:bg-cb-cream sm:hidden"
            >
              <Camera className="h-4 w-4 text-cb-ink/40" />
              Take one now
            </button>
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept={ACCEPT}
        capture="user"
        className="hidden"
        onChange={(e) => {
          accept(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {file ? (
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cb-navy px-6 py-4 font-bold text-white shadow-lg transition-colors hover:bg-cb-navy/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-mint focus-visible:ring-offset-2 disabled:opacity-40"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving your photo&hellip;
            </>
          ) : (
            "Use this photo"
          )}
        </button>
      ) : (
        !saved && (
          <p className="text-sm font-medium text-cb-ink/40">
            Pick a photo to continue. Your clients see this on every deal you bring in.
          </p>
        )
      )}
    </div>
  );
}
