"use client";

// Partner+ desk overview — the landing page for a paying external advisor.
// Same component the advisor and partner dashboards render; only basePath differs.

import { WorkspaceDashboard } from "@/components/workspace/workspace-dashboard";

export default function DeskDealsPage() {
  return <WorkspaceDashboard basePath="/desk" roleLabel="Partner+" />;
}
