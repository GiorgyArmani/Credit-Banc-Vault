"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const router = useRouter();

  /**
   * Handles the advisor signup process
   * - Creates auth user via Supabase
   * - Uploads profile picture to Supabase Storage
   * - Assigns 'advisor' role in public.users table
   * - Creates entry in public.advisors table
   * - Creates contact in GHL with advisor tag
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
      // Step 1: Create the auth user in Supabase
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          // Redirect to advisor dashboard after email confirmation
          emailRedirectTo: `${window.location.origin}/advisor/dashboard`,
        },
      });

      if (error) throw error;

      // Step 2: Extract user ID from the signup response
      const userId = data.user?.id;
      if (!userId) throw new Error("User ID missing after sign up");

      // Step 3: Normalize last name (set to null if empty)
      const normalizedLastName = lastName.trim() === "" ? null : lastName.trim();

      // Step 4: Upload profile picture if provided
      let profilePicUrl: string | null = null;
      if (profilePic) {
        const fileExt = profilePic.name.split('.').pop();
        const fileName = `${userId}-${Date.now()}.${fileExt}`;
        const filePath = `advisor-profiles/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('advisor-profiles')
          .upload(filePath, profilePic, {
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          console.error("Profile picture upload error:", uploadError);
          // Continue without profile picture rather than failing
        } else {
          const { data: { publicUrl } } = supabase.storage
            .from('advisor-profiles')
            .getPublicUrl(filePath);
          profilePicUrl = publicUrl;
        }
      }

      // Step 5: Call API to create user record with 'advisor' role and GHL contact
      const res = await fetch("/api/post-signup-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          firstName: firstName.trim(),
          lastName: normalizedLastName,
          email: email.trim().toLowerCase(),
          phone: phone.trim() || null,
          profilePicUrl,
          password, // Include password for welcome email
          // Add advisor-specific tags for GHL
          tags: ["creditbanc-advisor", "advisor-signup"],
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
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Advisor Sign Up</CardTitle>
          <CardDescription>
            Create your advisor account to start managing client applications
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdvisorSignUp}>
            <div className="flex flex-col gap-6">
              {/* First Name Input */}
              <div className="grid gap-2">
                <Label htmlFor="first-name">First Name</Label>
                <Input
                  id="first-name"
                  type="text"
                  placeholder="John"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>

              {/* Last Name Input */}
              <div className="grid gap-2">
                <Label htmlFor="last-name">Last Name</Label>
                <Input
                  id="last-name"
                  type="text"
                  placeholder="Doe"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>

              {/* Email Input */}
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="advisor@creditbanc.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {/* Phone Input */}
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone (Optional)</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              {/* Profile Picture Input */}
              <div className="grid gap-2">
                <Label htmlFor="profile-pic">Profile Picture (Optional)</Label>
                <Input
                  id="profile-pic"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setProfilePic(e.target.files?.[0] || null)}
                />
                {profilePic && (
                  <p className="text-sm text-muted-foreground">
                    Selected: {profilePic.name}
                  </p>
                )}
              </div>

              {/* Password Input */}
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {/* Repeat Password Input */}
              <div className="grid gap-2">
                <Label htmlFor="repeat-password">Confirm Password</Label>
                <Input
                  id="repeat-password"
                  type="password"
                  placeholder="••••••••"
                  required
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </div>

              {/* Error Message Display */}
              {error && (
                <p className="text-sm text-red-500 font-medium">{error}</p>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? "Creating advisor account..." : "Create Advisor Account"}
              </Button>
            </div>

            {/* Login Link */}
            <div className="mt-4 text-center text-sm">
              Already have an account?{" "}
              <Link
                href="/auth/login"
                className="underline underline-offset-4 hover:text-primary"
              >
                Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
