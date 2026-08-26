"use server";

// Profile photo for advisors, admins and partner advisors.
//
// Why this matters beyond vanity: the client dashboard's "Your Advisor" card
// (src/components/advisor-display.tsx) renders advisors.profile_pic_url. When an
// advisor signs up without uploading one, every client they own sees a grey
// initials circle where a face should be — the one place in the whole product
// that says a person is on the other end. Until now the ONLY chance to set it
// was during signup, and it was optional, so it was skipped.
//
// Advisors, admins and partner_advisors are handled by the same code path
// because they're the same thing here: all three are rows in `advisors`, all
// three can own clients, and all three show up on that card. See
// require-admin.ts, which 403s an admin with no advisors row.
//
// partner_advisor belongs here for the same reason they get asked for a phone
// number during onboarding: a partner working their own deals IS the advisor of
// record on those files, and their clients see them on that card. The button
// has always been rendered for them by the shared workspace shell — this action
// just used to answer "Forbidden".
//
// The upload goes through the service role, matching post-signup-advisor —
// advisor-profiles is not writable by a normal session.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isExternalAdvisor } from "@/lib/auth/roles";
import { revalidatePath } from "next/cache";

const BUCKET = "advisor-profiles";
/** Matches the 2MB the signup form advertises. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Content types we accept, mapped to the extension we store them under. The
 *  signup route hardcoded `contentType: 'image/webp'` for every upload, which
 *  serves PNGs mislabelled as WebP; this stores what the file actually is. */
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type ProfilePhotoResult = {
  success: boolean;
  error?: string;
  /** New public URL, so the caller can swap the image without a round trip. */
  url?: string;
};

type AdvisorRow = { id: string; profile_pic_url: string | null };

/**
 * Find the caller's `advisors` row.
 *
 * Falls back to matching on email and backfills user_id — the same repair the
 * advisor dashboard does at src/app/advisor/dashboard/page.tsx:175. Advisor rows
 * predate the user_id link, so a long-tenured advisor can be sitting on a row
 * that was never wired to their login.
 */
async function resolveAdvisorRow(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  email: string | null
): Promise<AdvisorRow | null> {
  const { data } = await db
    .from("advisors")
    .select("id, profile_pic_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as AdvisorRow;

  if (!email) return null;

  const { data: byEmail } = await db
    .from("advisors")
    .select("id, profile_pic_url")
    .ilike("email", email)
    .maybeSingle();

  if (byEmail) {
    await db.from("advisors").update({ user_id: userId }).eq("id", byEmail.id);
    return byEmail as AdvisorRow;
  }

  return null;
}

/**
 * Best-effort removal of the photo being replaced.
 *
 * Guarded twice: the URL has to point into OUR bucket, and the object name has
 * to start with this user's id (the naming scheme below). Without those guards
 * a malformed or hand-edited profile_pic_url could aim this at someone else's
 * object. A leftover file is harmless; deleting the wrong one is not.
 */
async function removeOldPhoto(
  db: ReturnType<typeof createAdminClient>,
  oldUrl: string | null,
  userId: string
): Promise<void> {
  if (!oldUrl) return;
  try {
    const marker = `/${BUCKET}/`;
    const at = oldUrl.indexOf(marker);
    if (at === -1) return;

    const objectPath = decodeURIComponent(oldUrl.slice(at + marker.length)).split("?")[0];
    const fileName = objectPath.split("/").pop() ?? "";
    if (!fileName.startsWith(`${userId}-`)) return;

    await db.storage.from(BUCKET).remove([objectPath]);
  } catch (err) {
    console.error("[staff-profile] could not remove previous photo:", err);
  }
}

/**
 * Replace the signed-in advisor's / admin's profile photo.
 *
 * Takes FormData rather than a base64 string: the signup route ships the image
 * as base64 JSON, which inflates it ~33% and has to be buffered entirely in
 * memory on both ends. A multipart upload from a server action streams.
 */
export async function updateStaffProfilePhoto(
  formData: FormData
): Promise<ProfilePhotoResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You're signed out. Sign in and try again." };

  const { data: me } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (me?.role !== "advisor" && me?.role !== "admin" && !isExternalAdvisor(me?.role)) {
    return { success: false, error: "Forbidden" };
  }

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "Pick an image first." };
  }
  if (file.size > MAX_BYTES) {
    return { success: false, error: "That image is over 2MB. Try a smaller one." };
  }

  const ext = ALLOWED[file.type];
  if (!ext) {
    return { success: false, error: "Use a JPG, PNG or WEBP image." };
  }

  const db = createAdminClient();

  const advisor = await resolveAdvisorRow(db, user.id, user.email ?? null);
  if (!advisor) {
    // Deliberately NOT creating one. The advisors table drives the "assign an
    // advisor" pickers, so inventing a row here would quietly put this person
    // in every assignment dropdown in the product.
    return {
      success: false,
      error:
        "No advisor profile is linked to this account yet. Ask an admin to set one up before adding a photo.",
    };
  }

  // Timestamped name rather than a fixed one per user: the URL is public and
  // gets cached hard by browsers and email clients, so overwriting in place
  // leaves people looking at the old face for as long as the cache lives.
  const objectPath = `${BUCKET}/${user.id}-${Date.now()}.${ext}`;

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(objectPath, file, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[staff-profile] upload failed:", uploadError);
    return { success: false, error: "The upload failed. Try again." };
  }

  const {
    data: { publicUrl },
  } = db.storage.from(BUCKET).getPublicUrl(objectPath);

  const { error: updateError } = await db
    .from("advisors")
    .update({ profile_pic_url: publicUrl })
    .eq("id", advisor.id);

  if (updateError) {
    console.error("[staff-profile] advisors update failed:", updateError);
    return { success: false, error: "Saved the image but couldn't attach it. Try again." };
  }

  await removeOldPhoto(db, advisor.profile_pic_url, user.id);

  // The photo shows in the shell topbar and on every client's advisor card.
  revalidatePath("/advisor/dashboard");
  revalidatePath("/admin/dashboard");
  revalidatePath("/partner/dashboard");
  revalidatePath("/partner/deals");
  revalidatePath("/dashboard");

  return { success: true, url: publicUrl };
}
