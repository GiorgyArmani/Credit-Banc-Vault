// src/app/auth/check-email/page.tsx
import { Mail } from "lucide-react";
import Link from "next/link";
import { BrandAuthShell, BrandNotice } from "@/components/marketing/brand-chrome";

export default function CheckEmailPage() {
  return (
    <BrandAuthShell width="md">
      <BrandNotice
        icon={<Mail className="h-8 w-8" />}
        eyebrow="Almost there"
        title={
          <>
            Check your <span className="text-cb-mint">inbox</span>
          </>
        }
        actions={
          <Link
            href="/auth/login"
            className="text-xs font-bold uppercase tracking-[0.3em] text-cb-mint hover:underline"
          >
            Back to log in
          </Link>
        }
      >
        <p>
          We sent a confirmation link to your email. Click it to finish creating your account.
        </p>
        <p className="mt-6 rounded-2xl bg-cb-navy px-6 py-5 text-sm text-white/70">
          <strong className="font-bold text-white">Didn&apos;t get it?</strong> Check your spam
          folder, or give it a few minutes to land.
        </p>
      </BrandNotice>
    </BrandAuthShell>
  );
}
