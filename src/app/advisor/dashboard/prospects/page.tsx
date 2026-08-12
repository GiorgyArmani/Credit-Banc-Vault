"use client";

// Advisor prospects (every non-funded file). Shared with the partner deal desk —
// see src/components/workspace/workspace-prospects.tsx.

import { WorkspaceProspects } from "@/components/workspace/workspace-prospects";

export default function AdvisorProspectsPage() {
  return <WorkspaceProspects basePath="/advisor/dashboard" />;
}
