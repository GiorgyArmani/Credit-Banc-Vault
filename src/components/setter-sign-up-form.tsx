"use client";

import { cn } from "@/lib/utils";
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
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Zap, ArrowRight, Lock } from "lucide-react";

export function SetterSignUpForm({
    className,
    ...props
}: React.ComponentPropsWithoutRef<"div">) {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [repeatPassword, setRepeatPassword] = useState("");
    const [inviteCode, setInviteCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

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
                    inviteCode: inviteCode.trim(),
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
            <Card className="shadow-2xl border-emerald-100 rounded-[3rem] overflow-hidden bg-white/90 backdrop-blur-xl">
                <CardHeader className="p-10 text-center bg-emerald-950 text-white">
                    <div className="mx-auto w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-sm border border-white/20">
                        <Zap className="h-8 w-8 text-emerald-400" />
                    </div>
                    <CardTitle className="text-4xl font-black uppercase tracking-tighter mb-2 leading-none">Setter Access</CardTitle>
                    <CardDescription className="text-sm font-bold text-emerald-300/60 uppercase tracking-widest mt-2">
                        Appointment setter registration
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-10">
                    <form onSubmit={handleSetterSignUp}>
                        <div className="flex flex-col gap-8">

                            <div className="grid gap-3">
                                <Label htmlFor="invite-code" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Invite Code</Label>
                                <Input
                                    id="invite-code"
                                    type="text"
                                    placeholder="Enter your invite code"
                                    required
                                    value={inviteCode}
                                    onChange={(e) => setInviteCode(e.target.value)}
                                    className="h-14 rounded-2xl border-emerald-100 bg-white focus:ring-emerald-500 transition-all font-bold px-6"
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
                                        className="h-14 rounded-2xl border-emerald-100 bg-white focus:ring-emerald-500 transition-all font-bold px-6"
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
                                        className="h-14 rounded-2xl border-emerald-100 bg-white focus:ring-emerald-500 transition-all font-bold px-6"
                                    />
                                </div>
                            </div>

                            <div className="grid gap-3">
                                <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Team Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="name@creditbanc.com"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="h-14 rounded-2xl border-emerald-100 bg-white focus:ring-emerald-500 transition-all font-bold px-6"
                                />
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
                                        className="h-14 rounded-2xl border-emerald-100 bg-white focus:ring-emerald-500 transition-all font-bold px-6"
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
                                        className="h-14 rounded-2xl border-emerald-100 bg-white focus:ring-emerald-500 transition-all font-bold px-6"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="rounded-2xl bg-red-50 p-4 border border-red-100 flex items-center gap-3">
                                    <Lock className="w-4 h-4 text-red-500" />
                                    <p className="text-sm font-bold text-red-500">{error}</p>
                                </div>
                            )}

                            <Button
                                type="submit"
                                className="h-16 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95 text-lg"
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <div className="flex items-center gap-3">
                                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                        <span>Creating Account...</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center gap-2">
                                        <span>Create Setter Account</span>
                                        <ArrowRight className="w-6 h-6" />
                                    </div>
                                )}
                            </Button>
                        </div>

                        <div className="mt-10 text-center border-t border-emerald-50 pt-8">
                            <span className="text-emerald-900/30 font-bold text-sm">Authorized Personnel Only</span>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
