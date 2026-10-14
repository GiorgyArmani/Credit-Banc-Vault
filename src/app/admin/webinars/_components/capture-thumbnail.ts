// src/app/admin/webinars/_components/capture-thumbnail.ts
"use client";

/**
 * Grab one frame (~10 s in, or the midpoint of a short clip) as a JPEG, max
 * 640 px wide. Resolves null on ANY failure — thumbnails are optional and must
 * never block an upload.
 */
export function captureThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const done = (b: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(b);
    };
    const timer = setTimeout(() => done(null), 15000);

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onerror = () => done(null);
    video.onloadedmetadata = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = Math.min(10, d / 2);
    };
    video.onseeked = () => {
      try {
        const w = Math.min(640, video.videoWidth || 640);
        const h = Math.round((w / (video.videoWidth || 16)) * (video.videoHeight || 9));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return done(null);
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob((b) => done(b), "image/jpeg", 0.8);
      } catch {
        done(null);
      }
    };
    video.src = url;
  });
}
