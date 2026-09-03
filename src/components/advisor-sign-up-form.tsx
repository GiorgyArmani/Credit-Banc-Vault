"use client";

import { cn } from "@/lib/utils";
import { formatPhoneInput } from "@/lib/phone";
import { CTA, FIELD } from "@/components/marketing/brand-chrome";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState, useRef } from "react";
import { Camera, User, ArrowRight, Lock } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/** The invitation this form is being filled out under. Resolved server-side by
 *  the page; the form never sees an un-invited state. */
export type InviteContext = {
  token: string;
  email: string;
  firstName: string;
  lastName: string;
};

export function AdvisorSignUpForm({
  invite,
  onComplete,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  invite: InviteContext;
  /**
   * Fires once the account exists AND the advisor is signed in. The wizard
   * that mounts this form continues straight into the W-9 step — the same
   * screen, no login in between — which is why this form never navigates on
   * success by itself.
   */
  onComplete: (created: { firstName: string }) => void;
}) {
  // Form state management. Names are seeded from the invitation but stay
  // editable — an admin typing a colleague's name into an invite box is not
  // authoritative about how they spell it.
  const [firstName, setFirstName] = useState(invite.firstName);
  const [lastName, setLastName] = useState(invite.lastName);
  const [phone, setPhone] = useState("");
  const [profilePic, setProfilePic] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Fixed by the invitation, not by the person filling in the form. The signup
  // route re-checks it against the invitation, so an editable box here could
  // only ever produce a confusing rejection.
  const email = invite.email;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const router = useRouter();

  /**
   * Handles file selection and preview generation
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setProfilePic(file);

    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  /**
   * Triggers the hidden file input
   */
  const triggerUpload = () => {
    fileInputRef.current?.click();
  };

  /**
   * Handles the advisor signup process
   */
  const handleAdvisorSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsLoading(true);
    setError(null);

    // Validation: Check if passwords match
    if (password !== repeatPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    // Validation: Ensure first name is provided
    if (!firstName.trim()) {
      setError("Please provide first name");
      setIsLoading(false);
      return;
    }

    // Validation: Check password strength (minimum 6 characters)
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      setIsLoading(false);
      return;
    }

    try {
      // Step 1: Prepare profile picture (convert to base64 for server-side upload)
      let profilePicBase64: string | null = null;
      let profilePicName: string | null = null;

      if (profilePic) {
        profilePicName = profilePic.name;
        // Convert file to base64
        profilePicBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(profilePic);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (error) => reject(error);
        });
      }

      // Step 2: Normalize last name (set to null if empty)
      const normalizedLastName = lastName.trim() === "" ? null : lastName.trim();

      // Step 3: Call API to create user record
      const res = await fetch("/api/post-signup-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: normalizedLastName,
          email: email.trim().toLowerCase(),
          phone: phone.trim() || null,
          profilePicBase64,
          profilePicName,
          password,
          tags: ["creditbanc-advisor", "advisor-signup"],
          inviteToken: invite.token,
        }),
      });

      if (!res.ok) {
        const { message } = await res.json().catch(() => ({
          message: "Server error"
        }));
        throw new Error(message || "Failed advisor signup flow");
      }

      // Step 4: Sign in with the password just chosen. The route created the
      // account server-side (auto-confirmed) and left the browser without a
      // session; this is what makes the W-9 and voided-check steps that follow
      // possible without a trip through the login page.
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) {
        // The account exists either way. Sending them through the login page
        // lands them on the same paperwork via the /advisor layout takeover.
        console.error("post-signup sign-in failed:", signInError);
        router.push("/auth/login");
        return;
      }

      onComplete({ firstName: firstName.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred during signup");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
        <form onSubmit={handleAdvisorSignUp}>
            <div className="flex flex-col gap-8">

              {/* Profile Picture Upload Space */}
              <div className="flex flex-col items-center gap-6">
                <button
                  type="button"
                  className="relative group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-mint focus-visible:ring-offset-2"
                  onClick={triggerUpload}
                  aria-label="Upload a profile photo"
                >
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-cb-mint rounded-2xl blur-2xl opacity-20 group-hover:opacity-40 transition-opacity"
                  />
                  <Avatar className="h-28 w-28 border-4 border-white shadow-xl relative z-10 rounded-2xl overflow-hidden bg-cb-mint/10 transition-transform group-hover:scale-105 active:scale-95 duration-300">
                    <AvatarImage src={previewUrl || undefined} className="object-cover" />
                    <AvatarFallback className="bg-cb-mint/10 text-cb-mint rounded-2xl">
                      <User className="h-12 w-12" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-2 -right-2 bg-cb-mint text-cb-navy p-2.5 rounded-xl shadow-lg z-20 border-4 border-white transition-transform group-hover:rotate-12">
                    <Camera className="w-4 h-4" />
                  </div>
                </button>

                <div className="text-center">
                  <p className={`${FIELD.label} mb-1`}>Advisor identity</p>
                  <p className="text-xs text-cb-ink/50">JPG, PNG or WEBP. Max 2MB.</p>
                </div>

                <Input
                  ref={fileInputRef}
                  id="profile-pic"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="email" className={FIELD.label}>Work Email</Label>
                <div className="flex h-12 items-center gap-2 rounded-xl border border-black/10 bg-cb-mint/5 px-4">
                  <Lock className="h-4 w-4 shrink-0 text-cb-mint" aria-hidden />
                  <span id="email" className="truncate font-medium text-cb-ink">{email}</span>
                </div>
                <p className="text-xs text-cb-ink/50">
                  Your account is created for this address, from your invitation.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="first-name" className={FIELD.label}>First Name</Label>
                  <Input
                    id="first-name"
                    type="text"
                    placeholder="John"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={FIELD.input}
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="last-name" className={FIELD.label}>Last Name</Label>
                  <Input
                    id="last-name"
                    type="text"
                    placeholder="Doe"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={FIELD.input}
                  />
                </div>
              </div>

              <div className="grid gap-3">
                <Label htmlFor="phone" className={FIELD.label}>Phone (Optional)</Label>
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  maxLength={14}
                  placeholder="(555) 000-0000"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                  className={FIELD.input}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <div className="grid gap-3">
                  <Label htmlFor="password" className={FIELD.label}>Password</Label>
                  <PasswordInput
                    id="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={FIELD.input}
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="repeat-password" className={FIELD.label}>Confirm Password</Label>
                  <PasswordInput
                    id="repeat-password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    required
                    value={repeatPassword}
                    onChange={(e) => setRepeatPassword(e.target.value)}
                    className={FIELD.input}
                  />
                </div>
              </div>

              {error && <p className={FIELD.error}>{error}</p>}

              <button type="submit" className={`${CTA.primary} group w-full`} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <span
                      aria-hidden
                      className="h-4 w-4 animate-spin rounded-full border-2 border-primary-fixed/30 border-t-primary-fixed"
                    />
                    Creating account…
                  </>
                ) : (
                  <>
                    Create advisor account
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </div>
          </form>
    </div>
  );
}
