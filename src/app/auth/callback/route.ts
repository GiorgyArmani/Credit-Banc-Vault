// app/auth/callback/route.ts
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Auth Callback Route
 * Handles email verification and role-based redirects
 * 
 * Flow:
 * 1. User clicks email verification link
 * 2. Supabase redirects to this callback with auth code
 * 3. We exchange the code for a session
 * 4. We check the user's role from the database
 * 5. We redirect to the appropriate dashboard
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);

  // Get the auth code from the URL (sent by Supabase)
  const code = requestUrl.searchParams.get("code");

  // Check for 'next' param to detect password reset flow
  const next = requestUrl.searchParams.get("next");

  // Get the origin for building redirect URLs
  const origin = requestUrl.origin;

  // Special handling for password reset flow
  // Password reset uses PKCE flow with tokens in hash fragment, not code exchange
  if (next === "/auth/update-password") {
    console.log("🔐 Password reset flow detected, redirecting to update-password page");
    // Redirect to update-password page - hash fragment will be preserved by browser
    return NextResponse.redirect(`${origin}/auth/update-password`);
  }

  if (code) {
    const supabase = await createClient();

    try {
      // Step 1: Exchange the code for a session
      const { data: { session }, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

      if (sessionError) {
        console.error("Session exchange error:", sessionError);
        // Redirect to login with error message
        return NextResponse.redirect(`${origin}/auth/login?error=verification_failed`);
      }

      // Step 2: Get a verified user object from Supabase Auth
      // This is crucial for security as it verifies the session on the server
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error("User fetch error after session exchange:", userError);
        return NextResponse.redirect(`${origin}/auth/login?error=no_user`);
      }

      // Step 3: Get the user's role from the public.users table
      const { data: userData, error: dbError } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();

      if (dbError) {
        console.error("User data fetch error:", dbError);
        // If we can't get role, default to regular dashboard
        return NextResponse.redirect(`${origin}/dashboard`);
      }

      // Check for 'next' param to redirect to specific page
      if (next) {
        console.log(`✅ Redirecting to: ${next}`);
        return NextResponse.redirect(`${origin}${next}`);
      }

      // Step 3: Redirect based on user role
      const roleRedirects: Record<string, string> = {
        "advisor": "/advisor/dashboard",
        "underwriting": "/underwriting/dashboard",
        "admin": "/admin/dashboard",
        "free": "/dashboard",
      };

      const redirectPath = roleRedirects[userData.role] || "/dashboard";

      console.log(`✅ User ${user.email} authenticated with role: ${userData.role}`);
      console.log(`➡️  Redirecting to: ${redirectPath}`);

      return NextResponse.redirect(`${origin}${redirectPath}`);

    } catch (error) {
      console.error("Auth callback error:", error);
      return NextResponse.redirect(`${origin}/auth/login?error=callback_failed`);
    }
  }

  // If no code is present, redirect to login
  console.log("❌ No auth code found in callback");
  return NextResponse.redirect(`${origin}/auth/login?error=no_code`);
}