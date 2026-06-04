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
    // Fresh single-use Supabase OTP for this click.
    const supabaseAdmin = createAdminClient();
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: verified.email,
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
