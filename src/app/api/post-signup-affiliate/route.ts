// src/app/api/post-signup-affiliate/route.ts
//
// Public affiliate self-signup — NO invite code (this is a public program, unlike
// the invite-gated staff roles). Creates the auth user, writes a public.users row
// with role='affiliate', and provisions the affiliates profile with a unique
// referral_code. After signup the affiliate logs in via the unified vault login
// (/auth/login); the proxy routes role='affiliate' to /affiliate/dashboard.
// See [[role_model]].
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ghlUpsertContact, ghlResolveFieldId } from "@/lib/ghl-api";
import { send_affiliate_welcome_email } from "@/lib/email";
import { generateAffiliateDashboardMagicLink } from "@/lib/magic-link";
import { formatPhoneUS, isValidUsPhone, toE164 } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/**
 * Value written to the native GHL contact type (`{{contact.type}}`, shown as
 * "Contact type" on the record). This location defines its own set — Funding
 * Lead, Client, Affiliate, Business Advisor, Personal Network, Podcast Guest.
 *
 * LOWERCASE on purpose. GHL normalizes the stored value away from the UI label:
 * verified against a live contact, the "Affiliate" option reads back as
 * `"affiliate"` and "Funding Lead" reads back as `"lead"`. Don't "fix" the
 * casing to match the dropdown. Overridable via env if the set ever changes.
 */
const AFFILIATE_CONTACT_TYPE = process.env.GHL_AFFILIATE_CONTACT_TYPE || "affiliate";

