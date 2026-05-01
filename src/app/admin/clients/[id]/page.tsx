// src/app/admin/clients/[id]/page.tsx
// Unified admin client detail view. Re-uses the ADVISOR client page as the
// base (admin works the file as an advisor) and adds UW-side overlays
// (lender matching results, bank analysis links) when rendered in admin
// context. The advisor page already detects /admin/* paths and adjusts
// nav + access checks accordingly.
export { default } from '@/app/advisor/dashboard/clients/[id]/page'
