"use client";

// Partner+ desk — the client file.
//
// The same component staff advisors use. RLS is what makes that safe: every
// advisor-scoped policy is `is_advisor_user() AND is_assigned_advisor_for(...)`,
// so a rep reaching for a vault they neither own nor follow gets nothing back
// from the database, not merely a hidden button.

import { WorkspaceClientFile } from "@/components/workspace/workspace-client-file";

export default function DeskClientFilePage() {
  return <WorkspaceClientFile basePath="/desk" />;
}
