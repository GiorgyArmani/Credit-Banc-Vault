// src/app/admin/advisor/dashboard/page.tsx
// Removed from the admin panel — admins use /admin/dashboard. Old links redirect there.
import { redirect } from 'next/navigation'

export default function LegacyAdminAdvisorDashboardPage() {
  redirect('/admin/dashboard')
}
