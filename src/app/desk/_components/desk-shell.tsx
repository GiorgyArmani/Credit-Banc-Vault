"use client";

// Chrome for a Partner+ rep's desk.
//
// The SAME shell the advisor and partner portals use — sidebar, global search,
// notifications, profile photo — pointed at /desk. Reusing it rather than
// rebuilding is deliberate: a rep working a deal is doing the advisor job, and a
// hand-maintained third shell would drift the moment either portal gained a
// feature.
//
// A past-due rep keeps working (Stripe is still retrying the card) behind a
// persistent banner that links to billing.

import React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export function DeskShell({ children, pastDue }: { children: React.ReactNode; pastDue: boolean }) {
  return (
    <WorkspaceShell
      basePath="/desk"
      dashboardHref="/desk/deals"
      roleLabel="Partner+"
      extraNavItems={[{ label: "Billing", href: "/desk/billing", icon: "credit_card" }]}
    >
      {pastDue && (
        <div
          role="alert"
          className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Your last Partner+ payment failed.</strong> Your desk stays open while we retry — update
              your card to avoid a pause.
            </span>
          </p>
          <Link
            href="/desk/billing"
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-900 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-50 hover:bg-amber-800"
          >
            Update payment
          </Link>
        </div>
      )}
      {children}
    </WorkspaceShell>
  );
}
