"use client";

// Advisor pipeline. The board itself is shared with the partner deal desk —
// see src/components/workspace/workspace-pipeline.tsx.

import { WorkspacePipeline } from "@/components/workspace/workspace-pipeline";

export default function AdvisorPipelinePage() {
  return <WorkspacePipeline basePath="/advisor/dashboard" />;
}
