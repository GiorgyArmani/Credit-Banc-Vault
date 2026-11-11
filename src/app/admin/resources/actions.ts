// src/app/admin/resources/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWebinarId as isUuid } from "@/lib/webinars-shared";
import {
  PARTNER_RESOURCES_BUCKET,
  MAX_RESOURCE_BYTES,
  RESOURCE_FILE_NAME_MAX,
  resourceMimeType,
  resourceStoragePath,
  validateResourceFields,
} from "@/lib/partner-resources-shared";

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
  revalidatePath("/admin/resources");
  revalidatePath("/partner/resources");
}

/**
 * Called AFTER the browser finished uploading. Verifies the file really landed
 * before inserting, so a row can never point at a missing file. If the insert
 * fails the uploaded object is removed — no orphans either way.
 */
export async function createResource(input: {
  id: string;
  title: string;
  description?: string;
  file_name: string;
}): Promise<ActionResult> {
  const user = await requireAdminUser();
  if (!user) return { success: false, error: "Only admins can add resources." };

  if (!isUuid(input.id)) return { success: false, error: "Invalid upload id." };
  const file_name = typeof input.file_name === "string" ? input.file_name.trim() : "";
  const mime_type = resourceMimeType(file_name);
  if (!mime_type || file_name.length > RESOURCE_FILE_NAME_MAX) {
    return { success: false, error: "Invalid file name." };
  }
  const fields = validateResourceFields(input);
  if (!fields.ok) return { success: false, error: fields.error };

  const db = createAdminClient();
  const file_path = resourceStoragePath(input.id, file_name);

  // The size comes from storage, not from the browser.
  const { data: objects, error: listError } = await db.storage
    .from(PARTNER_RESOURCES_BUCKET)
    .list(input.id, { limit: 10 });
  if (listError) console.error("createResource: storage list failed:", listError);
  const stored = (objects ?? []).find((o) => `${input.id}/${o.name}` === file_path);
  const size = Number(stored?.metadata?.size);
  if (!stored || !Number.isFinite(size) || size <= 0 || size > MAX_RESOURCE_BYTES) {
    return { success: false, error: "The file didn't finish uploading — try the upload again." };
  }

  const { error } = await db.from("partner_resources").insert({
    id: input.id,
    ...fields.value,
    file_name,
    file_path,
    mime_type,
    size_bytes: size,
    is_published: true,
    created_by: user.id,
  });

  if (error) {
    console.error("createResource insert failed:", error);
    const { error: rm } = await db.storage.from(PARTNER_RESOURCES_BUCKET).remove([file_path]);
    if (rm) console.error("createResource cleanup failed:", rm);
    return { success: false, error: `Couldn't save the resource: ${error.message}` };
  }

  revalidate();
  return { success: true };
}

export async function updateResource(input: {
  id: string;
  title: string;
  description?: string;
}): Promise<ActionResult> {
  if (!(await requireAdminUser())) return { success: false, error: "Only admins can edit resources." };
  if (!isUuid(input.id)) return { success: false, error: "Invalid resource id." };
  const fields = validateResourceFields(input);
  if (!fields.ok) return { success: false, error: fields.error };

  const { data, error } = await createAdminClient()
    .from("partner_resources")
    .update({ ...fields.value, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .select("id");
  if (error) return { success: false, error: error.message };
  if (!data?.length) return { success: false, error: "That resource no longer exists." };

  revalidate();
  return { success: true };
}

export async function setResourcePublished(id: string, published: boolean): Promise<ActionResult> {
  if (!(await requireAdminUser())) return { success: false, error: "Only admins can change resources." };
  if (!isUuid(id)) return { success: false, error: "Invalid resource id." };

  const { data, error } = await createAdminClient()
    .from("partner_resources")
    .update({ is_published: published === true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return { success: false, error: error.message };
  if (!data?.length) return { success: false, error: "That resource no longer exists." };

  revalidate();
  return { success: true };
}

/**
 * File first, then the row. If storage removal fails the row stays and the
 * admin sees the error — a row without its file is worse than a stray file.
 */
export async function deleteResource(id: string): Promise<ActionResult> {
  if (!(await requireAdminUser())) return { success: false, error: "Only admins can delete resources." };
  if (!isUuid(id)) return { success: false, error: "Invalid resource id." };

  const db = createAdminClient();
  const { data: row, error: readError } = await db
    .from("partner_resources")
    .select("file_path")
    .eq("id", id)
    .maybeSingle();
  if (readError) return { success: false, error: readError.message };
  if (!row) return { success: false, error: "That resource no longer exists." };

  const { error: rm } = await db.storage.from(PARTNER_RESOURCES_BUCKET).remove([row.file_path]);
  if (rm) {
    console.error("deleteResource storage removal failed:", rm);
    return { success: false, error: `Couldn't delete the file: ${rm.message}` };
  }

  const { error } = await db.from("partner_resources").delete().eq("id", id);
  if (error) return { success: false, error: error.message };

  revalidate();
  return { success: true };
}
