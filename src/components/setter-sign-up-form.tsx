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
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Zap, ArrowRight, Lock } from "lucide-react";
import type { InviteContext } from "@/components/advisor-sign-up-form";

export function SetterSignUpForm({
    invite,
    className,
    ...props
}: React.ComponentPropsWithoutRef<"div"> & { invite: InviteContext }) {
    const [firstName, setFirstName] = useState(invite.firstName);
    const [lastName, setLastName] = useState(invite.lastName);
    const [password, setPassword] = useState("");
    const [repeatPassword, setRepeatPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Fixed by the invitation. The signup route re-checks it, so an editable
    // box here could only ever produce a confusing rejection.
    const email = invite.email;

    const router = useRouter();

    const handleSetterSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

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

        try {
            const res = await fetch("/api/post-signup-setter", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    firstName: firstName.trim(),
                    lastName: lastName.trim(),
                    email: email.trim().toLowerCase(),
                    password,
                    inviteToken: invite.token,
                }),
            });

            if (!res.ok) {
                const { message } = await res.json().catch(() => ({
                    message: "Server error"
                }));
                throw new Error(message || "Failed setter signup flow");
            }

            router.push("/auth/setter-signup-success");
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
                        <Zap className="h-8 w-8" />
                    </BrandIconTile>
                    <Eyebrow className="mb-3">Appointment setter registration</Eyebrow>
                    <h1 className="font-headline text-4xl font-extrabold leading-tight tracking-tight text-cb-ink">
                        Setter <span className="text-cb-mint">access</span>
                    </h1>
                </div>

                <div className="mt-10">
                    <form onSubmit={handleSetterSignUp}>
                        <div className="flex flex-col gap-8">

                            <div className="grid gap-3">
                                <Label htmlFor="email" className={FIELD.label}>Team Email</Label>
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
                                        Create setter account
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
