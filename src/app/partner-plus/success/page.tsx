// src/app/partner-plus/success/page.tsx
//
// Where Stripe Checkout returns after payment. Deliberately does NOT provision
// anything: fulfillment belongs to the webhook, which can arrive before or after
// this page loads. This page only tells the rep where their way in is.

import { MailCheck } from "lucide-react";
import { BrandAuthShell, BrandNotice } from "@/components/marketing/brand-chrome";

export const metadata = { title: "Welcome to Partner+ | Credit Banc" };

export default function PartnerPlusSuccessPage() {
  return (
    <BrandAuthShell width="md">
      <BrandNotice icon={<MailCheck className="h-8 w-8" />} eyebrow="Partner+" title="You're in. Check your email.">
        <p>
          Your subscription is active. We&apos;re setting up your desk and will email you a sign-in link
          within a minute or two.
        </p>
        <p className="mt-3 text-sm text-cb-ink/50">
          Nothing after five minutes? Check your spam folder, or email support@creditbanc.io.
        </p>
      </BrandNotice>
    </BrandAuthShell>
  );
}
