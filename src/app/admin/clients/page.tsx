"use client";

// src/app/admin/clients/page.tsx
// Flat admin route — the funded-only Clients list inside the Admin layout.
//
// Was `export { default } from '@/app/advisor/dashboard/clients/page'`. That
// re-export only worked while the component derived its links from usePathname();
// now the portal is passed in explicitly, so admin states its own basePath and
// the /admin/* links resolve correctly.

import { WorkspaceClients } from "@/components/workspace/workspace-clients";

export default function AdminClientsPage() {
  return <WorkspaceClients basePath="/admin" />;
}
