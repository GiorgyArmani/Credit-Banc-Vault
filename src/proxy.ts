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

  /**
   * Paths reachable with NO session.
   *
   * Split into exact matches and prefixes on purpose. The list used to be one
   * array tested with a bare `startsWith`, and because "/" was a member of it
   * EVERY path matched — which quietly turned the anonymous-user redirect below
   * into dead code for the whole application. Keep "/" and any other bare page
   * in publicExactPaths; only put an entry in publicPathPrefixes when every path
   * beneath it is genuinely public.
   *
   * Getting this list SHORT is not the goal — getting it RIGHT is. A public
   * route missing from here now breaks (webhook, cron and share-link traffic
   * carries no session), while an over-broad prefix silently unprotects a
   * subtree. Prefer an exact entry when in doubt.
   */
  const publicExactPaths = [
    "/", // marketing landing (also hosts the affiliate signup form)
    "/affiliate", // PUBLIC affiliate program signup — /affiliate/dashboard stays gated
    "/support",
    "/terms",
  ];

  const publicPathPrefixes = [
    // Every /auth surface is by definition pre-login: login, the staff
    // invitation landing (/auth/join, which forwards to the role signup forms —
    // each refuses to render without a live invitation in ?token=), the signup
    // success pages, password reset and the magic-link entry point.
    "/auth/",
    "/r/", // public affiliate referral pre-qualification landing
    "/share/", // lender document share links — public by token, no session
    "/api/refer/", // public referral submission endpoint (NOT /api/referral-partners)
    // Signup completion endpoints: they run BEFORE the user has a session. The
    // staff variants are invite-gated inside the route itself.
    "/api/post-signup",
    "/api/reset-password",
    "/api/support",
    "/api/share/", // token-gated lender file access
    // Called by outside systems that authenticate with a shared secret or
    // signature, never with a session cookie. Redirecting these to /auth/login
    // would break GHL, SignWell, Mailgun and Telzio silently.
    "/api/webhooks/",
    // Vercel cron, authenticated with Bearer CRON_SECRET.
    "/api/cron/",
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

  /**
   * Auth pages an ALREADY authenticated user has no business on — they get sent
   * to their own dashboard instead.
   *
   * Deliberately enumerated rather than derived from the "/auth/" prefix above.
   * Several /auth routes REQUIRE a live session and must never bounce:
   * /auth/set-password (magic-link onboarding step 3 — the user is logged in by
   * the link and then chooses a password), /auth/signout, /auth/confirm and
   * /auth/magic. Sweeping the whole prefix in here would break passwordless
   * onboarding. See [[magic_link_onboarding]].
   */
  const authPagesForAnonymousOnly = [
    "/auth/login",
    "/auth/join",
    "/auth/advisor-signup",
    "/auth/advisor-signup-success",
    "/auth/underwriting-signup",
    "/auth/underwriting-signup-success",
    "/auth/setter-signup",
    "/auth/setter-signup-success",
    "/auth/sign-up-success",
    "/auth/callback",
    "/auth/update-password",
    "/auth/forgot-password",
  ];

  const isPublicPath = (p: string) =>
    publicExactPaths.includes(p) || publicPathPrefixes.some((pub) => p.startsWith(pub));

  // Not authenticated, and the path isn't public.
  if (!user && !isPublicPath(path)) {
    // An API route must answer, not redirect: a 307 to an HTML login page turns
    // a clean 401 into an unparseable response for every fetch() caller. Same
    // reasoning as the /api/admin branch further down.
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
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
      // Level-2 referral partners (CPAs, bankers, professionals). Invite-only —
      // there is no public signup page, so the whole /partner tree is gated.
      referral_partner: ["/partner"],
      // Referral partners who also WORK their deals. Same tree, and deliberately
      // NOT "/advisor": everything a partner needs is mounted under /partner, so
      // the advisor tree stays sealed to staff. That is what keeps
      // /advisor/dashboard/referrals — an unlinked route that service-role reads
      // every unworked affiliate lead — out of an external partner's reach.
      partner_advisor: ["/partner"],
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

    const isPublicPathForUser = isPublicPath(path);

    // If client hasn't finished onboarding or signed contract, and is trying to access a protected page
    // (but not the onboarding page itself, the onboarding API, or public paths)
    // Admins are never subject to the onboarding gate
    if (isClient && !isAdmin && !isOnboardingComplete && !path.startsWith("/onboarding") && !path.startsWith("/api/onboarding") && !isPublicPathForUser) {
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
          referral_partner: "/partner/dashboard",
          partner_advisor: "/partner/deals",
          free: isOnboardingComplete ? "/dashboard" : "/onboarding",
        };
        return redirectWithCookies(adminRedirectMap[userRole] || "/dashboard");
      }
    }

    // Check if user is trying to access a role-specific route
    // Admins bypass all role-specific guards — they can access /advisor/* and /underwriting/* freely
    if (!isAdmin) {
      // Collect EVERY role that owns the matched prefix before deciding, rather
      // than denying on the first one that doesn't match the caller.
      //
      // A prefix can be shared: /partner is home to both referral_partner (the
      // read-only referral book) and partner_advisor (the same person with the
      // deal desk enabled). Deciding per-entry denied a partner_advisor on the
      // referral_partner entry, because that one is iterated first — the user
      // was bounced before their own entry was ever reached.
      const allowedRoles = new Set<string>();
      let isRoleProtected = false;

      for (const [role, routes] of Object.entries(roleRoutes)) {
        if (routes.some((route) => path.startsWith(route))) {
          isRoleProtected = true;
          allowedRoles.add(role);
        }
      }

      if (isRoleProtected && !allowedRoles.has(userRole)) {
        console.warn(
          `[RBAC] Access denied for user ${user.id} with role ${userRole} attempting to access ${path} ` +
            `(allowed: ${Array.from(allowedRoles).join(", ")})`
        );

        // Redirect to their appropriate dashboard
        const redirectMap: Record<string, string> = {
          advisor: "/advisor/dashboard",
          underwriting: "/underwriting/dashboard",
          setter: "/setter/dashboard",
          affiliate: "/affiliate/dashboard",
          referral_partner: "/partner/dashboard",
          partner_advisor: "/partner/deals",
          admin: "/admin/dashboard",
          free: isOnboardingComplete ? "/dashboard" : "/onboarding",
        };

        return redirectWithCookies(redirectMap[userRole] || "/dashboard");
      }
    }

    // Redirect from generic /dashboard to role-specific dashboard
    if (path === "/dashboard") {
      const redirectMap: Record<string, string> = {
        advisor: "/advisor/dashboard",
        underwriting: "/underwriting/dashboard",
        setter: "/setter/dashboard",
        affiliate: "/affiliate/dashboard",
        referral_partner: "/partner/dashboard",
        partner_advisor: "/partner/deals",
        admin: "/admin/dashboard",
        free: isOnboardingComplete ? "/dashboard" : "/onboarding",
      };

      if (userRole in redirectMap && userRole !== "free") {
        return redirectWithCookies(redirectMap[userRole]);
      }
      if (!isOnboardingComplete) {
        return redirectWithCookies(redirectMap[userRole] || "/onboarding");
      }
    }

    // Redirect authenticated users away from auth pages
    if (authPagesForAnonymousOnly.some((p) => path.startsWith(p))) {
      const redirectMap: Record<string, string> = {
        advisor: "/advisor/dashboard",
        underwriting: "/underwriting/dashboard",
        setter: "/setter/dashboard",
        affiliate: "/affiliate/dashboard",
        referral_partner: "/partner/dashboard",
        partner_advisor: "/partner/deals",
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
