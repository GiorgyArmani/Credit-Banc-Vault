// src/app/partner/welcome/page.tsx
//
// Step 2 of referral-partner onboarding: magic link → CHOOSE A PASSWORD → portal.
//
// The partner already has a session by the time they get here (the invite link
// signed them in), so this page isn't an auth gate — it's the one-time step that
// turns a link-only account into one they can log into normally at /auth/login.
//
// Deliberately forwards straight to the dashboard if they've already done it, so
// the invite link keeps working as a plain sign-in link on every later click.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PartnerWelcomeForm } from "./_components/partner-welcome-form";

export const dynamic = "force-dynamic";

export default async function PartnerWelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const db = createAdminClient();
  const { data: partner } = await db
    .from("referral_partners")
    .select("id, name, password_set_at, portal_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  // Not a partner (an admin poking around, or a login that was never linked).
  // The dashboard renders its own explanation for that case.
  if (!partner) redirect("/partner/dashboard");
  if (partner.password_set_at) redirect("/partner/dashboard");

  const firstName = (partner.name || "").trim().split(/\s+/)[0] || "there";

  return (
    <div className="max-w-xl mx-auto px-4 py-14 md:py-20">
      <div className="rounded-3xl border border-black/5 bg-white p-8 md:p-10 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-cb-mint mb-3">
          Referral Partner Program
        </p>
        <h1 className="font-manrope text-3xl font-extrabold tracking-tight text-cb-ink">
          Welcome, {firstName}.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-cb-ink/60">
          One thing before you go in: choose a password. After this you can sign in
          any time at{" "}
          <span className="font-semibold text-cb-ink/80">vault.creditbanc.io</span>{" "}
          without waiting on an email link.
        </p>

        <div className="mt-8">
          <PartnerWelcomeForm email={user.email ?? ""} />
        </div>

        <ul className="mt-9 space-y-2.5 border-t border-black/5 pt-7 text-sm text-cb-ink/55">
          <li className="flex gap-2.5">
            <span className="text-cb-mint font-bold">1.</span>
            Share your personal referral link.
          </li>
          <li className="flex gap-2.5">
            <span className="text-cb-mint font-bold">2.</span>
            We take it from there — paperwork, lenders, follow-up.
          </li>
          <li className="flex gap-2.5">
            <span className="text-cb-mint font-bold">3.</span>
            Track every referral&apos;s progress from your dashboard.
          </li>
        </ul>
      </div>
    </div>
  );
}
