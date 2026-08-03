import { UpdatePasswordForm } from "@/components/update-password-form";
import { BrandAuthShell } from "@/components/marketing/brand-chrome";

export default function Page() {
  return (
    <BrandAuthShell width="sm">
      <UpdatePasswordForm />
    </BrandAuthShell>
  );
}
