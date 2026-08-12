"use client";

// Advisor client file. Shared with the admin and partner portals —
// see src/components/workspace/workspace-client-file.tsx.

import { WorkspaceClientFile } from "@/components/workspace/workspace-client-file";

export default function AdvisorClientDetailsPage() {
  return <WorkspaceClientFile basePath="/advisor/dashboard" />;
}
