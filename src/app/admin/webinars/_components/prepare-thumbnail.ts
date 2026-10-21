// src/app/admin/webinars/_components/prepare-thumbnail.ts
"use client";

import { THUMBNAIL_MAX_WIDTH, MAX_THUMBNAIL_BYTES, validateThumbnailSource } from "@/lib/webinars-shared";

/**
 * Turn an admin-picked image into the stored thumbnail: JPEG, at most
 * THUMBNAIL_MAX_WIDTH wide. Unlike the auto-captured frame, a problem here is
 * an ERROR the admin sees — they chose this image on purpose.
 */
export async function prepareThumbnail(file: File): Promise<{ blob: Blob } | { error: string }> {
  const invalid = validateThumbnailSource(file);
  if (invalid) return { error: invalid };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { error: "That image couldn't be read — try saving it again as a JPG or PNG." };
  }

  try {
    const w = Math.min(THUMBNAIL_MAX_WIDTH, bitmap.width);
    const h = Math.max(1, Math.round((w / bitmap.width) * bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "Your browser couldn't process that image." };
    // JPEG has no transparency: a transparent PNG would otherwise turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return { error: "Your browser couldn't process that image." };
    if (blob.size > MAX_THUMBNAIL_BYTES) return { error: "That image is still too large after resizing — pick a simpler one." };
    return { blob };
  } finally {
    bitmap.close();
  }
}
