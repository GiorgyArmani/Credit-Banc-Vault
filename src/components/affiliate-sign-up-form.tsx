"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";
import { Gift, ArrowRight, Lock, CheckCircle, Mail } from "lucide-react";
import { formatPhoneInput, isValidUsPhone } from "@/lib/phone";

// Public affiliate self-signup form. Embedded on the marketing landing page.
// No invite code (public program). On success it shows an inline confirmation;
// the affiliate then logs in through the unified vault login (/auth/login).
//
// The contact opt-in is MANDATORY — it is the email/SMS consent record for the
// "I Know Someone" Club, so signup is blocked without it (also enforced
// server-side in /api/post-signup-affiliate, which stores the consent stamp).
export function AffiliateSignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [contactOptIn, setContactOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleAffiliateSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    // Phone is what the SMS half of the opt-in below actually needs.
    if (!isValidUsPhone(phone)) {
      setError("Please enter a valid 10-digit US phone number");
      setIsLoading(false);
      return;
    }

    if (password !== repeatPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      setIsLoading(false);
      return;
    }

    if (!contactOptIn) {
      setError("Please check the contact opt-in box so we can send you referral updates.");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/post-signup-affiliate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          password,
          contactOptIn,
        }),
      });

      if (!res.ok) {
        const { message } = await res.json().catch(() => ({
          message: "Server error",
        }));
        throw new Error(message || "Failed affiliate signup");
      }

      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || "An error occurred during signup");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <div className="rounded-2xl overflow-hidden border border-black/5 bg-white p-8 sm:p-12 text-center shadow-[0_24px_60px_-25px_rgba(0,3,33,0.18)]">
          <div className="mx-auto w-16 h-16 bg-cb-mint/10 rounded-xl flex items-center justify-center mb-6">
            <CheckCircle className="h-8 w-8 text-cb-mint" />
          </div>
          <h3 className="font-manrope text-3xl font-extrabold tracking-tight mb-3 text-cb-ink">You're in!</h3>
          <p className="text-cb-ink/50 mb-6">
            Your affiliate account is ready. Log in to grab your referral link and start earning.
          </p>

          {/* The welcome email carries their referral link, and it is a
              marketing-shaped send — Gmail files it under Promotions often
              enough that people report "I never got it". Say so up front. */}
          <div className="mb-8 flex items-start gap-3 rounded-xl bg-cb-mint/5 px-4 py-3.5 text-left ring-1 ring-cb-mint/20">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-cb-mint" />
            <p className="text-[13px] leading-relaxed text-cb-ink/60">
              Check your inbox for{" "}
              <span className="font-semibold text-cb-ink">
                &ldquo;You&rsquo;re In. Go Know Someone.&rdquo;
              </span>{" "}
              &mdash; it has your referral link. If it isn&rsquo;t there, look in
              your <span className="font-semibold text-cb-ink">Promotions</span>{" "}
              tab or spam folder and drag it into your inbox so the next one
              lands where you&rsquo;ll see it.
            </p>
          </div>

          <Button
            asChild
            className="h-14 px-8 bg-cb-mint hover:bg-cb-mint/90 text-cb-navy font-bold rounded-xl shadow-lg shadow-cb-mint/25 text-lg transition-all hover:scale-[1.02] active:scale-95"
          >
            <Link href="/auth/login">
              Log in to your dashboard
              <ArrowRight className="ml-2 w-5 h-5" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="rounded-2xl border border-black/5 bg-white p-6 sm:p-8 md:p-10 shadow-[0_24px_60px_-25px_rgba(0,3,33,0.18)]">
        <div className="mb-8">
          <div className="w-11 h-11 rounded-xl bg-cb-mint/10 flex items-center justify-center mb-5">
            <Gift className="h-6 w-6 text-cb-mint" />
          </div>
          <h3 className="font-manrope text-3xl font-extrabold tracking-tight text-cb-ink leading-tight">Join the Club</h3>
          <p className="text-sm font-semibold text-cb-mint mt-2">
            Free to join. No referral limits. What&rsquo;ve you got to lose?
          </p>
        </div>
          <form onSubmit={handleAffiliateSignUp}>
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="aff-first-name" className="text-sm font-semibold text-cb-ink">First Name</Label>
                  <Input
                    id="aff-first-name"
                    type="text"
                    placeholder="John"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="h-12 rounded-xl border-black/10 bg-white px-4 font-medium placeholder:text-cb-gray/60 focus-visible:ring-cb-mint/40 transition-all"
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="aff-last-name" className="text-sm font-semibold text-cb-ink">Last Name</Label>
                  <Input
                    id="aff-last-name"
                    type="text"
                    placeholder="Doe"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="h-12 rounded-xl border-black/10 bg-white px-4 font-medium placeholder:text-cb-gray/60 focus-visible:ring-cb-mint/40 transition-all"
                  />
                </div>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="aff-email" className="text-sm font-semibold text-cb-ink">Email</Label>
                <Input
                  id="aff-email"
                  type="email"
                  placeholder="name@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 rounded-xl border-black/10 bg-white px-4 font-medium placeholder:text-cb-gray/60 focus-visible:ring-cb-mint/40 transition-all"
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="aff-phone" className="text-sm font-semibold text-cb-ink">Mobile Phone</Label>
                <Input
                  id="aff-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(555) 123-4567"
                  required
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                  className="h-12 rounded-xl border-black/10 bg-white px-4 font-medium placeholder:text-cb-gray/60 focus-visible:ring-cb-mint/40 transition-all"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="aff-password" className="text-sm font-semibold text-cb-ink">Password</Label>
                  <PasswordInput
                    id="aff-password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 rounded-xl border-black/10 bg-white px-4 font-medium placeholder:text-cb-gray/60 focus-visible:ring-cb-mint/40 transition-all"
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="aff-repeat-password" className="text-sm font-semibold text-cb-ink">Confirm Password</Label>
                  <PasswordInput
                    id="aff-repeat-password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    required
                    value={repeatPassword}
                    onChange={(e) => setRepeatPassword(e.target.value)}
                    className="h-12 rounded-xl border-black/10 bg-white px-4 font-medium placeholder:text-cb-gray/60 focus-visible:ring-cb-mint/40 transition-all"
                  />
                </div>
              </div>

              {/* Mandatory contact opt-in — this is the consent record. */}
              <div
                className={cn(
                  "rounded-xl border p-5 transition-colors",
                  contactOptIn
                    ? "border-cb-mint/40 bg-cb-mint/5"
                    : "border-cb-mint/20 bg-white"
                )}
              >
                <div className="flex items-start gap-4">
                  <Checkbox
                    id="aff-contact-opt-in"
                    checked={contactOptIn}
                    onCheckedChange={(checked) => setContactOptIn(checked === true)}
                    aria-required="true"
                    className="mt-1 h-5 w-5 rounded-md border-cb-mint/50 data-[state=checked]:bg-cb-mint data-[state=checked]:border-cb-mint data-[state=checked]:text-cb-navy focus-visible:ring-cb-mint/40"
                  />
                  <div className="grid gap-2">
                    <Label
                      htmlFor="aff-contact-opt-in"
                      className="font-manrope text-base font-bold text-cb-ink leading-tight cursor-pointer"
                    >
                      Fine, You May Contact Me
                    </Label>
                    <p className="text-sm text-cb-ink/60 leading-relaxed">
                      I&rsquo;m okay with the occasional email or text from Credit Banc about the
                      &ldquo;I Know Someone&rdquo; Club, referral updates, and other reasonably
                      important club business. Please use this power responsibly.
                    </p>
                    <p className="text-[11px] text-cb-ink/40 leading-relaxed">
                      Message frequency varies. Message and data rates may apply. Reply STOP to
                      unsubscribe.
                    </p>
                    <p className="text-[11px] text-cb-ink/40 leading-relaxed">
                      I also agree to the{" "}
                      <Link
                        href="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-cb-mint hover:underline"
                      >
                        Terms and Conditions
                      </Link>{" "}
                      and{" "}
                      <a
                        href="https://www.creditbanc.io/privacypolicy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-cb-mint hover:underline"
                      >
                        Privacy Policy
                      </a>
                      .
                    </p>
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 p-4 border border-red-100 flex items-center gap-3">
                  <Lock className="w-4 h-4 text-red-500" />
                  <p className="text-sm font-bold text-red-500">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                className="h-16 bg-cb-mint hover:bg-cb-mint/90 text-cb-navy font-bold rounded-xl shadow-lg shadow-cb-mint/25 transition-all hover:scale-[1.02] active:scale-95 text-lg"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Creating Account...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <span>Create My Affiliate Account</span>
                    <ArrowRight className="w-6 h-6" />
                  </div>
                )}
              </Button>
            </div>

            <div className="mt-8 text-center border-t border-black/5 pt-6">
              <Link href="/auth/login" className="text-cb-gray hover:text-cb-ink transition-colors text-sm font-semibold">
                Already an affiliate? <span className="text-cb-mint font-bold">Log in</span>
              </Link>
            </div>
          </form>
      </div>
    </div>
  );
}
