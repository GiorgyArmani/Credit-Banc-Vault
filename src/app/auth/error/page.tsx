// src/app/auth/error/page.tsx
import { AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { BrandAuthShell, BrandNotice, CTA } from "@/components/marketing/brand-chrome";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <BrandAuthShell width="md">
      <BrandNotice
        tone="error"
        icon={<AlertCircle className="h-8 w-8" />}
        eyebrow="Authentication error"
        title="That didn't work"
        actions={
          <Link href="/auth/login" className={CTA.primary}>
            <ArrowLeft className="h-4 w-4" />
            Return to log in
          </Link>
        }
      >
        <p className="rounded-2xl border border-error-container bg-error-container/40 px-6 py-5 text-sm font-semibold text-on-error-container">
          {params?.error ? (
            <>
              Error code: <span className="font-extrabold">{params.error}</span>
            </>
          ) : (
            "An unspecified authentication error occurred. Try again, or contact support."
          )}
        </p>
        <p className="mt-6 text-sm text-cb-ink/50">
          Need a hand?{" "}
          <Link href="/support" className="font-bold text-cb-mint hover:underline">
            Contact support
          </Link>
        </p>
      </BrandNotice>
    </BrandAuthShell>
  );
}
