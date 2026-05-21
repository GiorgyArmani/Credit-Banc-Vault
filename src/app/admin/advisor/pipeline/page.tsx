// src/app/admin/advisor/pipeline/page.tsx
// Legacy route — admin pipeline now lives at /admin/pipeline.
import { redirect } from 'next/navigation'

export default function LegacyAdminAdvisorPipelinePage() {
  redirect('/admin/pipeline')
}
