// src/proxy.ts
//
// Next.js 16 renamed middleware.ts → proxy.ts. Lives at src/proxy.ts because
// the app directory is at src/app — proxy must sit next to the app dir.
// Runs on the Node.js runtime (proxy default in Next 16).
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy for Role-Based Access Control
 *
 * 1. Checks if user is authenticated
 * 2. Retrieves user's role from database
 * 3. Redirects users to appropriate dashboard based on role
 * 4. Protects role-specific routes (e.g., only advisors can access /advisor/*)
 * 5. Gates /admin/* and /api/admin/* to admins only
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    }
  );

  // Get the current path
  const path = request.nextUrl.pathname;

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Define public paths that don't require authentication
  const publicPaths = [
    "/auth/login",
    "/auth/advisor-signup",
    "/auth/callback",
    "/auth/sign-up-success",
    "/auth/advisor-signup-success",
    "/auth/underwriting-signup",
    "/auth/underwriting-signup-success",
    "/auth/setter-signup",
    "/auth/setter-signup-success",
    "/auth/update-password",
    "/auth/forgot-password",
    "/r/", // public affiliate referral pre-qualification landing
    "/api/refer", // public referral submission endpoint
    "/api/post-signup-affiliate", // public affiliate self-signup (form lives on "/")
    "/",
  ];

  // Helper to create a redirect response that preserves cookies
  const redirectWithCookies = (url: string | URL) => {
    const redirectResponse = NextResponse.redirect(new URL(url, request.url));
    // Copy all cookies from supabaseResponse to the redirect response
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
    return redirectResponse;
  };

  // If user is not authenticated and trying to access protected route
  if (!user && !publicPaths.some((p) => path.startsWith(p))) {
    return redirectWithCookies("/auth/login");
  }

  // If user is authenticated, check role-based access
  if (user) {
    // Get user's role from database
    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const userRole = userData?.role || "free";

    // Role-based route protection
    // admin is intentionally absent — they bypass all role-specific guards
    const roleRoutes: Record<string, string[]> = {
      advisor: ["/advisor"],
      underwriting: ["/underwriting"],
      setter: ["/setter"], // Appointment setters: create-only fast-funding dashboard
      // Only the dashboard is role-gated — /affiliate (index) is the PUBLIC signup page.
      affiliate: ["/affiliate/dashboard"],
      free: [], // Free users have access to basic /dashboard only
    };

    // Client Onboarding & Contract Check
    let isOnboardingComplete = user.user_metadata?.onboarding_complete === true;
    const isClient = userRole === "free";
    const isAdmin = userRole === "admin";

    // Direct database check for contract status to avoid stale metadata
    let isContractCompleted = false;
    if (isClient) {
      const { data: vaultData } = await supabase
        .from("client_data_vault")
        .select("contract_completed")
        .eq("user_id", user.id)
        .maybeSingle();

      isContractCompleted = vaultData?.contract_completed === true;

      // If metadata says incomplete but DB says contract is done,
      // we might still be in the "video" step, so we respect metadata for those.
      // But if DB says contract is NOT done, we FORCE onboarding regardless of metadata.
      if (!isContractCompleted) {
        isOnboardingComplete = false;
      }
    }

    const isPublicPath = publicPaths.some((p) =>
      p === "/" ? path === "/" : path.startsWith(p)
    );

    // If client hasn't finished onboarding or signed contract, and is trying to access a protected page
    // (but not the onboarding page itself, the onboarding API, or public paths)
    // Admins are never subject to the onboarding gate
    if (isClient && !isAdmin && !isOnboardingComplete && !path.startsWith("/onboarding") && !path.startsWith("/api/onboarding") && !isPublicPath) {
      console.log(`[Onboarding] User ${user.id} incomplete (Contract: ${isContractCompleted}), redirecting to /onboarding`);
      return redirectWithCookies("/onboarding");
    }

    // /admin/* and /api/admin/* require admin role.
    // Non-admins on /admin/* get redirected to their own dashboard.
    // Non-admins on /api/admin/* get a JSON 403 (don't redirect — breaks API clients).
    if (!isAdmin) {
      if (path.startsWith("/api/admin")) {
        console.warn(`[RBAC] Non-admin user ${user.id} (role=${userRole}) hit ${path}`);
        return NextResponse.json(
          { error: "Forbidden — admin role required" },
          { status: 403 }
        );
      }
      if (path.startsWith("/admin")) {
        console.warn(`[RBAC] Non-admin user ${user.id} (role=${userRole}) attempted to access ${path}`);
        const adminRedirectMap: Record<string, string> = {
          advisor: "/advisor/dashboard",
          underwriting: "/underwriting/dashboard",
          setter: "/setter/dashboard",
          affiliate: "/affiliate/dashboard",
          free: isOnboardingComplete ? "/dashboard" : "/onboarding",
        };
        return redirectWithCookies(adminRedirectMap[userRole] || "/dashboard");
      }
    }

    // Check if user is trying to access a role-specific route
    // Admins bypass all role-specific guards — they can access /advisor/* and /underwriting/* freely
    if (!isAdmin) {
      for (const [role, routes] of Object.entries(roleRoutes)) {
        for (const route of routes) {
          if (path.startsWith(route)) {
            // If the path is role-protected and user doesn't have THAT role
            if (userRole !== role) {
              console.warn(`[RBAC] Access denied for user ${user.id} with role ${userRole} attempting to access ${path}`);

              // Redirect to their appropriate dashboard
              const redirectMap: Record<string, string> = {
                advisor: "/advisor/dashboard",
                underwriting: "/underwriting/dashboard",
                setter: "/setter/dashboard",
                affiliate: "/affiliate/dashboard",
                admin: "/admin/dashboard",
                free: isOnboardingComplete ? "/dashboard" : "/onboarding",
              };

              return redirectWithCookies(redirectMap[userRole] || "/dashboard");
            }
          }
        }
      }
    }

    // Redirect from generic /dashboard to role-specific dashboard
    if (path === "/dashboard") {
      const redirectMap: Record<string, string> = {
        advisor: "/advisor/dashboard",
        underwriting: "/underwriting/dashboard",
        setter: "/setter/dashboard",
        affiliate: "/affiliate/dashboard",
        admin: "/admin/dashboard",
        free: isOnboardingComplete ? "/dashboard" : "/onboarding",
      };

      if (userRole === "advisor" || userRole === "underwriting" || userRole === "setter" || userRole === "affiliate" || userRole === "admin" || !isOnboardingComplete) {
        return redirectWithCookies(redirectMap[userRole]);
      }
    }

    // Redirect authenticated users away from auth pages
    if (publicPaths.some((p) => path.startsWith(p) && p.includes("/auth/"))) {
      const redirectMap: Record<string, string> = {
        advisor: "/advisor/dashboard",
        underwriting: "/underwriting/dashboard",
        setter: "/setter/dashboard",
        affiliate: "/affiliate/dashboard",
        admin: "/admin/dashboard",
        free: isOnboardingComplete ? "/dashboard" : "/onboarding",
      };
      return redirectWithCookies(redirectMap[userRole] || "/dashboard");
    }
  }

  return supabaseResponse;
}

// Configure which routes the proxy should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
