// src/app/admin/resources/page.tsx
//
// Admin management of the referral partner resource library: upload documents,
// edit, hide, delete. Partners open them at /partner/resources.

import { redirect } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listAllResources } from "@/lib/partner-resources";
import { ResourceUploadForm } from "./_components/resource-upload-form";
import { ResourceAdminList } from "./_components/resource-admin-list";

export const dynamic = "force-dynamic";

export default async function AdminResourcesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") redirect("/dashboard");

  const { resources, degraded } = await listAllResources();

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cb-navy text-cb-mint">
          <FolderOpen className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-headline text-2xl font-extrabold tracking-tight">Resource Library</h1>
          <p className="text-sm text-cb-gray">
            Documents for referral partners. Every published file is visible to Tier 1 and Tier 2
            referral partners.
          </p>
        </div>
      </div>
      <ResourceUploadForm />
      {degraded ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Couldn&apos;t load the resource library — refresh the page. Partners may see the same
          problem.
        </p>
      ) : (
        <ResourceAdminList resources={resources} />
      )}
    </div>
  );
}
