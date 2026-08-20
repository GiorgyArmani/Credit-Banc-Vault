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
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isValidEmailShape } from "@/lib/email-address";

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

/**
 * Build a URL-safe referral code.
 *
 * FIRST NAME ONLY. The code appears in a public URL the affiliate posts on
 * social media, and `/r/<code>` renders their first name to any visitor, so the
 * previous `first-last-xxxx` shape published their full name to anyone who saw
 * the link or guessed a code. A first name is enough for the link to feel
 * personal and to stay memorable.
 */
function slugifyName(first: string): string {
  const base = first
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16);
  return base || "affiliate";
}

/**
 * Random suffix, Crockford-style base32 over 30 bits (~1.07 billion values).
 *
 * The previous version rendered 3 random bytes as fixed 2-character base36 pairs
 * and then sliced the result to 4 characters — which threw away the third byte
 * entirely and constrained the first character of each surviving pair to 0-7.
 * The real keyspace was 2^16, not 36^4, making a code guessable in about 65k
 * unmetered requests against a public endpoint that confirms hits by name.
 *
 * The alphabet omits I, L, O and U: no digit/letter confusion when someone reads
 * a link aloud or types it off a slide, and no accidental words.
 */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomSuffix(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join("")
    .toLowerCase();
}

/**
 * POST /api/post-signup-affiliate
 */
export async function POST(req: NextRequest) {
  try {
    // Public, invite-free and unverified: each accepted request mints a
    // pre-confirmed auth user, a GHL contact and a welcome email. Metered before
    // any of that happens.
    const { allowed } = await checkRateLimit(req, RATE_LIMITS.affiliateSignup);
    if (!allowed) {
      return NextResponse.json(
        { message: "Too many signup attempts. Please try again in a little while." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { firstName, lastName, email, phone, password, contactOptIn } = body;

    if (!firstName || !lastName || !email || !phone || !password) {
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!isValidEmailShape(email)) {
      return NextResponse.json(
        { message: "Please enter a valid email address" },
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

    // 8, matching /auth/set-password. This account is the front door to an
    // affiliate's earnings and their referred leads' names, and it is created
    // through a public form with no email verification behind it.
    if (String(password).length < 8) {
      return NextResponse.json(
        { message: "Password must be at least 8 characters" },
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
      //
      // Do NOT echo Supabase's message. It says "A user with this email address
      // has already been registered", and this endpoint is public and unmetered
      // by identity — that turns it into a membership oracle for EVERY account
      // in the vault, clients and staff included, not just affiliates. The
      // generic reply below still tells a real person what to do.
      console.warn(
        `[post-signup-affiliate] createUser refused for ${cleanEmail}: ${createError.message}`
      );
      return NextResponse.json(
        {
          message:
            "We couldn't create that account. If you already have one, log in instead or reset your password.",
        },
        { status: 400 }
      );
    }

    const userId = userData.user.id;

    /**
     * Undo the auth user if provisioning fails after it exists.
     *
     * Steps 2 and 3 are what make this account USABLE — the role row that routes
     * them and the affiliates row that owns their referral code. Without the
     * rollback, a failure in either left a confirmed auth user with no role and
     * no profile: they could log in, land nowhere, and — because the address was
     * now taken — never successfully sign up again. Failing all the way back is
     * the only state a public form can recover from on its own.
     *
     * Everything AFTER step 3 (GHL, consent stamp, welcome email) is
     * deliberately best-effort and must NOT trigger this: the account works by
     * then, and a CRM or mail hiccup is not a reason to delete it.
     */
    const rollbackAuthUser = async (why: string) => {
      console.error(`[post-signup-affiliate] rolling back auth user ${userId}: ${why}`);
      try {
        await supabaseAdmin.auth.admin.deleteUser(userId);
      } catch (delErr) {
        console.error(
          `[post-signup-affiliate] ROLLBACK FAILED — orphaned auth user ${userId} (${cleanEmail}) needs manual cleanup:`,
          delErr
        );
      }
    };

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

    if (dbError) {
      await rollbackAuthUser(`users upsert failed: ${dbError.message}`);
      throw dbError;
    }

    // Step 3: Provision the affiliate profile with a unique referral_code.
    //         Retry on the (rare) UNIQUE collision with a fresh suffix.
    const slug = slugifyName(cleanFirst);
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
        // Unique violation. If it's the user_id, this affiliate already has a
        // profile (a partially-failed earlier attempt) — stop retrying AND adopt
        // the code that is actually stored. The old branch kept the freshly
        // generated `referralCode`, which was never inserted, so the welcome
        // email and the GHL custom field both advertised a /r/ link that 404s.
        if (affErr.message?.includes("user_id")) {
          const { data: existing } = await supabaseAdmin
            .from("affiliates")
            .select("referral_code")
            .eq("user_id", userId)
            .maybeSingle();
          if (existing?.referral_code) referralCode = existing.referral_code;
          inserted = true;
        }
        // else: referral_code collision — loop retries with a new suffix.
      } else {
        await rollbackAuthUser(`affiliates insert failed: ${affErr.message}`);
        throw affErr;
      }
    }

    if (!inserted) {
      await rollbackAuthUser("could not generate a unique referral code");
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
    //         and the dashboard one is a signed magic link on a ONE-WEEK TTL, so
    //         this stamp goes stale by design. /api/cron/refresh-affiliate-links
    //         re-stamps both every Monday; if that cron stops running, the field
    //         silently becomes a link that dumps the affiliate on /auth/login
    //         with ?error=verification_failed about a week later.
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
