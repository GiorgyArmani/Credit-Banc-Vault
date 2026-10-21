// src/app/admin/webinars/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  WEBINARS_BUCKET,
  MAX_WEBINAR_BYTES,
  isWebinarId,
  validateWebinarFields,
  webinarVideoPath,
  webinarThumbnailPath,
  MAX_THUMBNAIL_BYTES,
  isJpegBytes,
} from "@/lib/webinars-shared";

type ActionResult = { success: boolean; error?: string };

async function requireAdminUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return userRow?.role === "admin" ? user : null;
}

function revalidate() {
  revalidatePath("/admin/webinars");
  revalidatePath("/partner/webinars");
}

async function objectExists(
  db: ReturnType<typeof createAdminClient>,
  folder: string,
  file: string
): Promise<boolean> {
  const { data, error } = await db.storage
    .from(WEBINARS_BUCKET)
    .list(folder, { search: file, limit: 10 });
  if (error) {
    console.error("webinars: list for existence check failed:", error);
    return false;
  }
  return (data ?? []).some((o) => o.name === file);
}

/**
 * Called AFTER the browser finished uploading. Verifies the file really landed
 * before inserting, so a row can never point at a missing video. On any insert
 * failure the uploaded objects are removed — no orphans either way.
 */
export async function createWebinar(input: {
  id: string;
  title: string;
  description?: string;
  session_date?: string;
  size_bytes: number;
  has_thumbnail: boolean;
}): Promise<ActionResult> {
  const user = await requireAdminUser();
  if (!user) return { success: false, error: "Only admins can add webinars." };

  if (!isWebinarId(input.id)) return { success: false, error: "Invalid upload id." };
  const size = Number(input.size_bytes);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_WEBINAR_BYTES) {
    return { success: false, error: "Invalid file size." };
  }
  const fields = validateWebinarFields(input);
  if (!fields.ok) return { success: false, error: fields.error };

  const db = createAdminClient();
  const video_path = webinarVideoPath(input.id);
  const thumb_path = webinarThumbnailPath(input.id);

  if (!(await objectExists(db, "videos", `${input.id}.mp4`))) {
    return { success: false, error: "The video didn't finish uploading — try the upload again." };
  }
  const has_thumb = input.has_thumbnail && (await objectExists(db, "thumbnails", `${input.id}.jpg`));

  const { error } = await db.from("webinars").insert({
    id: input.id,
    ...fields.value,
    video_path,
    thumbnail_path: has_thumb ? thumb_path : null,
    size_bytes: size,
    is_published: true,
    created_by: user.id,
  });

  if (error) {
    console.error("createWebinar insert failed:", error);
    const { error: rm } = await db.storage.from(WEBINARS_BUCKET).remove([video_path, thumb_path]);
    if (rm) console.error("createWebinar cleanup failed:", rm);
    return { success: false, error: `Couldn't save the webinar: ${error.message}` };
  }

  revalidate();
  return { success: true };
}

export async function updateWebinar(input: {
  id: string;
  title: string;
  description?: string;
  session_date?: string;
}): Promise<ActionResult> {
  if (!(await requireAdminUser())) return { success: false, error: "Only admins can edit webinars." };
  if (!isWebinarId(input.id)) return { success: false, error: "Invalid webinar id." };
  const fields = validateWebinarFields(input);
  if (!fields.ok) return { success: false, error: fields.error };

  const { data, error } = await createAdminClient()
    .from("webinars")
    .update({ ...fields.value, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .select("id");
  if (error) return { success: false, error: error.message };
  if (!data?.length) return { success: false, error: "That webinar no longer exists." };

  revalidate();
  return { success: true };
}

/**
 * Replace (or add) a webinar's thumbnail with an admin-chosen image, already
 * re-encoded to JPEG in the browser. Goes through the service role because
 * admins' storage policy is INSERT-only — overwriting needs more than that.
 */
export async function setWebinarThumbnail(formData: FormData): Promise<ActionResult> {
  if (!(await requireAdminUser())) return { success: false, error: "Only admins can change thumbnails." };
  const id = formData.get("id");
  const image = formData.get("image");
  if (!isWebinarId(id)) return { success: false, error: "Invalid webinar id." };
  if (!(image instanceof Blob) || image.size === 0) return { success: false, error: "No image was received." };
  if (image.size > MAX_THUMBNAIL_BYTES) return { success: false, error: "That image is too large." };

  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!isJpegBytes(bytes)) return { success: false, error: "The image wasn't converted to JPEG — reload the page and try again." };

  const db = createAdminClient();
  const { data: existing, error: readError } = await db.from("webinars").select("id").eq("id", id).maybeSingle();
  if (readError) return { success: false, error: readError.message };
  if (!existing) return { success: false, error: "That webinar no longer exists." };

  const thumb_path = webinarThumbnailPath(id);
  const { error: upError } = await db.storage
    .from(WEBINARS_BUCKET)
    .upload(thumb_path, bytes, { contentType: "image/jpeg", upsert: true });
  if (upError) {
    console.error("setWebinarThumbnail upload failed:", upError);
    return { success: false, error: `Couldn't save the thumbnail: ${upError.message}` };
  }

  const { error } = await db
    .from("webinars")
    .update({ thumbnail_path: thumb_path, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { success: false, error: error.message };

  revalidate();
  return { success: true };
}

export async function setWebinarPublished(id: string, published: boolean): Promise<ActionResult> {
  if (!(await requireAdminUser())) return { success: false, error: "Only admins can change webinars." };
  if (!isWebinarId(id)) return { success: false, error: "Invalid webinar id." };

  const { data, error } = await createAdminClient()
    .from("webinars")
    .update({ is_published: published === true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return { success: false, error: error.message };
  if (!data?.length) return { success: false, error: "That webinar no longer exists." };

  revalidate();
  return { success: true };
}

/**
 * Files first, then the row. If storage removal fails the row stays and the
 * admin sees the error — a row without its file is worse than a stray file.
 */
export async function deleteWebinar(id: string): Promise<ActionResult> {
  if (!(await requireAdminUser())) return { success: false, error: "Only admins can delete webinars." };
  if (!isWebinarId(id)) return { success: false, error: "Invalid webinar id." };

  const db = createAdminClient();
  const { error: rm } = await db.storage
    .from(WEBINARS_BUCKET)
    .remove([webinarVideoPath(id), webinarThumbnailPath(id)]);
  if (rm) {
    console.error("deleteWebinar storage removal failed:", rm);
    return { success: false, error: `Couldn't delete the video file: ${rm.message}` };
  }

  const { error } = await db.from("webinars").delete().eq("id", id);
  if (error) return { success: false, error: error.message };

  revalidate();
  return { success: true };
}
