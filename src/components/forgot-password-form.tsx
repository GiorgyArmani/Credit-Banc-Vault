"use client";

import { cn } from "@/lib/utils";
import {
  BrandCard,
  BrandIconTile,
  Eyebrow,
  CTA,
  FIELD,
} from "@/components/marketing/brand-chrome";
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
        <BrandCard className="text-center">
          <BrandIconTile size="lg" className="mb-7">
            <Mail className="h-8 w-8" />
          </BrandIconTile>
          <Eyebrow className="mb-3">Instructions sent</Eyebrow>
          <h1 className="font-headline text-3xl font-extrabold leading-tight tracking-tight text-cb-ink">
            Check your <span className="text-cb-mint">email</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-cb-ink/70">
            If you registered with your email and password, a reset link is on its way.
          </p>
        </BrandCard>
      ) : (
        <BrandCard>
          <Eyebrow className="mb-3">Account recovery</Eyebrow>
          <h1 className="font-headline text-3xl font-extrabold leading-tight tracking-tight text-cb-ink">
            Reset your <span className="text-cb-mint">password</span>
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-cb-ink/70">
            Give us your email and we&apos;ll send you a link to set a new one.
          </p>

          <form onSubmit={handleForgotPassword} className="mt-8">
            <div className="flex flex-col gap-6">
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
              {error && <p className={FIELD.error}>{error}</p>}
              <button type="submit" className={`${CTA.primary} w-full`} disabled={isLoading}>
                {isLoading ? "Sending…" : "Send reset email"}
              </button>
            </div>
            <p className="mt-8 text-center text-sm text-cb-ink/50">
              Already have an account?{" "}
              <Link href="/auth/login" className="font-bold text-cb-mint hover:underline">
                Log in
              </Link>
            </p>
          </form>
        </BrandCard>
      )}
    </div>
  );
}
