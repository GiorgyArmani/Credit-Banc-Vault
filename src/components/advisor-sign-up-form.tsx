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
      <Card className="shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden bg-white/80 backdrop-blur-xl">
        <CardHeader className="p-10 text-center">
          <CardTitle className="text-4xl font-black text-emerald-950 uppercase tracking-tighter mb-2 leading-none">Advisor Access</CardTitle>
          <CardDescription className="text-sm font-bold text-emerald-900/40 uppercase tracking-widest mt-2">
            Create your account to manage applications
          </CardDescription>
        </CardHeader>
        <CardContent className="p-10 pt-0">
          <form onSubmit={handleAdvisorSignUp}>
            <div className="flex flex-col gap-8">

              {/* Profile Picture Upload Space */}
              <div className="flex flex-col items-center gap-6 py-4">
                <div className="relative group cross-cursor" onClick={triggerUpload}>
                  <div className="absolute inset-0 bg-emerald-500 rounded-[2.5rem] blur-2xl opacity-20 group-hover:opacity-40 transition-opacity" />
                  <Avatar className="h-32 w-32 border-4 border-white shadow-2xl relative z-10 rounded-[2.5rem] overflow-hidden bg-emerald-50 transition-transform group-hover:scale-105 active:scale-95 duration-500">
                    <AvatarImage src={previewUrl || undefined} className="object-cover" />
                    <AvatarFallback className="bg-emerald-50 text-emerald-500 rounded-[2.5rem]">
                      <User className="h-16 w-16" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-3 rounded-2xl shadow-xl z-20 border-4 border-white transform transition-transform group-hover:rotate-12">
                    <Camera className="w-4 h-4" />
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/30 mb-1">Advisor Identity</p>
                  <p className="text-xs font-bold text-emerald-900/40">JPG, PNG or WEBP. Max 2MB.</p>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="first-name" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">First Name</Label>
                  <Input
                    id="first-name"
                    type="text"
                    placeholder="John"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="last-name" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Last Name</Label>
                  <Input
                    id="last-name"
                    type="text"
                    placeholder="Doe"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Work Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="advisor@creditbanc.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="phone" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Phone (Optional)</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <div className="grid gap-3">
                  <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="repeat-password" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Confirm Password</Label>
                  <Input
                    id="repeat-password"
                    type="password"
                    placeholder="••••••••"
                    required
                    value={repeatPassword}
                    onChange={(e) => setRepeatPassword(e.target.value)}
                    className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-2xl bg-red-50 p-4 border border-red-100">
                  <p className="text-sm font-bold text-red-500">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                className="h-16 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95 text-lg"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Initializing Access...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <span>Create Advisor Account</span>
                    <ArrowRight className="w-6 h-6" />
                  </div>
                )}
              </Button>
            </div>

            <div className="mt-10 text-center">
              <span className="text-emerald-900/40 font-bold">Joined before? </span>
              <Link
                href="/auth/login"
                className="text-emerald-600 font-black uppercase tracking-widest text-xs hover:underline"
              >
                Sign In
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
