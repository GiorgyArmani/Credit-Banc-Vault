"use client";

// Advisor funded-client book. Shared with the partner deal desk —
// see src/components/workspace/workspace-clients.tsx.

import { WorkspaceClients } from "@/components/workspace/workspace-clients";

export default function AdvisorFundedClientsPage() {
  return <WorkspaceClients basePath="/advisor/dashboard" />;
}
