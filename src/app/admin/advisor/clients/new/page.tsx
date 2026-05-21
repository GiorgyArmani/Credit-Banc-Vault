// src/app/admin/advisor/clients/new/page.tsx
// Deprecated nested route — redirects to /admin/clients/new.
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/admin/clients/new');
}
