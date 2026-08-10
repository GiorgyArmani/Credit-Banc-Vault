// src/app/auth/setter-signup/page.tsx
//
// Invitation-only — see the note on advisor-signup. Without a live setter
// invitation in ?token= this renders a wall instead of the form.
import { SetterSignUpForm } from "@/components/setter-sign-up-form";
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
  const gate = await gateSignupPage(token, "setter");

  if (!gate.ok) return <InviteRequiredCard title={gate.title} message={gate.message} />;

  return (
    <BrandAuthShell width="xl">
      <SetterSignUpForm invite={gate.invite} />
    </BrandAuthShell>
  );
}
