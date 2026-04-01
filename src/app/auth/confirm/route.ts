import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Auth Confirmation Route (PKCE)
 * 
 * This route handles magic link and OTP verification using token hashes.
 * It is compatible with Next.js Server Components and Middleware.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/dashboard'

  const redirectTo = request.nextUrl.clone()
  redirectTo.pathname = next
  redirectTo.searchParams.delete('token_hash')
  redirectTo.searchParams.delete('type')

  if (token_hash && type) {
    const supabase = await createClient()

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    })
    
    if (!error) {
      console.log(`✅ Magic Link Verified for type: ${type}`);
      // Redirect to the intended page (e.g., /dashboard)
      redirectTo.searchParams.delete('next')
      return NextResponse.redirect(redirectTo)
    } else {
      console.error("❌ Magic Link Verification Error:", error.message);
    }
  }

  // Return the user to an error page with some instructions
  console.log("❌ Magic Link Verification Failed - Redirecting to login");
  const errorRedirect = request.nextUrl.clone();
  errorRedirect.pathname = '/auth/login';
  errorRedirect.searchParams.set('error', 'verification_failed');
  return NextResponse.redirect(errorRedirect)
}
