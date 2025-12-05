// middleware.ts (in root of project)
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware for Role-Based Access Control
 * 
 * This middleware:
 * 1. Checks if user is authenticated
 * 2. Retrieves user's role from database
 * 3. Redirects users to appropriate dashboard based on role
 * 4. Protects role-specific routes (e.g., only advisors can access /advisor/*)
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Create Supabase client with cookie handling
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: "",
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: "",
            ...options,
          });
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
    "/auth/update-password",
    "/auth/forgot-password",
    "/",
  ];

  // If user is not authenticated and trying to access protected route
  if (!user && !publicPaths.some((p) => path.startsWith(p))) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
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
    const roleRoutes: Record<string, string[]> = {
      advisor: ["/advisor"],
      underwriting: ["/underwriting"],
      premium: ["/premium"],
      free: [], // Free users have access to basic /dashboard only
    };

    // Check if user is trying to access a role-specific route
    for (const [role, routes] of Object.entries(roleRoutes)) {
      for (const route of routes) {
        if (path.startsWith(route) && userRole !== role) {
          // User doesn't have permission, redirect to their appropriate dashboard
          const redirectMap: Record<string, string> = {
            advisor: "/advisor/dashboard",
            underwriting: "/underwriting/dashboard",
            premium: "/dashboard",
            free: "/dashboard",
          };
          return NextResponse.redirect(
            new URL(redirectMap[userRole], request.url)
          );
        }
      }
    }

    // Redirect from generic /dashboard to role-specific dashboard
    if (path === "/dashboard") {
      const redirectMap: Record<string, string> = {
        advisor: "/advisor/dashboard",
        underwriting: "/underwriting/dashboard",
        premium: "/dashboard", // Premium users stay on /dashboard
        free: "/dashboard", // Free users stay on /dashboard
      };

      if (userRole === "advisor" || userRole === "underwriting") {
        return NextResponse.redirect(
          new URL(redirectMap[userRole], request.url)
        );
      }
    }

    // Redirect authenticated users away from auth pages
    if (publicPaths.some((p) => path.startsWith(p) && p.includes("/auth/"))) {
      const redirectMap: Record<string, string> = {
        advisor: "/advisor/dashboard",
        underwriting: "/underwriting/dashboard",
        premium: "/dashboard",
        free: "/dashboard",
      };
      return NextResponse.redirect(
        new URL(redirectMap[userRole], request.url)
      );
    }

  }

  return response;
}

// Configure which routes the middleware should run on
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