// src/app/auth/underwriting-signup/page.tsx
//
// Invitation-only — see the note on advisor-signup. Without a live underwriting
// invitation in ?token= this renders a wall instead of the form.
import { UnderwritingSignUpForm } from "@/components/underwriting-sign-up-form";
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
  const gate = await gateSignupPage(token, "underwriting");

  if (!gate.ok) return <InviteRequiredCard title={gate.title} message={gate.message} />;

  return (
    <BrandAuthShell width="xl">
      <UnderwritingSignUpForm invite={gate.invite} />
    </BrandAuthShell>
  );
}
