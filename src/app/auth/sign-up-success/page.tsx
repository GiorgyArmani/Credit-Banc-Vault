// src/app/auth/sign-up-success/page.tsx
"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle2, Mail, Lock, ArrowRight } from "lucide-react";
import {
  BrandAuthShell,
  BrandCard,
  BrandIconTile,
  Eyebrow,
  CTA,
} from "@/components/marketing/brand-chrome";

const NEXT_STEPS = [
  "Open the welcome email we just sent you",
  "Log in with the temporary password from that email",
  "Complete your business profile and upload documents",
  "Update your password for extra security",
];

const SECURITY_NOTES = [
  <>
    Your <strong className="font-bold text-white">temporary password</strong> was emailed to you for
    first access.
  </>,
  <>We strongly recommend changing it once you are in.</>,
  <>You can update your password anytime from settings.</>,
];

function SuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get("email");

  return (
    <BrandAuthShell width="lg">
      <BrandCard padded={false}>
        {/* header */}
        <div className="border-b border-black/5 px-8 py-12 text-center md:px-14">
          <BrandIconTile size="lg" className="mb-7">
            <CheckCircle2 className="h-8 w-8" />
          </BrandIconTile>
          <Eyebrow className="mb-3">Welcome to Credit Banc Vault</Eyebrow>
          <h1 className="font-headline text-4xl font-extrabold leading-tight tracking-tight text-cb-ink md:text-5xl">
            Account <span className="text-cb-mint">created</span>
          </h1>
        </div>

        <div className="space-y-8 p-8 md:p-12">
          {/* credentials */}
          <div className="rounded-2xl border border-black/5 bg-cb-cream/60 p-7">
            <p className="mb-6 flex items-center gap-2 font-label text-xs font-bold uppercase tracking-[0.2em] text-cb-gray">
              <Mail className="h-4 w-4" />
              Check your email
            </p>

            <div className="space-y-4">
              <div className="rounded-xl border border-black/5 bg-white p-5">
                <p className="mb-1 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray">
                  Email address
                </p>
                <p className="font-headline text-lg font-extrabold tracking-tight text-cb-ink break-all">
                  {email}
                </p>
              </div>

              <div className="rounded-xl border border-black/5 bg-white p-5">
                <p className="mb-1 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-cb-gray">
                  Temporary password
                </p>
                <p className="text-[15px] leading-relaxed text-cb-ink/70">
                  We emailed you a one-time password. Check your inbox (and your spam folder) for a
                  message from Credit Banc, then use it to log in the first time.
                </p>
              </div>
            </div>
          </div>

          {/* security notice — navy band */}
          <div className="relative overflow-hidden rounded-2xl bg-cb-navy p-7 text-white">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full bg-cb-mint/10 blur-3xl"
            />
            <h2 className="relative z-10 mb-4 flex items-center gap-2 font-headline text-lg font-extrabold tracking-tight">
              <Lock className="h-5 w-5 text-cb-mint" />
              Security notice
            </h2>
            <ul className="relative z-10 space-y-3 text-[15px] leading-relaxed text-white/70">
              {SECURITY_NOTES.map((note, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cb-mint"
                  />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* next steps */}
          <div className="rounded-2xl border border-black/5 bg-cb-cream/60 p-7">
            <p className="mb-6 font-label text-xs font-bold uppercase tracking-[0.2em] text-cb-gray">
              Next steps
            </p>
            <ol className="space-y-4">
              {NEXT_STEPS.map((step, i) => (
                <li key={i} className="flex items-start gap-4">
                  <BrandIconTile size="sm" className="mt-0.5 font-headline text-sm font-extrabold">
                    {i + 1}
                  </BrandIconTile>
                  <span className="text-[15px] leading-relaxed text-cb-ink/70">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <button
            type="button"
            onClick={() => router.push("/auth/login")}
            className={`${CTA.primary} group w-full`}
          >
            Continue to log in
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </button>

          <p className="text-center text-sm text-cb-ink/50">
            Need help? Contact support at{" "}
            <a href="mailto:support@creditbanc.io" className="font-bold text-cb-mint hover:underline">
              support@creditbanc.io
            </a>
          </p>
        </div>
      </BrandCard>
    </BrandAuthShell>
  );
}

export default function SignUpSuccessPage() {
  return (
    <Suspense
      fallback={
        <BrandAuthShell width="lg">
          <div className="text-center">
            <div
              aria-hidden
              className="mx-auto mb-6 h-14 w-14 animate-spin rounded-full border-4 border-cb-mint/20 border-t-cb-mint"
            />
            <p className="font-label text-xs font-bold uppercase tracking-[0.3em] text-cb-gray">
              Loading
            </p>
          </div>
        </BrandAuthShell>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
