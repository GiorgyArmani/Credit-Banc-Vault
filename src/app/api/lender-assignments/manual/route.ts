// src/app/api/lender-assignments/manual/route.ts
//
// POST — UW (or admin) manually attaches a lender to a client deal, picking from
// lender_guidelines. Mirrors the admin manual-add (/api/admin/lender-reviews
// POST) but is open to underwriting and lands the row already cleared for
// submission, so UW gets the flexibility to add a lender and push it out without
// waiting on a separate admin review.
//
// The lender's terms (specialty / payment_type / min/max funding) are snapshotted
// at insert time so later guideline edits don't rewrite history.
//
// AuthZ: admin OR underwriting (see require-staff).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireStaff } from "@/lib/auth/require-staff";

const supabase_admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(request: Request) {
  try {
    const gate = await requireStaff();
    if (!gate.ok) return gate.response;

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      /* handled below */
    }

    const client_id: string | undefined = body?.client_id;
    const lender_guideline_id: string | undefined = body?.lender_guideline_id;
    const business_profile_id: string | null =
      typeof body?.business_profile_id === "string" ? body.business_profile_id : null;
    const notes =
      typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;

    if (!client_id || typeof client_id !== "string") {
      return NextResponse.json({ error: "client_id is required." }, { status: 400 });
    }
    if (!lender_guideline_id || typeof lender_guideline_id !== "string") {
      return NextResponse.json({ error: "lender_guideline_id is required." }, { status: 400 });
    }

    const { data: guideline, error: guideline_error } = await supabase_admin
      .from("lender_guidelines")
      .select("id, lender_name, specialty, payment_type, min_funding, max_funding")
      .eq("id", lender_guideline_id)
      .single();
    if (guideline_error || !guideline) {
      return NextResponse.json({ error: "Lender not found." }, { status: 404 });
    }

    // One (client, lender) assignment at a time — same rule as the admin path.
    const { data: existing } = await supabase_admin
      .from("client_lender_assignments")
      .select("id")
      .eq("client_id", client_id)
      .eq("lender_name", guideline.lender_name)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: `${guideline.lender_name} is already assigned to this client.` },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();

    // UW adds are trusted: admin_review='approved' so the row is immediately
    // ready_to_submit. admin_reviewed_by stays null (UW users aren't advisors);
    // source='uw_manual' distinguishes it in the audit trail.
    const { data: inserted, error: insert_error } = await supabase_admin
      .from("client_lender_assignments")
      .insert({
        client_id,
        business_profile_id,
        lender_name: guideline.lender_name,
        specialty: guideline.specialty,
        payment_type: guideline.payment_type,
        min_funding: guideline.min_funding,
        max_funding: guideline.max_funding,
        decision: "approved",
        source: "uw_manual",
        status: "pending",
        admin_review: "approved",
        admin_reviewed_at: now,
        admin_review_notes: notes,
        assigned_at: now,
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();

    if (insert_error) {
      console.error("uw manual lender-add insert error:", insert_error);
      return NextResponse.json(
        { error: insert_error.message || "Failed to add lender." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, assignment: inserted });
  } catch (err: any) {
    console.error("uw manual lender-add error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
