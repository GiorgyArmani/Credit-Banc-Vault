// src/app/auth/advisor-signup/page.tsx
//
// Invitation-only. Without a live advisor invitation in ?token= this renders a
// wall instead of the form — the shared invite code it replaced let anyone who
// had ever seen the string mint themselves a staff account.
import { AdvisorSignUpForm } from "@/components/advisor-sign-up-form";
import { BrandAuthShell } from "@/components/marketing/brand-chrome";
import { InviteRequiredCard } from "@/components/auth/invite-required-card";
import { gateSignupPage } from "@/lib/auth/signup-invite-gate";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const gate = await gateSignupPage(token, "advisor");

  if (!gate.ok) return <InviteRequiredCard title={gate.title} message={gate.message} />;

  return (
    <BrandAuthShell width="xl">
      <AdvisorSignUpForm invite={gate.invite} />
    </BrandAuthShell>
  );
}
