"use client";

// Chrome for a referral partner who works their own deals.
//
// This is the SAME shell the advisor portal uses — sidebar, global search,
// notifications, profile photo — pointed at /partner instead of
// /advisor/dashboard. Reusing it rather than rebuilding is deliberate: a partner
// working a deal is doing the advisor job, and two hand-maintained shells would
// drift the moment either portal gained a feature.
//
// Wording note: the role is `partner_advisor` internally, but the UI never says
// that. To the partner — and on every screen they can see — they are a
// "Referral Partner". See [[role_model]].

import React from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export function PartnerDealDeskShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceShell
      basePath="/partner"
      // /partner is only a route prefix — there is no page there. The deal desk
      // lands on /partner/deals, because /partner/dashboard is already taken by
      // the referral book.
      dashboardHref="/partner/deals"
      roleLabel="Referral Partner"
      // Their referral book — the read-only view of deals their link sent in
      // that staff are working. No advisor-portal equivalent, so it comes in
      // as an extra item rather than being part of the standard set.
      extraNavItems={[
        { label: "My Referrals", href: "/partner/dashboard", icon: "handshake" },
      ]}
    >
      {children}
    </WorkspaceShell>
  );
}
