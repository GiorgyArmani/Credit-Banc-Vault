// src/app/auth/magic/route.ts
//
// Click-time landing for onboarding magic links (see src/lib/magic-link.ts).
// The link carries OUR long-lived HMAC-signed token instead of a Supabase OTP
// (those are hard-capped at 24h and clients often click days later). Here we:
//   1. Verify our token (signature + expiry) → client email.
//   2. Mint a FRESH Supabase magic-link OTP via the admin API.
//   3. Immediately verifyOtp with the SSR client → session cookie is set.
//   4. Redirect to `next` (default /onboarding).
// The Supabase OTP only lives for the milliseconds between steps 2 and 3, so
// its expiry setting no longer matters.
//
// Note: unlike a raw Supabase OTP (single-use), our token works repeatedly
// until it expires — intentional, since clients re-open the same SMS/email.

import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyMagicToken } from "@/lib/magic-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const nextParam = searchParams.get("next") ?? "/onboarding";
  // Only allow internal paths — prevents open-redirect via the next param.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/onboarding";

  const fail = (reason: string) => {
    console.error(`❌ /auth/magic failed: ${reason}`);
    const errorRedirect = request.nextUrl.clone();
    errorRedirect.pathname = "/auth/login";
    errorRedirect.search = "";
    errorRedirect.searchParams.set("error", "verification_failed");
    return NextResponse.redirect(errorRedirect);
  };

  if (!token) return fail("missing token");

  const verified = verifyMagicToken(token);
  if (!verified) return fail("invalid or expired token");

  try {
    const supabaseAdmin = createAdminClient();

    // Resolve the ACCOUNT before minting anything. generateLink({type:"magiclink"})
    // silently CREATES an auth user when the address is unknown to auth — and an
    // address can be unknown to auth while being perfectly real to us, because
    // an admin edit (partner email, client email) updates public.users and
    // leaves auth.users.email behind. The click then signed into a brand-new
    // account with no users row, which the proxy reads as role 'free' and forces
    // into client /onboarding (a tier-2 partner hit exactly that, 2026-09-24).
    //
    // So the token's address picks the users row, and the users row's id picks
    // the auth account — whose OWN email is what we mint for. A drifted account
    // still signs in as itself, and an address with no account fails cleanly.
    const tokenEmail = verified.email.trim().toLowerCase();
    const { data: candidates, error: lookupError } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .ilike("email", tokenEmail);
    if (lookupError) return fail(`account lookup error: ${lookupError.message}`);
    // ilike treats `_` as a wildcard; keep only the exact (case-insensitive) match.
    const accounts = (candidates ?? []).filter((u) => (u.email ?? "").toLowerCase() === tokenEmail);
    if (accounts.length !== 1) {
      return fail(`${accounts.length} accounts for ${tokenEmail} — refusing to pick one`);
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(accounts[0].id);
    const loginEmail = authData?.user?.email;
    if (authError || !loginEmail) {
      return fail(`no auth user for ${accounts[0].id}: ${authError?.message ?? "missing email"}`);
    }
    if (loginEmail.toLowerCase() !== tokenEmail) {
      console.warn(
        `⚠️ /auth/magic: auth email drift for ${accounts[0].id} (token=${tokenEmail}, auth=${loginEmail}) — signing into the existing account`
      );
    }

    // Fresh single-use Supabase OTP for this click.
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: loginEmail,
    });
    if (error || !data?.properties?.hashed_token) {
      return fail(`generateLink error: ${error?.message ?? "no hashed_token"}`);
    }

    // Verify it server-side with the SSR client so the session cookie is set
    // on the response (same mechanism as /auth/confirm).
    const supabase = await createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: data.properties.hashed_token,
    });
    if (verifyError) return fail(`verifyOtp error: ${verifyError.message}`);

    console.log(`✅ Magic link login for ${verified.email} → ${next}`);
    const redirectTo = request.nextUrl.clone();
    redirectTo.pathname = next;
    redirectTo.search = "";
    return NextResponse.redirect(redirectTo);
  } catch (err) {
    return fail(`threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}
