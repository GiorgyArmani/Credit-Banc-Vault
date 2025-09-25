"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setLoading(false);
      if (!user) { router.replace("/auth/login"); return; }
      setEmail(user.email ?? null);
      setMustSet(Boolean(user.user_metadata?.must_set_password));
    })();
  }, [router, supabase]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pwd1.length < 8) return setErr("Password must be at least 8 characters.");
    if (pwd1 !== pwd2) return setErr("Passwords do not match.");

    const { error } = await supabase.auth.updateUser({ password: pwd1, data: { must_set_password: false } });
    if (error) return setErr(error.message);
    setOk(true);
    setTimeout(() => router.replace("/client-dashboard"), 700);
  };

  if (loading) return <div className="min-h-[50vh] flex items-center justify-center text-gray-600">Loading…</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set your password</CardTitle>
          <CardDescription>{email ? <>Account for <b>{email}</b></> : "You're authenticated via a magic link."}</CardDescription>
        </CardHeader>
        <CardContent>
          {!mustSet ? (
            <div className="text-sm text-gray-700">
              Your password is already set. Continue to your{" "}
              <a className="underline" href="/client-dashboard">dashboard</a>.
            </div>
          ) : ok ? (
            <div className="text-emerald-700">Password updated. Redirecting…</div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="pwd1">New password</Label>
                <Input id="pwd1" type="password" value={pwd1} onChange={(e) => setPwd1(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pwd2">Repeat password</Label>
                <Input id="pwd2" type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} required />
              </div>
              {err && <p className="text-sm text-red-600">{err}</p>}
              <Button type="submit" className="w-full">Save password</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
