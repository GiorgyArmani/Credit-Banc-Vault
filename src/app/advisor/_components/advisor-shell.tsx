// src/app/advisor/_components/advisor-shell.tsx
//
// Advisor portal chrome. The shell itself is shared with the partner deal desk —
// see src/components/workspace/workspace-shell.tsx. Auth/role gating happens in
// the parent server layout.tsx, so this only renders for confirmed advisors
// (or admins).

'use client'

import React from 'react'
import { WorkspaceShell } from '@/components/workspace/workspace-shell'

export function AdvisorShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceShell basePath="/advisor/dashboard" roleLabel="Advisor">
      {children}
    </WorkspaceShell>
  )
}
