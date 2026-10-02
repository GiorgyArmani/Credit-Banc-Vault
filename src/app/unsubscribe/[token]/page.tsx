// src/app/unsubscribe/[token]/page.tsx
//
// Public opt-out page for the post-funding client email sequence. Linked from
// every email's footer. No session — the signed token IS the authorization, and
// it can only opt out the client it was minted for (lib/post-funding/unsubscribe).
//
// GET never changes anything: mail security scanners pre-fetch links, so the
// opt-out happens on the button's POST. Mail clients that support one-click use
// /api/unsubscribe/[token] via the List-Unsubscribe header instead.

import { MailX, CheckCircle2, Lock } from "lucide-react";
import { BrandAuthShell, BrandNotice, CTA } from "@/components/marketing/brand-chrome";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribeClient, verifyUnsubscribeToken } from "@/lib/post-funding/unsubscribe";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Unsubscribe — Credit Banc",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; failed?: string }>;
}) {
  const { token } = await params;
  const { done, failed } = await searchParams;
  const clientVaultId = verifyUnsubscribeToken(token);

  if (!clientVaultId) {
    return (
      <BrandAuthShell width="md" showFooter={false}>
        <BrandNotice icon={<Lock className="h-8 w-8" />} title="This link isn't valid">
          <p>Contact your Credit Banc advisor and they&rsquo;ll take you off the list.</p>
        </BrandNotice>
      </BrandAuthShell>
    );
  }

  if (done) {
    return (
      <BrandAuthShell width="md" showFooter={false}>
        <BrandNotice icon={<CheckCircle2 className="h-8 w-8" />} title="You're unsubscribed">
          <p>
            You won&rsquo;t get any more check-in emails from us. If you ever need anything, your
            advisor is still just a call or email away.
          </p>
        </BrandNotice>
      </BrandAuthShell>
    );
  }

  async function confirm() {
    "use server";
    const { redirect } = await import("next/navigation");
    const ok = await unsubscribeClient(createAdminClient(), clientVaultId!);
    redirect(`/unsubscribe/${encodeURIComponent(token)}?${ok ? "done=1" : "failed=1"}`);
  }

  return (
    <BrandAuthShell width="md" showFooter={false}>
      <BrandNotice
        icon={<MailX className="h-8 w-8" />}
        title="Unsubscribe from check-ins?"
        actions={
          <form action={confirm}>
            <button type="submit" className={CTA.primary}>
              Unsubscribe
            </button>
          </form>
        }
      >
        <p>
          We&rsquo;ll stop sending the occasional post-funding check-in emails. Your advisor will
          still be there if you reach out.
        </p>
        {failed && (
          <p className="mt-3 font-semibold text-error">
            Something went wrong and you&rsquo;re still subscribed. Please try again.
          </p>
        )}
      </BrandNotice>
    </BrandAuthShell>
  );
}
