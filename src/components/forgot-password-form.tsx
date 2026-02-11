"use client";

import { cn } from "@/lib/utils";
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
import { useState } from "react";
import { Mail, ArrowRight } from "lucide-react";

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "An error occurred");
      }

      setSuccess(true);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {success ? (
        <Card className="shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl">
          <CardHeader className="p-10 text-center">
            <div className="mx-auto w-20 h-20 bg-emerald-50 rounded-[2rem] flex items-center justify-center mb-6 border border-emerald-100 shadow-inner">
              <Mail className="w-10 h-10 text-emerald-500" />
            </div>
            <CardTitle className="text-3xl font-black text-emerald-950 uppercase tracking-tighter">Check Your Email</CardTitle>
            <CardDescription className="text-sm font-bold text-emerald-900/40 mt-2">Password reset instructions sent</CardDescription>
          </CardHeader>
          <CardContent className="p-10 pt-0">
            <p className="text-sm font-bold text-emerald-950/60 leading-relaxed text-center">
              If you registered using your email and password, you will receive
              a password reset email shortly.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl">
          <CardHeader className="p-10">
            <CardTitle className="text-3xl font-black text-emerald-950 uppercase tracking-tighter">Reset Password</CardTitle>
            <CardDescription className="text-sm font-bold text-emerald-900/40 mt-2">
              Type in your email and we&apos;ll send you a link to reset your
              password
            </CardDescription>
          </CardHeader>
          <CardContent className="p-10 pt-0">
            <form onSubmit={handleForgotPassword}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-4">
                  <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="m@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                  />
                </div>
                {error && <p className="text-sm font-bold text-red-500 bg-red-50 p-4 rounded-2xl border border-red-100">{error}</p>}
                <Button type="submit" className="h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95" disabled={isLoading}>
                  {isLoading ? "Sending..." : "Send reset email"}
                </Button>
              </div>
              <div className="mt-8 text-center text-sm">
                <span className="text-emerald-900/40 font-bold">Already have an account? </span>
                <Link
                  href="/auth/login"
                  className="text-emerald-600 font-black uppercase tracking-widest text-xs hover:underline"
                >
                  Login
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
