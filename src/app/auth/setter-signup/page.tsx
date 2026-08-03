// src/app/auth/setter-signup/page.tsx
import { SetterSignUpForm } from "@/components/setter-sign-up-form";
import { BrandAuthShell } from "@/components/marketing/brand-chrome";

export default function Page() {
  return (
    <BrandAuthShell width="xl">
      <SetterSignUpForm />
    </BrandAuthShell>
  );
}
