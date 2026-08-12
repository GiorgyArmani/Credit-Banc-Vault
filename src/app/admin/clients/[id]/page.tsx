"use client";

// src/app/admin/clients/[id]/page.tsx
// The canonical admin client detail view. Renders the shared client file with
// admin overlays (reassign advisor, lender-match review) switched on by the
// /admin basePath. See [[canonical_admin_client_detail]] — never fork a new
// admin detail route; extend this one.
//
// Was a bare re-export of the advisor page, which worked only while the
// component sniffed usePathname() for /admin/*. The portal is now passed in
// explicitly.

import { WorkspaceClientFile } from "@/components/workspace/workspace-client-file";

export default function AdminClientDetailsPage() {
  return <WorkspaceClientFile basePath="/admin" />;
}
