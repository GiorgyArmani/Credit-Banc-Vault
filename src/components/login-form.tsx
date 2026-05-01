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
      const roleRedirects: Record<string, string> = {
        admin: "/admin/dashboard",
        advisor: "/advisor/dashboard",
        underwriting: "/underwriting/dashboard",
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
      <Card className="shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl">
        <CardHeader className="p-10 text-center">
          <CardTitle className="text-4xl font-black text-emerald-950 uppercase tracking-tighter mb-2 leading-none">Login</CardTitle>
          <CardDescription className="text-sm font-bold text-emerald-900/40 uppercase tracking-widest mt-2">
            Access the Credit Banc Vault
          </CardDescription>
        </CardHeader>
        <CardContent className="p-10 pt-0">
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-8">
              {/* Email Input Field */}
              <div className="grid gap-3">
                <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-900/20" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@company.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold pl-12 pr-6"
                  />
                </div>
              </div>

              {/* Password Input Field */}
              <div className="grid gap-3">
                <div className="flex items-center justify-between px-1">
                  <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Password</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-500 transition-colors"
                  >
                    Forgot Password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-900/20" />
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    name="password"
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold pl-12 pr-6"
                  />
                </div>
              </div>

              {/* Error Message Display */}
              {error && (
                <div className="rounded-2xl bg-red-50 p-4 border border-red-100">
                  <p className="text-sm font-bold text-red-500">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button type="submit" className="h-16 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95 text-lg" disabled={isLoading}>
                {isLoading ? (
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Signing in...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <span>Sign In</span>
                    <ArrowRight className="w-6 h-6" />
                  </div>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}