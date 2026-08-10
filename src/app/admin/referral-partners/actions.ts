"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import {
  normalizePartnerSlug,
  partnerSlugFromName,
  partnerReferralUrl,
} from "@/lib/referral-partners";
import { generatePartnerPortalMagicLink } from "@/lib/magic-link";
import { send_referral_partner_invite } from "@/lib/email";

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

type ActionResult = {
  success: boolean;
  error?: string;
  /** Real row id. The list needs it to act on a row it just created — without
   *  it the UI has to invent a placeholder, and the next Deactivate/Delete
   *  targets an id the database has never seen. */
  id?: string;
  name?: string;
  slug?: string;
};

/**
 * Add a new INTERNAL referral partner (admin only). Trims + collapses whitespace,
 * dedupes case-insensitively (the lower(name) unique index also enforces this at
 * the DB level).
 *
 * Takes the contact details up front rather than name-only. Onboarding a partner
 * needs a name, a link and an email; splitting that across "add row" then
 * "expand row, fill email, save" made the common path four steps and left a
 * trail of half-configured partners who could never be invited.
 *
 * A slug is minted here too, so the partner is link-ready immediately — the URL
 * token is what the marketing form sends back to us, and a partner without one
 * can be attributed by hand but never automatically.
 */
export async function addReferralPartner(
  rawName: string,
  extra?: { email?: string | null; phone?: string | null; company?: string | null }
): Promise<ActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const name = (rawName || "").replace(/\s+/g, " ").trim();
  if (!name) return { success: false, error: "Name is required" };
  if (name.length > 120) return { success: false, error: "Name is too long" };

  const email = (extra?.email ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: "That email doesn't look right" };
  }

  const db = createAdminClient();

  // Case-insensitive existence check for a friendly message (the unique index is
  // the real guard against a race).
  const { data: existing } = await db
    .from("referral_partners")
    .select("id, name, active, slug, email")
    .ilike("name", name)
    .maybeSingle();

  if (existing) {
    // Re-activate a previously deactivated partner instead of erroring, and fill
    // in any detail that was supplied — but never overwrite an email already on
    // file from a form that happens to have one typed in it.
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (!existing.active) patch.active = true;
    if (email && !existing.email) patch.email = email;
    if (extra?.phone?.trim()) patch.phone = extra.phone.trim();
    if (extra?.company?.trim()) patch.company = extra.company.trim();

    await db.from("referral_partners").update(patch).eq("id", existing.id);

    revalidatePath("/admin/referral-partners");
    return {
      success: true,
      id: existing.id,
      name: existing.name,
      slug: existing.slug ?? undefined,
    };
  }

  const slug = await freeSlugFor(db, partnerSlugFromName(name), null);

  const { data: inserted, error } = await db
    .from("referral_partners")
    .insert({
      name,
      slug,
      created_by: admin.id,
      email: email || null,
      phone: extra?.phone?.trim() || null,
      company: extra?.company?.trim() || null,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique violation (lost a race with a concurrent insert). Read back
    // the winner so the caller still gets a usable id.
    if (error.code === "23505") {
      const { data: raced } = await db
        .from("referral_partners")
        .select("id, name, slug")
        .ilike("name", name)
        .maybeSingle();
      return {
        success: true,
        id: raced?.id,
        name: raced?.name ?? name,
        slug: raced?.slug ?? slug,
      };
    }
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/referral-partners");
  return { success: true, id: inserted.id, name, slug };
}

/**
 * Find a slug nobody else holds, appending -2, -3 … on collision.
 * `exceptId` lets a partner keep their own slug when editing.
 */
async function freeSlugFor(
  db: ReturnType<typeof createAdminClient>,
  desired: string,
  exceptId: string | null
): Promise<string> {
  const { data } = await db.from("referral_partners").select("id, slug");
  const taken = new Set(
    (data ?? [])
      .filter((r: any) => r.id !== exceptId && r.slug)
      .map((r: any) => normalizePartnerSlug(r.slug))
  );

  let candidate = desired;
  let n = 1;
  while (taken.has(normalizePartnerSlug(candidate))) {
    n += 1;
    candidate = `${desired}_${n}`;
  }
  return candidate;
}

/**
 * Rename a referral partner (admin only).
 *
 * Historically this orphaned every assigned client, because attribution was a
 * denormalized name string. It no longer does — client_data_vault carries
 * referral_partner_id — but the mirrored name column still has to be dragged
 * along, since the client card, the signup forms and the GHL "Referral Assigned"
 * sync all read it. The slug is deliberately left alone: it's in circulation on
 * links we don't control.
 */
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

  // Keep the mirrored name on every client attributed to this partner in step.
  const { error: mirrorError } = await db
    .from("client_data_vault")
    .update({ referral_partner: name })
    .eq("referral_partner_id", id);
  if (mirrorError) {
    console.error("[referral-partners] rename: client mirror failed:", mirrorError);
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

export type PartnerProfileInput = {
  slug?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
  commission_type?: "percent" | "flat" | null;
  commission_value?: number | null;
};

/**
 * Edit a partner's contact details, link slug and commission terms (admin only).
 *
 * Commission is stored but NOT shown to partners — the rate is still being
 * negotiated, and the ledger records unpriced rows in the meantime. Changing it
 * here only affects deals funded from now on: referral_partner_commissions
 * snapshots the rate at funding time so history never silently reprices.
 */
export async function updateReferralPartnerProfile(
  id: string,
  input: PartnerProfileInput
): Promise<ActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };

  if (input.slug !== undefined) {
    const raw = (input.slug ?? "").trim();
    if (!raw) {
      patch.slug = null;
    } else {
      // Store the admin's casing, but reject anything that would collide once
      // normalized — two partners resolving from one link is unrecoverable
      // attribution, not a cosmetic clash.
      const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
      if (!normalizePartnerSlug(cleaned)) {
        return { success: false, error: "That link name has no usable characters" };
      }
      const free = await freeSlugFor(db, cleaned, id);
      if (normalizePartnerSlug(free) !== normalizePartnerSlug(cleaned)) {
        return { success: false, error: "Another partner already uses that link name" };
      }
      patch.slug = cleaned;
    }
  }

  if (input.email !== undefined) {
    const email = (input.email ?? "").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: "That email doesn't look right" };
    }
    patch.email = email || null;
  }

  if (input.phone !== undefined) patch.phone = (input.phone ?? "").trim() || null;
  if (input.company !== undefined) patch.company = (input.company ?? "").trim() || null;
  if (input.notes !== undefined) patch.notes = (input.notes ?? "").trim() || null;

  if (input.commission_type !== undefined) {
    if (
      input.commission_type !== null &&
      input.commission_type !== "percent" &&
      input.commission_type !== "flat"
    ) {
      return { success: false, error: "Invalid commission type" };
    }
    patch.commission_type = input.commission_type;
  }

  if (input.commission_value !== undefined) {
    if (input.commission_value === null) {
      patch.commission_value = null;
    } else {
      const v = Number(input.commission_value);
      if (!Number.isFinite(v) || v < 0) {
        return { success: false, error: "Commission must be a positive number" };
      }
      if (patch.commission_type === "percent" && v > 100) {
        return { success: false, error: "A percentage can't be over 100" };
      }
      patch.commission_value = v;
    }
  }

  const { error } = await db.from("referral_partners").update(patch).eq("id", id);
  if (error) {
    if (error.code === "23505") return { success: false, error: "That link name is taken" };
    return { success: false, error: error.message };
  }

  revalidatePath("/admin/referral-partners");
  return { success: true, slug: patch.slug };
}

