// src/app/auth/advisor-signup/page.tsx
import { AdvisorSignUpForm } from "@/components/advisor-sign-up-form";
import { BrandAuthShell } from "@/components/marketing/brand-chrome";

export default function Page() {
  return (
    <BrandAuthShell width="xl">
      <AdvisorSignUpForm />
    </BrandAuthShell>
  );
}
