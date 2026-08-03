// src/app/auth/setter-signup-success/page.tsx
import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";
import { BrandAuthShell, BrandNotice, CTA } from "@/components/marketing/brand-chrome";

export default function SetterSignUpSuccessPage() {
  return (
    <BrandAuthShell width="lg">
      <BrandNotice
        icon={<Zap className="h-8 w-8" />}
        eyebrow="Setter access"
        title={
          <>
            Your account is <span className="text-cb-mint">live</span>
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
          Log in to start creating clients on the fast-funding form.
        </p>
      </BrandNotice>
    </BrandAuthShell>
  );
}
