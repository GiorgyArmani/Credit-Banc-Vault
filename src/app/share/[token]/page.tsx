// src/app/share/[token]/page.tsx
//
// Public, unauthenticated lender-facing page. Validates the token server-side
// (not revoked, not expired) and lists the client's APPROVED documents for the
// shared business, each behind a short-lived signed URL. No login, no nav —
// this is meant to be handed to an external lender.

import { resolveShareLink } from "@/lib/share-links";
import { ShieldCheck, FileText, Lock } from "lucide-react";
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-10 text-center">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-5">
          <Lock className="h-6 w-6 text-slate-400" />
        </div>
        <h1 className="text-xl font-black text-slate-900 tracking-tight mb-2">
          This link is no longer available
        </h1>
        <p className="text-sm text-slate-500 leading-relaxed">
          The share link has expired or been revoked. Please contact your Credit Banc
          representative for an updated link.
        </p>
      </div>
    </div>
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
    <div className="min-h-screen bg-slate-50">
      {/* Brand header */}
      <header className="bg-emerald-900 text-white">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
          <div className="bg-emerald-700/60 p-2 rounded-xl">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-300">
              Credit Banc
            </p>
            <p className="text-sm font-bold">Secure Document Package</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Summary card */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-7 mb-6">
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            {share.company_name}
          </h1>
          {share.label && (
            <p className="text-sm font-semibold text-emerald-700 mt-1">{share.label}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs font-medium text-slate-500">
            <span>{share.documents.length} document{share.documents.length === 1 ? "" : "s"}</span>
            <span className="opacity-40">•</span>
            <span>Available until {format_date(share.expires_at)}</span>
          </div>
        </div>

        {/* Documents */}
        {share.documents.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-10 text-center">
            <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-500">
              No approved documents are available yet.
            </p>
          </div>
        ) : (
          <SharedDocuments documents={share.documents} />
        )}

        <p className="text-[11px] text-slate-400 text-center mt-8 leading-relaxed">
          Confidential. These documents are shared securely by Credit Banc for the purpose of
          financing review. Do not redistribute.
        </p>
      </main>
    </div>
  );
}
