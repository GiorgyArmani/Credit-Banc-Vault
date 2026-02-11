// src/app/auth/set-password/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, ArrowRight } from "lucide-react";

export default function SetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [mustSet, setMustSet] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      // 1) Intercambiar el code por sesión (cuando llega desde el email)
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            // si el code es inválido/expiró mandamos al login
            router.replace("/auth/login");
            return;
          }
          // limpiar la URL
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.toString());
        }
      } catch {
        // noop
      }

      // 2) Obtener usuario ya autenticado por el code
      const { data: { user } } = await supabase.auth.getUser();
      setLoading(false);
      if (!user) { router.replace("/auth/login"); return; }

      setEmail(user.email ?? null);
      setMustSet(Boolean(user.user_metadata?.must_set_password));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (pwd1.length < 8) return setErr("Password must be at least 8 characters.");
    if (pwd1 !== pwd2) return setErr("Passwords do not match.");

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({
      password: pwd1,
      data: { must_set_password: false },
    });
    setSubmitting(false);

    if (error) return setErr(error.message);

    setOk(true);
    setTimeout(() => router.replace("/dashboard"), 700);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0fdf7] relative overflow-hidden flex items-center justify-center">
        {/* aurora-glow effect for consistency */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
        <div className="text-center relative z-10">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-emerald-500 mx-auto mb-6"></div>
          <p className="text-emerald-950/40 text-lg font-black uppercase tracking-widest">Verifying session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fdf7] relative overflow-hidden flex items-center justify-center p-4">
      {/* aurora-glow effect for consistency */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-200/10 blur-[120px] rounded-full pointer-events-none animate-aurora" />
      <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-100/5 blur-[120px] rounded-full pointer-events-none animate-aurora" style={{ animationDelay: '-3s' }} />

      <Card className="w-full max-w-md shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden relative z-10 bg-white/80 backdrop-blur-xl">
        <CardHeader className="p-10">
          <CardTitle className="text-3xl font-black text-emerald-950 uppercase tracking-tighter">Set Password</CardTitle>
          <CardDescription className="text-sm font-bold text-emerald-900/40 mt-2">
            {email ? <>Account for <b className="text-emerald-950 font-black">{email}</b></> : "You're authenticated via a secure link."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-10 pt-0">
          {!mustSet ? (
            <div className="text-sm font-bold text-emerald-950/60 leading-relaxed text-center">
              Your password is already set. Continue to your{" "}
              <a className="text-emerald-600 underline font-black" href="/dashboard">dashboard</a>.
            </div>
          ) : ok ? (
            <div className="text-emerald-600 font-bold text-center flex items-center justify-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600"></div>
              Password updated. Redirecting…
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="grid gap-4">
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
              <div className="grid gap-4">
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
              <Button type="submit" className="h-14 w-full bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95" disabled={submitting}>
                {submitting ? "Saving…" : "Save password"}
              </Button>
              <p className="text-[10px] font-bold text-emerald-900/30 text-center uppercase tracking-widest leading-relaxed">
                Minimum 8 characters. You’ll be redirected to your dashboard.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
