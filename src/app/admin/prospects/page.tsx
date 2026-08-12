"use client";

// src/app/admin/prospects/page.tsx
// Flat admin route — the Prospects list inside the Admin layout.
//
// See the note in ../clients/page.tsx on why this is no longer a bare re-export
// of the advisor page.

import { WorkspaceProspects } from "@/components/workspace/workspace-prospects";

export default function AdminProspectsPage() {
  return <WorkspaceProspects basePath="/admin" />;
}