// Build a URL-safe referral code from the name plus a short random suffix.
function slugifyName(first: string, last: string): string {
  const base = `${first}-${last}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base || "affiliate";
}

function randomSuffix(): string {
  // 4-char base36 suffix (crypto for uniqueness; avoids Math.random collisions).
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 4);
}

/**
 * POST /api/post-signup-affiliate
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { firstName, lastName, email, phone, password, contactOptIn } = body;

    if (!firstName || !lastName || !email || !phone || !password) {
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 }
      );
    }

    // Public form — sanitize the phone before it is stored or pushed to GHL, so
    // the affiliate lines up with the CRM contact on the SMS side.
    if (!isValidUsPhone(phone)) {
      return NextResponse.json(
        { message: "Please enter a valid 10-digit US phone number" },
        { status: 400 }
      );
    }

    // Mandatory email/SMS consent — this endpoint is public, so the checkbox is
    // re-enforced here rather than trusted from the client.
    if (contactOptIn !== true) {
      return NextResponse.json(
        { message: "You must agree to be contacted to join the affiliate program" },
        { status: 400 }
      );
    }

    if (String(password).length < 6) {
      return NextResponse.json(
        { message: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanFirst = String(firstName).trim();
    const cleanLast = String(lastName).trim();
    const cleanPhone = formatPhoneUS(phone);   // "(555) 123-4567" — stored/display
    const phoneE164 = toE164(phone)!;          // "+15551234567"   — what GHL wants

    // Step 1: Create the auth user (email pre-confirmed — public program, they
    // log in immediately via the vault login).
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: password,
      email_confirm: true,
      user_metadata: {
        first_name: cleanFirst,
        last_name: cleanLast,
        phone: cleanPhone,
      },
    });

    if (createError) {
      // Most common: email already registered.
      return NextResponse.json(
        { message: createError.message || "Could not create account" },
        { status: 400 }
      );
    }

    const userId = userData.user.id;

    // Step 2: Upsert public.users with role='affiliate'.
    const { error: dbError } = await supabaseAdmin
      .from("users")
      .upsert(
        {
          id: userId,
          first_name: cleanFirst,
          last_name: cleanLast,
          email: cleanEmail,
          role: "affiliate",
        },
        { onConflict: "id" }
      );

    if (dbError) throw dbError;

    // Step 3: Provision the affiliate profile with a unique referral_code.
    //         Retry on the (rare) UNIQUE collision with a fresh suffix.
    const slug = slugifyName(cleanFirst, cleanLast);
    let referralCode = "";
    let inserted = false;
    for (let attempt = 0; attempt < 6 && !inserted; attempt++) {
      referralCode = `${slug}-${randomSuffix()}`;
      const { error: affErr } = await supabaseAdmin.from("affiliates").insert({
        user_id: userId,
        referral_code: referralCode,
        first_name: cleanFirst,
        last_name: cleanLast,
        email: cleanEmail,
        giftronaut_email: cleanEmail,
      });
      if (!affErr) {
        inserted = true;
      } else if (affErr.code === "23505") {
        // Unique violation. If it's the user_id (affiliate already exists), stop.
        if (affErr.message?.includes("user_id")) {
          inserted = true;
        }
        // else: referral_code collision — loop retries with a new suffix.
      } else {
        throw affErr;
      }
    }

    if (!inserted) {
      throw new Error("Could not generate a unique referral code");
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vault.creditbanc.io";
    const referralUrl = `${appUrl}/r/${referralCode}`;
    // One-click passwordless entry to their dashboard. This is what rides on the
    // GHL custom field and in the welcome email, so reminders and re-activation
    // campaigns drop the affiliate straight in instead of at a login form they
    // may not remember the password for. Falls back to the plain URL if token
    // signing fails — a login form beats a dead link.
    const dashboardUrl =
      (await generateAffiliateDashboardMagicLink(cleanEmail)) || `${appUrl}/affiliate/dashboard`;

    // Step 4: Mirror the affiliate into GHL as a contact carrying the single
    //         `new affiliate` tag — the joined-just-now signal onboarding
    //         workflows trigger on. Nothing in the app ever removes it, so a GHL
    //         workflow has to strip it once onboarding is done. The mandatory
    //         opt-in above is the consent behind it. Best-effort: the vault
    //         account is already live, so a GHL hiccup must not fail the signup.
    //         See [[ghl_integration_contract]].
    //
    //         NOTE: the plain `affiliate` tag was dropped on Matt's call
    //         (2026-08-14) — `new affiliate` is the only one written now. Two
    //         earlier generations are still out there on older contacts and none
    //         were backfilled: `affiliate-partner` + `vault-affiliate:<code>`
    //         (oldest), then `affiliate`. Any GHL workflow or smart list still
    //         filtering on either must be repointed. The contact TYPE
    //         (`affiliate`) is untouched and is the durable "this is an
    //         affiliate" marker now that no permanent tag says so. Referred LEADS
    //         are unaffected — they get their own `vault-affiliate:<code>` tag
    //         from /api/refer/[code]/submit.
    //
    //         Both links are stamped onto custom fields so reminder/re-activation
    //         emails can merge them ({{contact.data_vault_personal_affiliate_link}}
    //         and {{contact.data_vault_affiliate_dashboard_link}}) instead of the
    //         CRM having to reconstruct URLs it doesn't own. Both are per-affiliate
    //         and the dashboard one is a signed magic link on the standard 30-day
    //         TTL, so this stamp goes stale by design. /api/cron/refresh-affiliate-links
    //         re-stamps both weekly; without that cron running, the field silently
    //         becomes a link that dumps the affiliate on /auth/login with
    //         ?error=verification_failed a month after they sign up.
    let ghlContactId: string | null = null;
    try {
      const locationId = process.env.GHL_LOCATION_ID;
      if (locationId) {
        // env first (one less API call), merge key as the fallback — same
        // pattern as the affiliate-attribution field in /api/refer/[code]/submit.
        const [dashboardFieldId, personalLinkFieldId] = await Promise.all([
          process.env.GHL_CF_AFFILIATE_DASHBOARD_LINK ||
            ghlResolveFieldId(locationId, "contact.data_vault_affiliate_dashboard_link"),
          process.env.GHL_CF_PERSONAL_AFFILIATE_LINK ||
            ghlResolveFieldId(locationId, "contact.data_vault_personal_affiliate_link"),
        ]);
        const customFields = [
          dashboardFieldId ? { id: dashboardFieldId, value: dashboardUrl } : null,
          personalLinkFieldId ? { id: personalLinkFieldId, value: referralUrl } : null,
        ].filter(Boolean) as Array<{ id: string; value: string }>;

        const contact = {
          firstName: cleanFirst,
          lastName: cleanLast,
          name: `${cleanFirst} ${cleanLast}`.trim(),
          email: cleanEmail,
          phone: phoneE164,
          country: "US",
          locationId,
          tags: ["new affiliate"],
          ...(customFields.length ? { customFields } : {}),
        };

        try {
          ghlContactId = await ghlUpsertContact({ ...contact, type: AFFILIATE_CONTACT_TYPE });
        } catch (typeErr) {
          // If GHL rejects the contact type, don't lose the contact over it —
          // the tag is what the CRM segments on. Retry without the type and log
          // loudly so the correct value can be set via GHL_AFFILIATE_CONTACT_TYPE.
          console.error(
            `[post-signup-affiliate] GHL rejected contact type "${AFFILIATE_CONTACT_TYPE}" — retrying without it. ` +
              `Set GHL_AFFILIATE_CONTACT_TYPE to the value this location stores for Affiliate.`,
            typeErr
          );
          ghlContactId = await ghlUpsertContact(contact);
        }
      } else {
        console.warn("[post-signup-affiliate] Missing GHL_LOCATION_ID — no CRM contact created");
      }
    } catch (ghlErr) {
      console.error("[post-signup-affiliate] GHL upsert failed (account created anyway):", ghlErr);
    }

    // Step 5: Stamp the phone, consent record + CRM link. Written as a separate
    // best-effort update so signup keeps working on environments where migration
    // 20260729 has not been applied yet — the phone also rides on the auth user's
    // metadata, so nothing is lost pre-migration (see
    // [[refactor_alongside_production]]).
    const { error: consentErr } = await supabaseAdmin
      .from("affiliates")
      .update({
        phone: cleanPhone,
        contact_opt_in: true,
        contact_opt_in_at: new Date().toISOString(),
        ghl_contact_id: ghlContactId,
      })
      .eq("user_id", userId);
    if (consentErr) {
      console.warn("post-signup-affiliate: could not stamp contact consent:", consentErr.message);
    }

    // Step 6: Welcome email carrying their referral link. Best-effort — the
    // account and the link already exist, and the dashboard shows the same link,
    // so a mail hiccup must not fail a signup the user completed successfully.
    try {
      const reward = Number(process.env.AFFILIATE_COMMISSION_AMOUNT ?? 500);
      await send_affiliate_welcome_email({
        affiliate_name: cleanFirst || "there",
        affiliate_email: cleanEmail,
        referral_url: referralUrl,
        dashboard_url: dashboardUrl,
        reward_amount: reward.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }),
        terms_url: `${appUrl}/affiliate`,
      });
    } catch (mailErr) {
      console.error("[post-signup-affiliate] welcome email failed (account created anyway):", mailErr);
    }

    return NextResponse.json({
      ok: true,
      message: "Affiliate account created successfully",
      referralCode,
    });
  } catch (err: any) {
    console.error("post-signup-affiliate error:", err);
    return NextResponse.json(
      { message: err?.message || "Server error during affiliate signup" },
      { status: 500 }
    );
  }
}
