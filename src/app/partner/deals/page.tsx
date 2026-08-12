"use client";

// Deal desk overview — the landing page for a partner who works their own deals.
// Same component the advisor and admin dashboards render; only basePath differs.

import { WorkspaceDashboard } from "@/components/workspace/workspace-dashboard";

export default function PartnerDealsPage() {
  // "Referral Partner", never "Partner Advisor" — partner_advisor is the
  // internal role name and is never shown to the partner.
  return <WorkspaceDashboard basePath="/partner" roleLabel="Referral Partner" />;
}
