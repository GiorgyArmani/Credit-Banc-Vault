"use client";

import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { BrandAuthShell, BrandNotice, CTA } from "@/components/marketing/brand-chrome";

const NEXT_STEPS = [
  "Check your email inbox for a verification link",
  "Click the link to activate your account",
  "Log in to reach your advisor dashboard",
];

/**
 * Advisor Signup Success Page
 * Confirms the account was created and points at email verification.
 */
export default function AdvisorSignUpSuccess() {
  return (
    <BrandAuthShell width="md">
      <BrandNotice
        icon={<CheckCircle2 className="h-8 w-8" />}
        eyebrow="Advisor registration"
        title={
          <>
            Account <span className="text-cb-mint">created</span>
          </>
        }
        actions={
          <Link href="/auth/login" className={`${CTA.primary} group`}>
            Continue to log in
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        }
      >
        <ol className="mt-2 space-y-4 text-left">
          {NEXT_STEPS.map((step, i) => (
            <li key={i} className="flex items-start gap-4">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cb-mint/10 font-headline text-sm font-extrabold text-cb-mint">
                {i + 1}
              </span>
              <span className="text-[15px] leading-relaxed text-cb-ink/70">{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-6 rounded-2xl bg-cb-navy px-6 py-5 text-sm text-white/70">
          <strong className="font-bold text-white">Note:</strong> verification is required before
          you can log in. Check your spam folder if nothing arrives within 5 minutes.
        </p>

        <p className="mt-6 text-sm text-cb-ink/50">
          Need help?{" "}
          <Link href="/support" className="font-bold text-cb-mint hover:underline">
            Contact support
          </Link>
        </p>
      </BrandNotice>
    </BrandAuthShell>
  );
}
