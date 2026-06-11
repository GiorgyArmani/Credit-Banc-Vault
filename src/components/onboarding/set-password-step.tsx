"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";

interface SetPasswordStepProps {
    /** Called once the password is saved (and the GHL setup signal fired). */
    onComplete: () => void;
}

/**
 * Onboarding Step 3 — the client replaces the temporary password the auth user
 * was created with (they entered via a passwordless magic link and never saw it)
 * with one of their own. This is a first-time setup, so we only fire the GHL
 * `password-updated` SMS signal — no "password changed" email (that wording
 * confuses a first-time setup) — then advance via onComplete().
 */
export function SetPasswordStep({ onComplete }: SetPasswordStepProps) {
    const supabase = createClient();
    const [pwd1, setPwd1] = useState("");
    const [pwd2, setPwd2] = useState("");
    const [err, setErr] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErr(null);

        if (pwd1.length < 8) return setErr("Password must be at least 8 characters.");
        if (pwd1 !== pwd2) return setErr("Passwords do not match.");

        setSubmitting(true);
        const { error } = await supabase.auth.updateUser({
            password: pwd1,
            data: { should_change_password: false },
        });

        if (error) {
            setSubmitting(false);
            return setErr(error.message);
        }

        // Fire the GHL setup signal (SMS). Non-blocking for the user — if it
        // fails we still let them into the vault (the password is already set).
        try {
            await fetch("/api/onboarding/notify-password-set", { method: "POST" });
        } catch (notifyErr) {
            console.error("Password-updated notification failed (non-fatal):", notifyErr);
        }

        onComplete();
    };

    return (
        <div className="w-full max-w-md mx-auto">
            <div className="text-center mb-8">
                <div className="mx-auto w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mb-4 border border-emerald-100">
                    <Lock className="w-7 h-7 text-emerald-500" />
                </div>
                <p className="text-emerald-900/50 font-bold">
                    Create a password to secure your account and finish setup.
                </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-6">
                <div className="grid gap-3">
                    <Label htmlFor="pwd1" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">New password</Label>
                    <Input
                        id="pwd1"
                        type="password"
                        autoComplete="new-password"
                        value={pwd1}
                        onChange={(e) => setPwd1(e.target.value)}
                        required
                        className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                    />
                </div>
                <div className="grid gap-3">
                    <Label htmlFor="pwd2" className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/40 ml-1">Repeat password</Label>
                    <Input
                        id="pwd2"
                        type="password"
                        autoComplete="new-password"
                        value={pwd2}
                        onChange={(e) => setPwd2(e.target.value)}
                        required
                        className="h-14 rounded-2xl border-emerald-100 bg-white/50 focus:bg-white transition-all font-bold px-6"
                    />
                </div>
                {err && <p className="text-sm font-bold text-red-600 bg-red-50 p-4 rounded-2xl border border-red-100">{err}</p>}
                <Button
                    type="submit"
                    className="h-14 w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
                    disabled={submitting}
                >
                    {submitting ? "Saving…" : "Save Password & Enter Vault"}
                </Button>
                <p className="text-[10px] font-bold text-emerald-900/30 text-center uppercase tracking-widest leading-relaxed">
                    Minimum 8 characters.
                </p>
            </form>
        </div>
    );
}
