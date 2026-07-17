"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

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

type ActionResult = { success: boolean; error?: string; name?: string };

/**
 * Add a new INTERNAL referral partner (admin only). Trims + collapses whitespace,
 * dedupes case-insensitively (the lower(name) unique index also enforces this at
 * the DB level). Returns the stored name so the caller can select it immediately.
 */
export async function addReferralPartner(rawName: string): Promise<ActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const name = (rawName || "").replace(/\s+/g, " ").trim();
  if (!name) return { success: false, error: "Name is required" };
  if (name.length > 120) return { success: false, error: "Name is too long" };

  const db = createAdminClient();

  // Case-insensitive existence check for a friendly message (the unique index is
  // the real guard against a race).
  const { data: existing } = await db
    .from("referral_partners")
    .select("id, name, active")
    .ilike("name", name)
    .maybeSingle();

  if (existing) {
    // Re-activate a previously deactivated partner instead of erroring.
    if (!existing.active) {
      await db
        .from("referral_partners")
        .update({ active: true, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    revalidatePath("/admin/referral-partners");
    return { success: true, name: existing.name };
  }

  const { error } = await db
    .from("referral_partners")
    .insert({ name, created_by: admin.id });

  if (error) {
    // 23505 = unique violation (lost a race with a concurrent insert).
    if (error.code === "23505") return { success: true, name };
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/referral-partners");
  return { success: true, name };
}

/** Rename a referral partner (admin only). Does not touch already-assigned clients. */
export async function renameReferralPartner(
  id: string,
  rawName: string
): Promise<ActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const name = (rawName || "").replace(/\s+/g, " ").trim();
  if (!name) return { success: false, error: "Name is required" };

  const db = createAdminClient();
  const { error } = await db
    .from("referral_partners")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return { success: false, error: "That name already exists" };
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/referral-partners");
  return { success: true, name };
}

/** Activate / deactivate a referral partner (admin only). Deactivated partners
 *  drop out of the dropdowns but stay on clients they're already assigned to. */
export async function setReferralPartnerActive(
  id: string,
  active: boolean
): Promise<ActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { error } = await db
    .from("referral_partners")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/referral-partners");
  return { success: true };
}
