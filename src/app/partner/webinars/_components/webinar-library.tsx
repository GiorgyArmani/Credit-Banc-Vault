// src/app/partner/webinars/_components/webinar-library.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlayCircle, RefreshCw } from "lucide-react";
import { formatSessionDate, type WebinarView } from "@/lib/webinars-shared";

export function WebinarLibrary({ webinars, degraded }: { webinars: WebinarView[]; degraded: boolean }) {
  const router = useRouter();
  const playerRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Look the selection up in the CURRENT props: after router.refresh() they
  // carry fresh signed URLs, and a hidden/deleted webinar simply drops out.
  const selected = selectedId ? webinars.find((w) => w.id === selectedId) ?? null : null;
  // Keyed to the URL that failed, not a boolean: a fresh URL from
  // router.refresh() clears it automatically, while a re-mount with the OLD
  // url can't flip it back on after the fresh props arrive.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = !!selected && failedUrl === selected.video_url;

  if (webinars.length === 0 && degraded) {
    return (
      <div className="rounded-2xl border border-black/5 bg-white p-10 text-center shadow-sm">
        <p className="text-sm font-semibold text-cb-ink/60">
          Couldn&apos;t load the webinars right now.
        </p>
        <button
          onClick={() => router.refresh()}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cb-mint px-4 py-2 text-sm font-bold text-cb-navy"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    );
  }

  if (webinars.length === 0) {
    return (
      <div className="rounded-2xl border border-black/5 bg-white p-10 text-center shadow-sm">
        <PlayCircle className="mx-auto mb-3 h-10 w-10 text-cb-gray/40" />
        <p className="text-sm font-semibold text-cb-ink/60">
          No webinars yet — recordings of our live sessions will appear here.
        </p>
      </div>
    );
  }

  function pick(w: WebinarView) {
    setSelectedId(w.id);
    requestAnimationFrame(() => playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="space-y-8">
      {selected && (
        <div ref={playerRef} className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
          {failed ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-cb-navy p-6 text-center text-white">
              <p className="text-sm font-semibold">Couldn&apos;t load this video — the link may have expired. Refresh to keep watching.</p>
              <button
                onClick={() => router.refresh()}
                className="inline-flex items-center gap-2 rounded-xl bg-cb-mint px-4 py-2 text-sm font-bold text-cb-navy"
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </button>
            </div>
          ) : (
            <video
              key={selected.id}
              src={selected.video_url}
              poster={selected.thumbnail_url ?? undefined}
              controls
              autoPlay
              playsInline
              preload="metadata"
              controlsList="nodownload"
              onContextMenu={(e) => e.preventDefault()}
              onError={() => setFailedUrl(selected.video_url)}
              className="aspect-video w-full bg-black"
            />
          )}
          <div className="p-5">
            <h2 className="font-headline text-xl font-extrabold">{selected.title}</h2>
            {selected.session_date && (
              <p className="text-xs font-medium text-cb-gray">{formatSessionDate(selected.session_date)}</p>
            )}
            {selected.description && (
              <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{selected.description}</p>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {webinars.map((w) => (
          <button
            key={w.id}
            onClick={() => pick(w)}
            className={`group overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition hover:shadow-md ${
              selected?.id === w.id ? "border-cb-mint" : "border-black/5"
            }`}
          >
            <div className="relative aspect-video bg-cb-navy">
              {w.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL, not optimizable
                <img src={w.thumbnail_url} alt="" className="h-full w-full object-cover" />
              ) : null}
              <div className="absolute inset-0 flex items-center justify-center">
                <PlayCircle className="h-12 w-12 text-cb-mint drop-shadow transition group-hover:scale-110" />
              </div>
            </div>
            <div className="p-4">
              <p className="font-semibold text-cb-ink">{w.title}</p>
              {w.session_date && <p className="text-xs text-cb-gray">{formatSessionDate(w.session_date)}</p>}
              {w.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{w.description}</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
