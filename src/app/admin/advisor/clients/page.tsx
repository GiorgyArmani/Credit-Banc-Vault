// src/app/admin/advisor/clients/page.tsx
// Deprecated nested route — redirects to the flat /admin/clients (funded-only book).
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/admin/clients');
}
