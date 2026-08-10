// The screen someone sees when they reach a staff signup page without a usable
// invitation — no token at all, or one that's been used, cancelled or expired.
//
// Deliberately vague about WHICH: "expired" and "already used" are safe to say
// because the holder already had the link, but a bare visitor probing
// /auth/advisor-signup gets the same generic wall either way, and no hint that
// guessing a token is a thing worth doing.

import Link from "next/link";
import { BrandAuthShell, BrandCard, BrandIconTile, Eyebrow } from "@/components/marketing/brand-chrome";
import { ShieldAlert } from "lucide-react";

export function InviteRequiredCard({
  title = "Invitation required",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <BrandAuthShell width="sm">
      <BrandCard>
        <div className="text-center">
          <BrandIconTile size="lg" className="mb-6">
            <ShieldAlert className="h-8 w-8" />
          </BrandIconTile>
          <Eyebrow className="mb-3">Team access</Eyebrow>
          <h1 className="font-headline text-3xl font-extrabold leading-tight tracking-tight text-cb-ink">
            {title}
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-cb-ink/70">{message}</p>

          <p className="mt-8 border-t border-black/5 pt-8 text-sm text-cb-ink/50">
            Already have an account?{" "}
            <Link href="/auth/login" className="font-bold text-cb-mint hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </BrandCard>
    </BrandAuthShell>
  );
}
