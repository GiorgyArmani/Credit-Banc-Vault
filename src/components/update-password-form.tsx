"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { BrandCard, Eyebrow, CTA, FIELD } from "@/components/marketing/brand-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { toast } from "@/lib/toast";
import { Lock } from "lucide-react";

export function UpdatePasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const router = useRouter();

  // Check for recovery session on mount
  useEffect(() => {
    const checkSession = async () => {
      const supabase = createClient();

      // Extract tokens from hash if present
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const type = hashParams.get('type');

      console.log('🔐 Password reset page loaded', { hasAccessToken: !!accessToken, type });

      // If we have tokens in the hash, set the session
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          console.error('Error setting session:', error);
          setError('Invalid or expired reset link. Please request a new password reset.');
          setSessionChecked(true);
          return;
        }

        // Clear the hash from URL for security
        window.history.replaceState(null, '', window.location.pathname);
      }

      // Verify we have a valid session
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setError('No active session found. Please request a new password reset link.');
      } else {
        console.log('✅ Valid session found for password reset');
      }

      setSessionChecked(true);
    };

    checkSession();
  }, []);

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long");
      return;
    }

    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) throw error;

      console.log('✅ Password updated successfully');
      toast.success("Password updated successfully!");

      // Redirect to login page
      setTimeout(() => {
        router.push("/auth/login");
      }, 1500);

    } catch (error: unknown) {
      console.error('❌ Password update error:', error);
      setError(error instanceof Error ? error.message : "An error occurred while updating your password");
    } finally {
      setIsLoading(false);
    }
  };

  if (!sessionChecked) {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <BrandCard>
          <div className="flex flex-col items-center gap-5">
            <div
              aria-hidden
              className="h-10 w-10 animate-spin rounded-full border-4 border-cb-mint/20 border-t-cb-mint"
            />
            <p className="font-label text-xs font-bold uppercase tracking-[0.3em] text-cb-gray">
              Verifying reset link
            </p>
          </div>
        </BrandCard>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <BrandCard>
        <Eyebrow className="mb-3">Account recovery</Eyebrow>
        <h1 className="font-headline text-3xl font-extrabold leading-tight tracking-tight text-cb-ink">
          Pick a new <span className="text-cb-mint">password</span>
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-cb-ink/70">
          Enter it twice so we know it stuck.
        </p>

        <form onSubmit={handlePasswordUpdate} className="mt-8">
          <div className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="password" className={FIELD.label}>
                New password
              </Label>
              <div className="relative">
                <Lock className={FIELD.icon} />
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter new password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!!error}
                  className={FIELD.inputWithIcon}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword" className={FIELD.label}>
                Confirm password
              </Label>
              <div className="relative">
                <Lock className={FIELD.icon} />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm new password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={!!error}
                  className={FIELD.inputWithIcon}
                />
              </div>
            </div>
            {error && <p className={FIELD.error}>{error}</p>}
            <button
              type="submit"
              className={`${CTA.primary} w-full`}
              disabled={isLoading || !!error}
            >
              {isLoading ? "Updating password…" : "Update password"}
            </button>
            {error && (
              <button
                type="button"
                className={`${CTA.ghost} w-full`}
                onClick={() => router.push("/auth/forgot-password")}
              >
                Request new reset link
              </button>
            )}
          </div>
        </form>
      </BrandCard>
    </div>
  );
}
