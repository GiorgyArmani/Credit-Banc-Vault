import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { BrandAuthShell } from "@/components/marketing/brand-chrome";

export default function Page() {
  return (
    <BrandAuthShell width="sm">
      <ForgotPasswordForm />
    </BrandAuthShell>
  );
}
