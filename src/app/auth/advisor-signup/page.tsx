// src/app/auth/advisor-signup/page.tsx
//
// The invite link's landing page for internal advisors — the staff twin of
// /partner/welcome. One screen, one step rail: create the account, sign the
// W-9, upload a voided check, open the workspace. The account step signs the
// advisor in on the spot, so the paperwork follows without a login in between.
//
// Invitation-only. Without a live advisor invitation in ?token= this renders a
// wall instead of the form — the shared invite code it replaced let anyone who
// had ever seen the string mint themselves a staff account.
//
// Already signed in? Then the invitation has been redeemed and the token is
// spent, so the page reads the advisor's own onboarding state instead: someone
// who closed the tab after step 1 and reopened the email lands back on the step
// they were on. This is why the route is NOT in the proxy's bounce list of
// anonymous-only auth pages — the page decides for itself, like the partner
// welcome page does. An advisor who is already onboarded (or anyone who isn't
// an advisor) goes to their own dashboard.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdvisorOnboardingWizard } from "@/app/advisor/_components/advisor-onboarding-wizard";
import { BrandAuthShell, BrandCard, Eyebrow } from "@/components/marketing/brand-chrome";
import { InviteRequiredCard } from "@/components/auth/invite-required-card";
import { gateSignupPage } from "@/lib/auth/signup-invite-gate";
import { getAdvisorOnboardingState, syncAdvisorW9 } from "@/lib/advisor-onboarding";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: userRow } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    // /dashboard is re-routed by role in the proxy, so every non-advisor
    // (and a finished advisor) ends up on their own home without this page
    // needing its own copy of the role map.
    if (userRow?.role !== "advisor") redirect("/dashboard");

    const advisor = await getAdvisorOnboardingState(user.id);
    if (!advisor?.requires_onboarding) redirect("/advisor/dashboard");

    // Catch-up: the SignWell webhook usually recorded the signature already;
    // this also fetches our PDF copy if SignWell was still rendering it then.
    let w9Signed = !!advisor.w9_signed_at;
    if (advisor.w9_document_id && (!w9Signed || !advisor.w9_file_path)) {
      const { signed } = await syncAdvisorW9(advisor);
      w9Signed = signed;
    }

    return (
      <Shell firstName={advisor.name.trim().split(/\s+/)[0] || "there"} resumed>
        <AdvisorOnboardingWizard
          firstName={advisor.name.trim().split(/\s+/)[0] || "there"}
          w9Signed={w9Signed}
          voidedCheckFilename={advisor.voided_check_filename}
        />
      </Shell>
    );
  }

  const { token } = await searchParams;
  const gate = await gateSignupPage(token, "advisor");

  if (!gate.ok) return <InviteRequiredCard title={gate.title} message={gate.message} />;

  return (
    <Shell firstName={gate.invite.firstName}>
      <AdvisorOnboardingWizard
        firstName={gate.invite.firstName || "there"}
        invite={gate.invite}
        w9Signed={false}
        voidedCheckFilename={null}
      />
    </Shell>
  );
}

function Shell({
  children,
  firstName,
  resumed = false,
}: {
  children: React.ReactNode;
  firstName: string;
  resumed?: boolean;
}) {
  return (
    <BrandAuthShell width="xl">
      <BrandCard>
        <div className="text-center">
          <Eyebrow className="mb-3">Advisor onboarding</Eyebrow>
          <h1 className="font-headline text-4xl font-extrabold leading-tight tracking-tight text-cb-ink">
            {resumed ? (
              <>
                Welcome back{firstName ? `, ${firstName}` : ""}
                <span className="text-cb-mint">.</span>
              </>
            ) : (
              <>
                Create your <span className="text-cb-mint">account</span>
              </>
            )}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-cb-ink/70">
            {resumed
              ? "Pick up where you left off — your workspace opens as soon as the paperwork is in."
              : "Set up your login, sign your W-9 and tell us where to send your payouts. Your workspace opens at the end."}
          </p>
        </div>
        <div className="mt-10">{children}</div>
        <ul className="mt-9 space-y-2.5 border-t border-black/5 pt-7 text-sm text-cb-ink/55">
          <li className="flex gap-2.5">
            <span className="font-bold text-cb-mint">1.</span>
            Your W-9 and voided check go straight to a private vault — nobody outside finance sees them.
          </li>
          <li className="flex gap-2.5">
            <span className="font-bold text-cb-mint">2.</span>
            You can close this tab mid-way; sign in and you&apos;ll pick up where you left off.
          </li>
        </ul>
      </BrandCard>
    </BrandAuthShell>
  );
}
