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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

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
    const { firstName, lastName, email, password } = body;

    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json(
        { message: "Missing required fields" },
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

    // Step 1: Create the auth user (email pre-confirmed — public program, they
    // log in immediately via the vault login).
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: password,
      email_confirm: true,
      user_metadata: {
        first_name: cleanFirst,
        last_name: cleanLast,
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
