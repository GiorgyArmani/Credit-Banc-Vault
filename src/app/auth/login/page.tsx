// src/app/auth/login/page.tsx
import LoginForm from "@/components/login-form";
import { BrandAuthShell } from "@/components/marketing/brand-chrome";

export default function Page() {
  return (
    <BrandAuthShell width="sm">
      <LoginForm />
    </BrandAuthShell>
  );
}