/**
 * Give a partner access to the portal (admin only).
 *
 * Creates (or reuses) the auth user, sets users.role = 'referral_partner', links
 * it to the partner row and emails a passwordless entry link. Idempotent — safe
 * to click again to re-send the invite, which is exactly how a lost link gets
 * replaced.
 *
 * Guard rail: an email that already belongs to a STAFF or CLIENT account is
 * refused rather than silently role-swapped. Flipping an advisor to
 * referral_partner would strip them of their own dashboard, and nothing about
 * this button suggests that's what it does.
 */
export async function inviteReferralPartnerToPortal(id: string): Promise<ActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const result = await provisionPartnerPortal(id);
  revalidatePath("/admin/referral-partners");
  return result;
}

/**
 * The actual provisioning, shared by the single-partner button and the bulk
 * invite. Extracted so the two can't drift: a bulk path that re-implemented the
 * role guard or the email would eventually diverge from the one that was
 * reviewed, and the divergence would be invisible until it mattered.
 *
 * Assumes the caller has already checked for admin.
 */
async function provisionPartnerPortal(id: string): Promise<ActionResult> {
  const db = createAdminClient();

  const { data: partner, error: readErr } = await db
    .from("referral_partners")
    .select("id, name, slug, email, user_id, portal_enabled")
    .eq("id", id)
    .maybeSingle();

  if (readErr || !partner) return { success: false, error: "Partner not found" };

  const email = (partner.email ?? "").trim().toLowerCase();
  if (!email) {
    return { success: false, error: "Add an email address before inviting this partner" };
  }

  try {
    let userId = partner.user_id as string | null;

    if (!userId) {
      // Does an account already exist on this address?
      const { data: existingUser } = await db
        .from("users")
        .select("id, role")
        .ilike("email", email)
        .maybeSingle();

      if (existingUser) {
        if (existingUser.role !== "referral_partner" && existingUser.role !== "free") {
          return {
            success: false,
            error: `${email} already has a ${existingUser.role} account. Use a different address.`,
          };
        }
        userId = existingUser.id;
      } else {
        // Random password nobody ever sees — entry is by magic link.
        const tempPassword = `Cb-${crypto.randomUUID()}`;
        const { data: created, error: createErr } = await db.auth.admin.createUser({
          email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { referral_partner_name: partner.name },
        });
        if (createErr || !created?.user) {
          return {
            success: false,
            error: createErr?.message || "Could not create the partner login",
          };
        }
        userId = created.user.id;
      }
    }

    const [firstName, ...restName] = (partner.name || "").split(/\s+/);

    const { error: roleErr } = await db.from("users").upsert(
      {
        id: userId,
        email,
        first_name: firstName || partner.name,
        last_name: restName.join(" ") || null,
        role: "referral_partner",
      },
      { onConflict: "id" }
    );
    if (roleErr) return { success: false, error: roleErr.message };

    const { error: linkErr } = await db
      .from("referral_partners")
      .update({
        user_id: userId,
        portal_enabled: true,
        invited_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (linkErr) return { success: false, error: linkErr.message };

    // Email the entry link. Best-effort: access is already provisioned, and the
    // admin can re-send — failing the whole invite over SMTP would leave the
    // partner enabled but the UI saying it didn't work.
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
      const magicLink = await generatePartnerPortalMagicLink(email);

      // Local testing convenience: print the entry link so you can walk the
      // onboarding flow without a working SMTP setup or a real inbox.
      //
      // NEVER in production — this link is a credential, and a credential in a
      // log file is a credential anyone with log access holds.
      if (process.env.NODE_ENV !== "production" && magicLink) {
        console.log(`[referral-partners] DEV invite link for ${email}:\n${magicLink}`);
      }

      await send_referral_partner_invite({
        partner_name: firstName || partner.name,
        partner_email: email,
        portal_url: magicLink || `${appUrl}/auth/login`,
        referral_url: partner.slug ? partnerReferralUrl(partner.slug) : null,
      });
    } catch (mailErr) {
      console.error("[referral-partners] invite email failed (access granted anyway):", mailErr);
      return {
        success: false,
        error: "Portal access granted, but the invite email failed to send.",
      };
    }

    return { success: true, name: partner.name };
  } catch (err: any) {
    console.error("[referral-partners] invite threw:", err);
    return { success: false, error: err?.message || "Could not invite this partner" };
  }
}

/**
 * Pause a partner's portal access (admin only).
 *
 * Flips portal_enabled off and leaves the auth user in place: their referrals,
 * their commission history and their link all stay valid, they just can't see
 * the dashboard. Deleting the login instead would look identical from the admin
 * side and be far harder to undo.
 */
export async function revokeReferralPartnerPortal(id: string): Promise<ActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();
  const { error } = await db
    .from("referral_partners")
    .update({ portal_enabled: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/referral-partners");
  return { success: true };
}

// ============================================================================
// Bulk onboarding
// ============================================================================
// ~100 partners already exist as names. Getting them into the portal means two
// bulk steps, deliberately kept SEPARATE: load the contact details, look at what
// matched, THEN invite. A single "import and invite" button would fire real
// emails off the back of a fuzzy name match, and there is no un-sending them.
//
// Why this lives in the app and not in the migration: emails are operational
// data. A migration runs once — the first correction, the first new partner, and
// it's stale, with no error to tell you. Worse, a hardcoded name that doesn't
// match a row fails silently, and the symptom is a partner who simply never
// hears from us.

export type BulkImportResult = {
  success: boolean;
  error?: string;
  updated: number;
  /** Lines whose partner we couldn't find — shown back so nothing is lost. */
  unmatched: string[];
  /** Lines we couldn't parse, or with an email that isn't one. */
  invalid: string[];
  /** Partners whose email CHANGED (vs was blank) — worth a second look. */
  overwritten: { name: string; from: string; to: string }[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Attach emails (and optionally phone / firm) to existing partners from pasted
 * text — one partner per line, comma- or tab-separated, so a spreadsheet column
 * pastes straight in:
 *
 *   Aaron_Sedlacek, aaron@firm.com
 *   Aaron Sedlacek, aaron@firm.com, (555) 111-2222, Sedlacek CPA
 *
 * Matching is by slug first, then name, both normalized — the same rule the
 * referral links resolve through, so anything that works as a link works here.
 * Creates nothing: a line that matches no partner is REPORTED, not inserted.
 * Inventing partner rows from a typo'd paste is how a registry rots.
 */
export async function bulkImportPartnerContacts(
  raw: string
): Promise<BulkImportResult> {
  const empty: BulkImportResult = {
    success: false,
    updated: 0,
    unmatched: [],
    invalid: [],
    overwritten: [],
  };

  const admin = await requireAdminUser();
  if (!admin) return { ...empty, error: "Forbidden" };

  const lines = (raw || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return { ...empty, error: "Nothing to import" };
  if (lines.length > 500) {
    return { ...empty, error: "That's over 500 lines — split it into smaller batches." };
  }

  const db = createAdminClient();
  const { data: partners, error: readErr } = await db
    .from("referral_partners")
    .select("id, name, slug, email");

  if (readErr || !partners) {
    return { ...empty, error: readErr?.message || "Could not read the partner list" };
  }

  // Index once by both keys rather than querying per line.
  const bySlug = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const p of partners) {
    const slugKey = normalizePartnerSlug(p.slug);
    if (slugKey) bySlug.set(slugKey, p);
    const nameKey = normalizePartnerSlug(p.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, p);
  }

  const unmatched: string[] = [];
  const invalid: string[] = [];
  const overwritten: { name: string; from: string; to: string }[] = [];
  let updated = 0;

  for (const line of lines) {
    const cols = line
      .split(/\t|,/)
      .map((c) => c.trim())
      .filter((c, i) => i === 0 || c !== "");

    const key = cols[0];
    const email = (cols[1] ?? "").toLowerCase();
    const phone = cols[2] ?? "";
    const company = cols[3] ?? "";

    if (!key || !email || !EMAIL_RE.test(email)) {
      invalid.push(line);
      continue;
    }

    const wanted = normalizePartnerSlug(key);
    const partner = (wanted && (bySlug.get(wanted) ?? byName.get(wanted))) || null;
    if (!partner) {
      unmatched.push(line);
      continue;
    }

    const patch: Record<string, any> = { email, updated_at: new Date().toISOString() };
    if (phone) patch.phone = phone;
    if (company) patch.company = company;

    const { error } = await db.from("referral_partners").update(patch).eq("id", partner.id);
    if (error) {
      invalid.push(`${line}  — ${error.message}`);
      continue;
    }

    // Replacing an address that was already there is a different act from
    // filling in a blank; surface it rather than letting a stale paste quietly
    // redirect someone's invite.
    if (partner.email && partner.email.toLowerCase() !== email) {
      overwritten.push({ name: partner.name, from: partner.email, to: email });
    }
    updated += 1;
  }

  revalidatePath("/admin/referral-partners");
  return { success: true, updated, unmatched, invalid, overwritten };
}

export type BulkInviteResult = {
  success: boolean;
  error?: string;
  sent: string[];
  failed: { name: string; error: string }[];
};

/**
 * Invite a batch of partners to the portal.
 *
 * Capped at 25 ids per call ON PURPOSE. Each invite is an auth-user creation
 * plus an SMTP send, and 100 of those in one server action will hit the
 * function timeout somewhere in the middle — leaving half the partners
 * provisioned with no way to tell which half. The UI walks the list in chunks
 * and shows progress, so a failure is always partial and always visible.
 *
 * Sequential rather than parallel: shared SMTP connection, and a burst of 25
 * simultaneous sends is exactly the shape that trips rate limits.
 */
export async function inviteReferralPartnersBulk(
  ids: string[]
): Promise<BulkInviteResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden", sent: [], failed: [] };

  if (!Array.isArray(ids) || ids.length === 0) {
    return { success: false, error: "No partners selected", sent: [], failed: [] };
  }
  if (ids.length > 25) {
    return { success: false, error: "Send at most 25 at a time", sent: [], failed: [] };
  }

  // Names up front so a failure reads "Jane Doe — no email" rather than a uuid;
  // most of provisionPartnerPortal's early exits have no name to hand back.
  const db = createAdminClient();
  const { data: named } = await db
    .from("referral_partners")
    .select("id, name")
    .in("id", ids);
  const nameById = new Map((named ?? []).map((r) => [r.id, r.name]));

  const sent: string[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const id of ids) {
    const label = nameById.get(id) || id;
    const res = await provisionPartnerPortal(id);
    if (res.success) {
      sent.push(label);
    } else {
      failed.push({ name: label, error: res.error || "Unknown error" });
    }
  }

  revalidatePath("/admin/referral-partners");
  return { success: true, sent, failed };
}

/**
 * Permanently delete a referral partner (admin only).
 *
 * For test rows and mistakes — NOT for retiring a real partner. Deactivate does
 * that: it drops them from the dropdowns while every client they referred keeps
 * its attribution.
 *
 * Deletion is REFUSED when the partner has attributed clients or commission
 * history. `client_data_vault.referral_partner_id` is ON DELETE SET NULL and
 * `referral_partner_commissions` is ON DELETE CASCADE, so a blind delete would
 * silently strip attribution off live client records and destroy earnings
 * history — with no error and nothing to restore from. The counts come back in
 * the message so the admin can see exactly what's in the way.
 */
export async function deleteReferralPartner(id: string): Promise<ActionResult> {
  const admin = await requireAdminUser();
  if (!admin) return { success: false, error: "Forbidden" };

  const db = createAdminClient();

  const { data: partner, error: readErr } = await db
    .from("referral_partners")
    .select("id, name, user_id")
    .eq("id", id)
    .maybeSingle();

  if (readErr) return { success: false, error: readErr.message };
  if (!partner) return { success: false, error: "Partner not found" };

  const [{ count: clientCount }, { count: commissionCount }] = await Promise.all([
    db
      .from("client_data_vault")
      .select("id", { count: "exact", head: true })
      .eq("referral_partner_id", id),
    db
      .from("referral_partner_commissions")
      .select("id", { count: "exact", head: true })
      .eq("referral_partner_id", id),
  ]);

  if ((clientCount ?? 0) > 0 || (commissionCount ?? 0) > 0) {
    const parts: string[] = [];
    if (clientCount) parts.push(`${clientCount} referred client${clientCount === 1 ? "" : "s"}`);
    if (commissionCount)
      parts.push(`${commissionCount} commission record${commissionCount === 1 ? "" : "s"}`);
    return {
      success: false,
      error: `${partner.name} has ${parts.join(" and ")}. Deactivate instead — deleting would strip that history.`,
    };
  }

  // Clean up the portal login, but only when it exists SOLELY for this partner.
  // inviteReferralPartnerToPortal can attach an existing 'free' account, and a
  // client's auth user cascades to their whole vault — deleting one here would
  // be catastrophic and completely invisible from this screen.
  // See [[client_deletion_cascade_contract]].
  if (partner.user_id) {
    try {
      const [{ data: userRow }, { count: vaultCount }] = await Promise.all([
        db.from("users").select("role").eq("id", partner.user_id).maybeSingle(),
        db
          .from("client_data_vault")
          .select("id", { count: "exact", head: true })
          .eq("user_id", partner.user_id),
      ]);

      if (userRow?.role === "referral_partner" && (vaultCount ?? 0) === 0) {
        await db.auth.admin.deleteUser(partner.user_id);
      } else {
        console.warn(
          `[referral-partners] delete ${partner.name}: leaving auth user ${partner.user_id} in place ` +
            `(role=${userRow?.role}, vaults=${vaultCount}) — it isn't exclusively a partner login`
        );
      }
    } catch (authErr) {
      // Don't block the delete on this; an orphan login can only ever reach the
      // "no partner profile" screen.
      console.error("[referral-partners] could not remove partner login:", authErr);
    }
  }

  const { error: delErr } = await db.from("referral_partners").delete().eq("id", id);
  if (delErr) return { success: false, error: delErr.message };

  revalidatePath("/admin/referral-partners");
  return { success: true, name: partner.name };
}
