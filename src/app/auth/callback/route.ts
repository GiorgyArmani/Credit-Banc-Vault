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
  
  // Get the origin for building redirect URLs
  const origin = requestUrl.origin;

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

      if (!session) {
        return NextResponse.redirect(`${origin}/auth/login?error=no_session`);
      }

      // Step 2: Get the user's role from the public.users table
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (userError) {
        console.error("User data fetch error:", userError);
        // If we can't get role, default to regular dashboard
        return NextResponse.redirect(`${origin}/dashboard`);
      }

      // Step 3: Redirect based on user role
      const roleRedirects: Record<string, string> = {
        "advisor": "/advisor/dashboard",
        "underwriting": "/underwriting/dashboard",
        "premium": "/dashboard",
        "free": "/dashboard",
      };

      const redirectPath = roleRedirects[userData.role] || "/dashboard";
      
      console.log(`✅ User ${session.user.email} authenticated with role: ${userData.role}`);
      console.log(`➡️  Redirecting to: ${redirectPath}`);

      return NextResponse.redirect(`${origin}${redirectPath}`);

    } catch (error) {
      console.error("Auth callback error:", error);
      return NextResponse.redirect(`${origin}/auth/login?error=callback_failed`);
    }
  }

  // If no code is present, redirect to login
  return NextResponse.redirect(`${origin}/auth/login?error=no_code`);
}