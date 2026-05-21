// src/app/admin/advisor/clients/[id]/page.tsx
// Deprecated route — kept as a redirect so any stale links/bookmarks land on
// the canonical admin client detail view at /admin/clients/[id].
import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/clients/${id}`);
}
