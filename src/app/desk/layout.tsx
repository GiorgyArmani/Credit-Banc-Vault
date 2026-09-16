// src/app/desk/layout.tsx
//
// Server-side gate + chrome for the Partner+ desk — paying external advisors
// (docs/superpowers/specs/2026-09-08-partner-plus-design.md).
//
// Gate order:
//   1. authenticated?          → /auth/login
//   2. partner_plus or admin?  → /dashboard
//   3. subscription active?    → BILLING TAKEOVER
//   4. onboarding complete?    → ONBOARDING TAKEOVER
//                                (password, phone, photo, W-9, voided check)
//   5. render the desk
//
// Billing precedes onboarding: a lapsed account is not asked for paperwork.
//
// TAKEOVERS, not redirects. A layout cannot read the pathname, so
// redirect('/desk/billing') would fire on its own target and loop forever.
// Rendering the screen in place of `children` has no such edge, and there is no
// half-open desk to click into. Same pattern as /partner/layout.tsx.
//
// This is the defense-in-depth re-check: src/proxy.ts freezes a lapsed rep
// first, but a layout that trusted it would open the desk on one proxy
// regression.

import Image from "next/image";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/logout-button";
import { isValidUsPhone } from "@/lib/phone";
import { getExternalAdvisorState, syncExternalAdvisorW9 } from "@/lib/external-advisor-onboarding";
import { hasDeskAccess, isPastDue } from "@/lib/partner-plus-billing";
import { DeskShell } from "./_components/desk-shell";
import { DeskBillingPanel } from "./_components/desk-billing-panel";
import { DeskOnboardingWizard } from "./welcome/_components/desk-onboarding-wizard";

export const dynamic = "force-dynamic";

function PlainChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink">
      <header className="sticky top-0 z-40 border-b border-black/5 bg-cb-cream/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Image
            src="/powered-by-shield.png"
            alt="Credit Banc — Powered by Shield Advisory Group"
            width={266}
            height={45}
            priority
            className="h-9 w-auto"
          />
          <LogoutButton />
        </div>
      </header>
      <main>{children}</main>
      <Toaster position="top-right" richColors />
    </div>
  );
}

export default async function DeskLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: userRow } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  const role = userRow?.role;
  if (role !== "partner_plus" && role !== "admin") redirect("/dashboard");

  // Admins walk the desk to support a rep. They have no subscription and no
  // paperwork, so neither gate applies.
  if (role === "admin") return <DeskShell pastDue={false}>{children}</DeskShell>;

  const rep = await getExternalAdvisorState(user.id);
  if (!rep) {
    return (
      <PlainChrome>
        <div className="mx-auto max-w-xl px-4 py-20 text-center">
          <h1 className="font-manrope text-2xl font-extrabold text-cb-ink">We couldn&apos;t find your subscription</h1>
          <p className="mt-3 text-cb-ink/60">
            This login isn&apos;t linked to a Partner+ account yet. Email support@creditbanc.io and we&apos;ll sort it out.
          </p>
        </div>
      </PlainChrome>
    );
  }

  if (!hasDeskAccess(rep)) {
    return (
      <PlainChrome>
        <DeskBillingPanel
          firstName={rep.first_name}
          locked
          subscriptionStatus={rep.subscription_status}
          currentPeriodEnd={rep.current_period_end}
          cancelAtPeriodEnd={rep.cancel_at_period_end}
          billingExempt={rep.billing_exempt}
          active={rep.active}
          hasStripeCustomer={!!rep.stripe_customer_id}
        />
      </PlainChrome>
    );
  }

  if (rep.requires_onboarding) {
    // A page load is the backstop for a dropped SignWell webhook, and it also
    // fetches our PDF copy if the webhook ran while SignWell was still rendering.
    let w9Signed = !!rep.w9_signed_at;
    if (!w9Signed && rep.w9_document_id) {
      const { signed } = await syncExternalAdvisorW9(rep);
      w9Signed = signed;
    }

    // No card wrapper and no heading here: the wizard is one step per screen and
    // owns its own headline, so a second "Welcome" above it would compete with
    // the step's own question.
    return (
      <PlainChrome>
        <DeskOnboardingWizard
          email={user.email ?? rep.email}
          firstName={rep.first_name}
          fullName={rep.name}
          passwordSet={!!rep.password_set_at}
          phone={rep.phone}
          phoneSet={isValidUsPhone(rep.phone)}
          profilePicUrl={rep.profile_pic_url}
          w9Signed={w9Signed}
          voidedCheckFilename={rep.voided_check_filename}
        />
      </PlainChrome>
    );
  }

  return <DeskShell pastDue={isPastDue(rep)}>{children}</DeskShell>;
}
