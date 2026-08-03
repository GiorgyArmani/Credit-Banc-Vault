"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
    BrandCard,
    BrandIconTile,
    Eyebrow,
    CTA,
    FIELD,
} from "@/components/marketing/brand-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Shield, ArrowRight } from "lucide-react";

export function UnderwritingSignUpForm({
    className,
    ...props
}: React.ComponentPropsWithoutRef<"div">) {
    // Form state management
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [repeatPassword, setRepeatPassword] = useState("");
    const [inviteCode, setInviteCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const router = useRouter();

    /**
     * Handles the underwriting signup process
     */
    const handleUnderwritingSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        // Validation: Check if passwords match
        if (password !== repeatPassword) {
            setError("Passwords do not match");
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
            // Call API to create user record
            const res = await fetch("/api/post-signup-underwriting", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    firstName: firstName.trim(),
                    lastName: lastName.trim(),
                    email: email.trim().toLowerCase(),
                    password,
                    inviteCode: inviteCode.trim(),
                }),
            });

            if (!res.ok) {
                const { message } = await res.json().catch(() => ({
                    message: "Server error"
                }));
                throw new Error(message || "Failed underwriting signup flow");
            }

            // Redirect to success page
            router.push("/auth/underwriting-signup-success");
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
                    <BrandIconTile size="lg" className="mb-6">
                        <Shield className="h-8 w-8" />
                    </BrandIconTile>
                    <Eyebrow className="mb-3">Secure internal portal registration</Eyebrow>
                    <h1 className="font-headline text-4xl font-extrabold leading-tight tracking-tight text-cb-ink">
                        Underwriting <span className="text-cb-mint">access</span>
                    </h1>
                </div>

                <div className="mt-10">
                    <form onSubmit={handleUnderwritingSignUp}>
                        <div className="flex flex-col gap-8">

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

                            <div className="grid gap-3">
                                <Label htmlFor="email" className={FIELD.label}>Team Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="name@creditbanc.com"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className={FIELD.input}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                                <div className="grid gap-3">
                                    <Label htmlFor="password" className={FIELD.label}>Access Password</Label>
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
                                    <Label htmlFor="repeat-password" className={FIELD.label}>Confirm Access</Label>
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

                            <button
                                type="submit"
                                className={`${CTA.primary} group w-full`}
                                disabled={isLoading}
                            >
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
                                        Initialize team access
                                        <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                                    </>
                                )}
                            </button>
                        </div>

                        <p className="mt-8 border-t border-black/5 pt-8 text-center font-label text-xs font-bold uppercase tracking-[0.2em] text-cb-gray">
                            Authorized personnel only
                        </p>
                    </form>
                </div>
            </BrandCard>
        </div>
    );
}
