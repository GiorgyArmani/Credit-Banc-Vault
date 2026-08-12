"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { BrandCard, Eyebrow, CTA, FIELD } from "@/components/marketing/brand-chrome";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Lock, Mail } from "lucide-react";

export default function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  /**
   * Handles login with role-based redirect
   */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      // Step 1: Authenticate the user
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;

      // Step 2: Get the authenticated user's ID
      const userId = authData.user?.id;
      if (!userId) {
        throw new Error("User ID not found after login");
      }

      // Step 3: Fetch user's role from the public.users table
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("role")
        .eq("id", userId)
        .single();

      if (userError) {
        console.error("Error fetching user role:", userError);
        router.push("/dashboard");
        return;
      }

      // Step 4: Map roles to their respective dashboard URLs
      // Every role needs an entry. A missing one falls through to /dashboard,
      // which the proxy then re-routes — it works, but as a second redirect the
      // user can see. affiliate and referral_partner were relying on that.
      const roleRedirects: Record<string, string> = {
        admin: "/admin/dashboard",
        advisor: "/advisor/dashboard",
        underwriting: "/underwriting/dashboard",
        setter: "/setter/dashboard",
        affiliate: "/affiliate/dashboard",
        referral_partner: "/partner/dashboard",
        partner_advisor: "/partner/deals",
        free: "/dashboard",
      };

      // Step 5: Redirect to the appropriate dashboard based on role
      const redirectPath = roleRedirects[userData.role] || "/dashboard";
      router.push(redirectPath);

    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <BrandCard>
        <Eyebrow className="mb-3">Access the vault</Eyebrow>
        <h1 className="font-headline text-4xl font-extrabold leading-tight tracking-tight text-cb-ink">
          Welcome <span className="text-cb-mint">back</span>
        </h1>

        <form onSubmit={handleLogin} className="mt-8">
          <div className="flex flex-col gap-6">
            {/* Email Input Field */}
            <div className="grid gap-2">
              <Label htmlFor="email" className={FIELD.label}>
                Email address
              </Label>
              <div className="relative">
                <Mail className={FIELD.icon} />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={FIELD.inputWithIcon}
                />
              </div>
            </div>

            {/* Password Input Field */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className={FIELD.label}>
                  Password
                </Label>
                <Link
                  href="/auth/forgot-password"
                  className="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-cb-mint transition-colors hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className={FIELD.icon} />
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  name="password"
                  onChange={(e) => setPassword(e.target.value)}
                  className={FIELD.inputWithIcon}
                />
              </div>
            </div>

            {/* Error Message Display */}
            {error && <p className={FIELD.error}>{error}</p>}

            {/* Submit Button */}
            <button type="submit" className={`${CTA.primary} group w-full`} disabled={isLoading}>
              {isLoading ? (
                <>
                  <span
                    aria-hidden
                    className="h-4 w-4 animate-spin rounded-full border-2 border-primary-fixed/30 border-t-primary-fixed"
                  />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
          </div>
        </form>
      </BrandCard>
    </div>
  );
}