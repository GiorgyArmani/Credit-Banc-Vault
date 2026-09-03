"use client";

// Voided-check step — where the money lands. Shared by the partner deal-desk
// onboarding and the internal advisor onboarding; the caller supplies the
// upload server action.
//
// One file, straight to the PRIVATE `vault` bucket via that action. The file
// never touches a public URL and the browser never gets a storage token; it
// posts the bytes to the action and the server does the write.

import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp";
const MAX_BYTES = 15 * 1024 * 1024;

export function VoidedCheckStep({
  existingFilename,
  onUploaded,
  upload,
  description = "This is where your commission gets deposited. A photo of a voided check is fine, or a bank letter with your account details. PDF or image, up to 15MB.",
}: {
  existingFilename: string | null;
  onUploaded: () => void;
  upload: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
  description?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(!!existingFilename);
  const [filename, setFilename] = useState(existingFilename);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    // Checked here as well as in the action — the point is a useful message
    // before a 15MB upload, not a second line of defence.
    if (file.size > MAX_BYTES) {
      toast.error("That file is larger than 15MB.");
      return;
    }

    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const res = await upload(data);
      if (!res.success) {
        toast.error(res.error ?? "Upload failed.");
        return;
      }
      setUploaded(true);
      setFilename(file.name);
      toast.success("Voided check received.");
      onUploaded();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4 rounded-2xl border border-black/5 bg-cb-cream/60 p-6">
        <Upload className="mt-0.5 h-6 w-6 shrink-0 text-cb-mint" />
        <div className="min-w-0">
          <p className="font-semibold text-cb-ink">Upload a voided check</p>
          <p className="mt-1 text-sm leading-relaxed text-cb-ink/60">{description}</p>
        </div>
      </div>

      {uploaded && (
        <div className="flex items-start gap-4 rounded-2xl border border-cb-mint/30 bg-cb-mint/5 p-6">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-cb-mint" />
          <div className="min-w-0">
            <p className="font-semibold text-cb-ink">Voided check received.</p>
            {filename && <p className="mt-1 truncate text-sm text-cb-ink/60">{filename}</p>}
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <Button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        variant={uploaded ? "outline" : "default"}
        className={
          uploaded
            ? "rounded-xl border-black/10 px-5 py-6 font-semibold text-cb-ink/70"
            : "rounded-xl bg-cb-ink px-6 py-6 font-semibold text-cb-mint hover:bg-cb-ink/90"
        }
      >
        {uploading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading&hellip;
          </>
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" />
            {uploaded ? "Replace it" : "Choose a file"}
          </>
        )}
      </Button>
    </div>
  );
}
