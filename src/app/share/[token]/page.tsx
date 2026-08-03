// src/app/share/[token]/page.tsx
//
// Public, unauthenticated lender-facing page. Validates the token server-side
// (not revoked, not expired) and lists the client's APPROVED documents for the
// shared business, each behind a short-lived signed URL. No login, no nav —
// this is meant to be handed to an external lender.

import { resolveShareLink } from "@/lib/share-links";
import { ShieldCheck, FileText, Lock } from "lucide-react";
import { BrandAuthShell, BrandNotice } from "@/components/marketing/brand-chrome";
import { SharedDocuments } from "./shared-documents";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Shared Documents — Credit Banc",
  robots: { index: false, follow: false },
};

function format_size(bytes: number | null): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function format_date(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function InvalidState() {
  return (
    <BrandAuthShell width="md" showFooter={false}>
      <BrandNotice icon={<Lock className="h-8 w-8" />} title="This link is no longer available">
        <p>
          The share link has expired or been revoked. Contact your Credit Banc representative for
          an updated one.
        </p>
      </BrandNotice>
    </BrandAuthShell>
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const share = await resolveShareLink(token);

  if (!share) return <InvalidState />;

  return (
    <div className="min-h-screen bg-cb-cream font-body text-cb-ink">
      {/* Navy brand band. No nav — this page is handed to an outside lender. */}
      <header className="relative overflow-hidden bg-cb-navy text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cb-mint/10 blur-3xl"
        />
        <div className="relative z-10 mx-auto flex max-w-3xl items-center gap-4 px-6 py-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
            <ShieldCheck className="h-5 w-5 text-cb-mint" />
          </span>
          <div>
            <p className="font-label text-[10px] font-bold uppercase tracking-[0.3em] text-cb-mint">
              Credit Banc
            </p>
            <p className="font-headline text-base font-extrabold tracking-tight">
              Secure Document Package
            </p>
          </div>
        </div>
        <div
          aria-hidden
          className="absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-cb-mint/30 to-transparent"
        />
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {/* Summary card */}
        <div className="mb-6 rounded-2xl border border-black/5 bg-white p-7 shadow-[0_1px_2px_rgba(0,3,33,0.04)]">
          <h1 className="font-headline text-2xl font-extrabold tracking-tight text-cb-ink">
            {share.company_name}
          </h1>
          {share.label && (
            <p className="mt-1 text-sm font-semibold text-cb-mint">{share.label}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-cb-gray">
            <span>
              {share.documents.length} document{share.documents.length === 1 ? "" : "s"}
            </span>
            <span aria-hidden className="opacity-40">
              •
            </span>
            <span>Available until {format_date(share.expires_at)}</span>
          </div>
        </div>

        {/* Documents */}
        {share.documents.length === 0 ? (
          <div className="rounded-2xl border border-black/5 bg-white p-10 text-center shadow-[0_1px_2px_rgba(0,3,33,0.04)]">
            <FileText className="mx-auto mb-3 h-10 w-10 text-cb-gray/40" />
            <p className="text-sm font-semibold text-cb-ink/50">
              No approved documents are available yet.
            </p>
          </div>
        ) : (
          <SharedDocuments documents={share.documents} />
        )}

        <p className="mt-10 text-center text-[11px] leading-relaxed text-cb-ink/40">
          Confidential. These documents are shared securely by Credit Banc for the purpose of
          financing review. Do not redistribute.
        </p>
      </main>
    </div>
  );
}
