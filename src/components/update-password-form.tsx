"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Lock, Check, Copy } from "lucide-react";

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
        <Card className="shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl">
          <CardContent className="p-10">
            <div className="flex flex-col items-center gap-4">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500"></div>
              <p className="text-center text-emerald-900/40 font-bold">Verifying reset link...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl">
        <CardHeader className="p-10">
          <CardTitle className="text-3xl font-black text-emerald-950 uppercase tracking-tighter">Reset Your Password</CardTitle>
          <CardDescription className="text-sm font-bold text-emerald-900/40 mt-2">
            Please enter your new password below.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-10 pt-0">
          <form onSubmit={handlePasswordUpdate}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-4">
                <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">New password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter new password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!!error}
                  className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                />
              </div>
              <div className="grid gap-4">
                <Label htmlFor="confirmPassword" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm new password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={!!error}
                  className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                />
              </div>
              {error && (
                <div className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-600 border border-red-100">
                  {error}
                </div>
              )}
              <Button type="submit" className="h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95" disabled={isLoading || !!error}>
                {isLoading ? "Updating password..." : "Update password"}
              </Button>
              {error && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-14 border-2 border-emerald-100 text-emerald-950 font-black rounded-2xl hover:bg-emerald-50 transition-all active:scale-95"
                  onClick={() => router.push("/auth/forgot-password")}
                >
                  Request new reset link
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
