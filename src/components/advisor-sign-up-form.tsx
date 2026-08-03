"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { formatPhoneInput } from "@/lib/phone";
import { BrandCard, Eyebrow, CTA, FIELD } from "@/components/marketing/brand-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef } from "react";
import { Camera, User, Pencil, ArrowRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function AdvisorSignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  // Form state management
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [profilePic, setProfilePic] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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
    const supabase = createClient();

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
          inviteCode: inviteCode.trim(),
        }),
      });

      if (!res.ok) {
        const { message } = await res.json().catch(() => ({
          message: "Server error"
        }));
        throw new Error(message || "Failed advisor signup flow");
      }

      // Step 6: Redirect to success page
      router.push("/auth/advisor-signup-success");
    } catch (err: any) {
      setError(err?.message || "An error occurred during signup");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <BrandCard>
        <div className="text-center">
          <Eyebrow className="mb-3">Advisor access</Eyebrow>
          <h1 className="font-headline text-4xl font-extrabold leading-tight tracking-tight text-cb-ink">
            Create your <span className="text-cb-mint">account</span>
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-cb-ink/70">
            Everything you need to manage applications, in one place.
          </p>
        </div>

        <form onSubmit={handleAdvisorSignUp} className="mt-10">
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
                <Label htmlFor="invite-code" className={FIELD.label}>Invite Code</Label>
                <Input
                  id="invite-code"
                  type="text"
                  placeholder="Enter your invite code"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className={FIELD.input}
                />
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="email" className={FIELD.label}>Work Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="advisor@creditbanc.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={FIELD.input}
                  />
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
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <div className="grid gap-3">
                  <Label htmlFor="password" className={FIELD.label}>Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={FIELD.input}
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="repeat-password" className={FIELD.label}>Confirm Password</Label>
                  <Input
                    id="repeat-password"
                    type="password"
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

            <p className="mt-8 text-center text-sm text-cb-ink/50">
              Joined before?{" "}
              <Link href="/auth/login" className="font-bold text-cb-mint hover:underline">
                Sign in
              </Link>
            </p>
          </form>
      </BrandCard>
    </div>
  );
}
