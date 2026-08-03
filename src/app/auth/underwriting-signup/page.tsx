// src/app/auth/underwriting-signup/page.tsx
import { UnderwritingSignUpForm } from "@/components/underwriting-sign-up-form";
import { BrandAuthShell } from "@/components/marketing/brand-chrome";

export default function Page() {
  return (
    <BrandAuthShell width="xl">
      <UnderwritingSignUpForm />
    </BrandAuthShell>
  );
}
