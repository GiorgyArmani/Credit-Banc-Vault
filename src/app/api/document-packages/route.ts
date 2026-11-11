// src/app/api/document-packages/route.ts
//
// The loan-type document lists in force — which also carries the loan types
// staff added, as extra keys — for every surface that picks a loan type
// (useDocumentPackages). Staff only: all of those are staff surfaces.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isStaffRole } from "@/lib/auth/roles";
import { loadDocumentPackages } from "@/lib/document-packages";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: me } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!isStaffRole(me?.role)) {
    return NextResponse.json({ error: "Staff only" }, { status: 403 });
  }

  const { packages } = await loadDocumentPackages();
  return NextResponse.json({ packages });
}
