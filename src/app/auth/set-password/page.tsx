// src/app/auth/set-password/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandAuthShell, BrandCard, Eyebrow, CTA } from "@/components/marketing/brand-chrome";

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
      <BrandAuthShell width="md">
        <div className="text-center">
          <div
            aria-hidden
            className="mx-auto mb-6 h-14 w-14 animate-spin rounded-full border-4 border-cb-mint/20 border-t-cb-mint"
          />
          <p className="font-label text-xs font-bold uppercase tracking-[0.3em] text-cb-gray">
            Verifying session
          </p>
        </div>
      </BrandAuthShell>
    );
  }

  return (
    <BrandAuthShell width="md">
      <BrandCard>
        <Eyebrow className="mb-3">Account security</Eyebrow>
        <h1 className="font-headline text-3xl font-extrabold tracking-tight text-cb-ink md:text-4xl">
          Set your <span className="text-cb-mint">password</span>
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-cb-ink/70">
          {email ? (
            <>
              Account for <b className="font-bold text-cb-ink">{email}</b>
            </>
          ) : (
            "You're authenticated via a secure link."
          )}
        </p>

        <div className="mt-8">
          {!mustSet ? (
            <p className="text-[15px] leading-relaxed text-cb-ink/70">
              Your password is already set. Continue to your{" "}
              <a className="font-bold text-cb-mint hover:underline" href="/dashboard">
                dashboard
              </a>
              .
            </p>
          ) : ok ? (
            <p className="flex items-center gap-3 text-[15px] font-semibold text-cb-ink/70">
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-cb-mint/20 border-t-cb-mint"
              />
              Password updated. Redirecting…
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="grid gap-2">
                <Label
                  htmlFor="pwd1"
                  className="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray"
                >
                  New password
                </Label>
                <Input
                  id="pwd1"
                  type="password"
                  autoComplete="new-password"
                  value={pwd1}
                  onChange={(e) => setPwd1(e.target.value)}
                  required
                  className="h-12 rounded-xl border-black/10 bg-white px-4 font-medium"
                />
              </div>
              <div className="grid gap-2">
                <Label
                  htmlFor="pwd2"
                  className="font-label text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray"
                >
                  Repeat password
                </Label>
                <Input
                  id="pwd2"
                  type="password"
                  autoComplete="new-password"
                  value={pwd2}
                  onChange={(e) => setPwd2(e.target.value)}
                  required
                  className="h-12 rounded-xl border-black/10 bg-white px-4 font-medium"
                />
              </div>
              {err && (
                <p className="rounded-xl border border-error-container bg-error-container/40 p-4 text-sm font-semibold text-on-error-container">
                  {err}
                </p>
              )}
              <button type="submit" className={`${CTA.primary} w-full`} disabled={submitting}>
                {submitting ? "Saving…" : "Save password"}
              </button>
              <p className="text-center text-xs leading-relaxed text-cb-ink/50">
                Minimum 8 characters. You&apos;ll be redirected to your dashboard.
              </p>
            </form>
          )}
        </div>
      </BrandCard>
    </BrandAuthShell>
  );
}
