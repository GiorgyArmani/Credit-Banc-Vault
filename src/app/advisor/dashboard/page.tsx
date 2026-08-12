"use client";

// Advisor landing dashboard. Shared with the partner deal desk —
// see src/components/workspace/workspace-dashboard.tsx.

import { WorkspaceDashboard } from "@/components/workspace/workspace-dashboard";

export default function AdvisorDashboardPage() {
  return <WorkspaceDashboard basePath="/advisor/dashboard" />;
}
