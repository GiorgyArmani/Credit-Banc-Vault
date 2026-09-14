// src/app/partner-plus/page.tsx
//
// PUBLIC Partner+ signup. Pay first: the form hands off to Stripe Checkout, and
// the webhook creates the account once the card clears. Public via the exact
// entry in src/proxy.ts.

import { Check } from "lucide-react";
import { BrandAuthShell, BrandCard, BrandNotice, Eyebrow } from "@/components/marketing/brand-chrome";
import { PartnerPlusSignupForm } from "./_components/partner-plus-signup-form";

export const metadata = {
  title: "Partner+ | Credit Banc",
  description: "Submit your deals to Credit Banc underwriting for $100/month.",
};

const BENEFITS = [
  "Your own deal desk in the Credit Banc vault",
  "Credit Banc underwriting works, approves and closes your files",
  "Your borrowers upload documents through their own secure portal",
  "Access to our lender network for deals outside your options",
];

export default async function PartnerPlusPage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}) {
  const { canceled } = await searchParams;

  return (
    <BrandAuthShell width="xl">
      <div className="grid gap-8 md:grid-cols-2 md:items-start">
        <div className="space-y-6 md:pt-6">
          <Eyebrow>Partner+</Eyebrow>
          <h1 className="font-headline text-4xl font-extrabold leading-tight tracking-tight text-cb-ink md:text-5xl">
            Bring us the deals that don&apos;t fit.
          </h1>
          <p className="text-[15px] leading-relaxed text-cb-ink/70">
            Submit your own files into the Credit Banc vault. Our underwriting team and lender network
            work the back end with you.
          </p>
          <ul className="space-y-3">
            {BENEFITS.map((b) => (
              <li key={b} className="flex gap-3 text-[15px] text-cb-ink/80">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-cb-mint" />
                {b}
              </li>
            ))}
          </ul>
          <p className="font-headline text-2xl font-extrabold text-cb-ink">
            $100<span className="text-base font-bold text-cb-ink/50">/month per login</span>
          </p>
        </div>

        <div className="space-y-4">
          {canceled && (
            <BrandNotice title="Checkout canceled">
              No charge was made. You can start again below whenever you&apos;re ready.
            </BrandNotice>
          )}
          <BrandCard>
            <PartnerPlusSignupForm />
          </BrandCard>
        </div>
      </div>
    </BrandAuthShell>
  );
}
