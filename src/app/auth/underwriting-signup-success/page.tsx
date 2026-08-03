// src/app/auth/underwriting-signup-success/page.tsx
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { BrandAuthShell, BrandNotice, CTA } from "@/components/marketing/brand-chrome";

export default function UnderwritingSignUpSuccessPage() {
  return (
    <BrandAuthShell width="lg">
      <BrandNotice
        icon={<ShieldCheck className="h-8 w-8" />}
        eyebrow="Underwriting access"
        title={
          <>
            Credentials <span className="text-cb-mint">secured</span>
          </>
        }
        actions={
          <Link href="/auth/login" className={`${CTA.primary} group`}>
            Continue to log in
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        }
      >
        <p className="mx-auto max-w-md">
          Your underwriting team account is ready. Log in to reach the underwriting portal.
        </p>
      </BrandNotice>
    </BrandAuthShell>
  );
}
