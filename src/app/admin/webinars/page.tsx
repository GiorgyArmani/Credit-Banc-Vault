// src/app/admin/webinars/page.tsx
//
// Admin management of the partner webinar library: upload recordings, edit,
// hide, delete. Partners watch them at /partner/webinars.
// Spec: docs/superpowers/specs/2026-10-14-partner-webinars-design.md

import { redirect } from "next/navigation";
import { MonitorPlay } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listAllWebinars } from "@/lib/webinars";
import { WebinarUploadForm } from "./_components/webinar-upload-form";
import { WebinarAdminList } from "./_components/webinar-admin-list";

export const dynamic = "force-dynamic";

export default async function AdminWebinarsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") redirect("/dashboard");

  const { webinars, degraded } = await listAllWebinars();

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cb-navy text-cb-mint">
          <MonitorPlay className="h-5 w-5" />
        </span>
        <div>
          <h1 className="font-headline text-2xl font-extrabold tracking-tight">Webinars</h1>
          <p className="text-sm text-cb-gray">
            Recordings of live sessions. Every published video is visible to Tier 1 and Tier 2
            referral partners.
          </p>
        </div>
      </div>
      <WebinarUploadForm />
      {degraded && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Couldn&apos;t load the webinar library in full — refresh the page. Partners may see the same
          problem.
        </p>
      )}
      <WebinarAdminList webinars={webinars} />
    </div>
  );
}
