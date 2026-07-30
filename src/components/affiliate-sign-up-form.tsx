"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useState } from "react";
import { Gift, ArrowRight, Lock, CheckCircle } from "lucide-react";
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

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
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
        <div className="rounded-3xl overflow-hidden bg-white shadow-xl border border-black/5 p-12 text-center">
          <div className="mx-auto w-16 h-16 bg-cb-mint/10 rounded-xl flex items-center justify-center mb-6">
            <CheckCircle className="h-8 w-8 text-cb-mint" />
          </div>
          <h3 className="font-manrope text-3xl font-extrabold tracking-tight mb-3 text-cb-ink">You're in!</h3>
          <p className="text-cb-ink/50 mb-8">
            Your affiliate account is ready. Log in to grab your referral link and start earning.
          </p>
          <Button
            asChild
            className="h-14 px-8 bg-cb-mint hover:bg-cb-mint/90 text-white font-bold rounded-xl shadow-lg shadow-cb-mint/25 text-lg transition-all hover:scale-[1.02] active:scale-95"
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
      <div className="rounded-3xl bg-white shadow-xl border border-black/5 p-8 md:p-10">
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
                  <Label htmlFor="aff-first-name" className="text-[11px] font-bold uppercase tracking-[0.15em] text-cb-mint/70 ml-1">First Name</Label>
                  <Input
                    id="aff-first-name"
                    type="text"
                    placeholder="John"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="h-14 rounded-xl border-cb-mint/20 bg-white focus:border-cb-mint focus:ring-cb-mint/30 transition-all font-medium px-5"
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="aff-last-name" className="text-[11px] font-bold uppercase tracking-[0.15em] text-cb-mint/70 ml-1">Last Name</Label>
                  <Input
                    id="aff-last-name"
                    type="text"
                    placeholder="Doe"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="h-14 rounded-xl border-cb-mint/20 bg-white focus:border-cb-mint focus:ring-cb-mint/30 transition-all font-medium px-5"
                  />
                </div>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="aff-email" className="text-[11px] font-bold uppercase tracking-[0.15em] text-cb-mint/70 ml-1">Email</Label>
                <Input
                  id="aff-email"
                  type="email"
                  placeholder="name@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-14 rounded-xl border-cb-mint/20 bg-white focus:border-cb-mint focus:ring-cb-mint/30 transition-all font-medium px-5"
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="aff-phone" className="text-[11px] font-bold uppercase tracking-[0.15em] text-cb-mint/70 ml-1">Mobile Phone</Label>
                <Input
                  id="aff-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(555) 123-4567"
                  required
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                  className="h-14 rounded-xl border-cb-mint/20 bg-white focus:border-cb-mint focus:ring-cb-mint/30 transition-all font-medium px-5"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="aff-password" className="text-[11px] font-bold uppercase tracking-[0.15em] text-cb-mint/70 ml-1">Password</Label>
                  <Input
                    id="aff-password"
                    type="password"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-14 rounded-xl border-cb-mint/20 bg-white focus:border-cb-mint focus:ring-cb-mint/30 transition-all font-medium px-5"
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="aff-repeat-password" className="text-[11px] font-bold uppercase tracking-[0.15em] text-cb-mint/70 ml-1">Confirm Password</Label>
                  <Input
                    id="aff-repeat-password"
                    type="password"
                    placeholder="••••••••"
                    required
                    value={repeatPassword}
                    onChange={(e) => setRepeatPassword(e.target.value)}
                    className="h-14 rounded-xl border-cb-mint/20 bg-white focus:border-cb-mint focus:ring-cb-mint/30 transition-all font-medium px-5"
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
                    className="mt-1 h-5 w-5 rounded-md border-cb-mint/50 data-[state=checked]:bg-cb-mint data-[state=checked]:border-cb-mint data-[state=checked]:text-white focus-visible:ring-cb-mint/40"
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
                className="h-16 bg-cb-mint hover:bg-cb-mint/90 text-white font-bold rounded-xl shadow-lg shadow-cb-mint/25 transition-all hover:scale-[1.02] active:scale-95 text-lg"
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
