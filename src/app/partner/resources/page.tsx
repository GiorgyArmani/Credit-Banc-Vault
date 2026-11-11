// src/app/partner/resources/page.tsx
//
// Resource library for referral partners: documents admins upload at
// /admin/resources. Access is enforced by src/app/partner/layout.tsx
// (referral_partner / partner_advisor / admin, plus the Tier 2 onboarding
// takeover) — this page only renders after that passes. Files open through
// ./[id]/route.ts, which re-checks the viewer on every click.

import { Download, ExternalLink, FileText, FolderOpen, RefreshCw } from "lucide-react";
import { listPublishedResources } from "@/lib/partner-resources";
import { formatFileSize, resourceTypeLabel } from "@/lib/partner-resources-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resources — Credit Banc" };

function formatAdded(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

export default async function PartnerResourcesPage() {
  const { resources, degraded } = await listPublishedResources();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-headline text-2xl font-extrabold tracking-tight text-cb-ink">Resource Library</h1>
      <p className="mt-1 text-sm text-cb-gray">Guides, forms and materials for referral partners.</p>

      <div className="mt-6">
        {degraded ? (
          <div className="rounded-2xl border border-black/5 bg-white p-10 text-center shadow-sm">
            <p className="text-sm font-semibold text-cb-ink/60">Couldn&apos;t load the resources right now.</p>
            {/* A plain link, not next/link: a full reload re-runs the read. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/partner/resources"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cb-mint px-4 py-2 text-sm font-bold text-cb-navy"
            >
              <RefreshCw className="h-4 w-4" /> Try again
            </a>
          </div>
        ) : resources.length === 0 ? (
          <div className="rounded-2xl border border-black/5 bg-white p-10 text-center shadow-sm">
            <FolderOpen className="mx-auto mb-3 h-10 w-10 text-cb-gray/40" />
            <p className="text-sm font-semibold text-cb-ink/60">
              No resources yet — documents we share with partners will appear here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {resources.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cb-navy text-cb-mint">
                    <FileText className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-cb-ink">{r.title}</p>
                    <p className="text-xs text-cb-gray">
                      {resourceTypeLabel(r.file_name)} · {formatFileSize(r.size_bytes)} · Added {formatAdded(r.created_at)}
                    </p>
                    {r.description && (
                      <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{r.description}</p>
                    )}
                  </div>
                </div>
                {/* Plain <a>, not next/link: these hit a route handler and must never be prefetched. */}
                <div className="flex shrink-0 gap-2">
                  <a
                    href={`/partner/resources/${r.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-black/10 px-4 py-2 text-sm font-bold text-cb-ink hover:bg-black/5"
                  >
                    <ExternalLink className="h-4 w-4" /> Open
                  </a>
                  <a
                    href={`/partner/resources/${r.id}?download=1`}
                    className="inline-flex items-center gap-2 rounded-xl bg-cb-mint px-4 py-2 text-sm font-bold text-cb-navy"
                  >
                    <Download className="h-4 w-4" /> Download
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
