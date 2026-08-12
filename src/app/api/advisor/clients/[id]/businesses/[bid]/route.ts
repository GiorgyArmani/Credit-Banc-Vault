import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { CLIENT_API_ROLES, isScopedAdvisorRole } from "@/lib/auth/roles";

// DELETE /api/advisor/clients/[id]/businesses/[bid]
//   Permanently removes a non-primary business for this client. Cleans up
//   business-scoped rows: storage objects, user_documents,
//   client_dynamic_documents, document_category_approvals,
//   client_open_positions, client_lender_assignments, bank_analysis_results.
//   funding_deals are removed automatically via FK CASCADE on
//   business_profiles.
//
//   NOTE: submissions (UNIQUE per user_id — one row across all businesses)
//   and loan_status_history (client_vault_id-keyed — history survives the
//   business that produced it) are NOT explicitly deleted here. Their FK
//   to business_profiles is ON DELETE SET NULL, so the column nulls out
//   automatically when the business goes away. Explicitly deleting them
//   used to wipe the user's whole submissions row and a slice of pipeline
//   history that belongs to the surviving business(es).
//
// Guards:
//   * Caller must be admin, the client's assigned advisor, or a follower.
//   * Primary business is never deletable (would orphan the client).

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; bid: string }> }) {
  const { id: clientVaultId, bid: businessProfileId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = userRow?.role;
  if (!role || !(CLIENT_API_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: client } = await admin
    .from("client_data_vault")
    .select("id, advisor_id, user_id")
    .eq("id", clientVaultId)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // Advisor access gate (admins skip). Covers external partner advisors too —
  // they are bounded to the files they own or follow, same as staff advisors.
  if (isScopedAdvisorRole(role)) {
    const { data: me } = await admin
      .from("advisors")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Advisor profile missing" }, { status: 403 });

    const isOwner = client.advisor_id === me.id;
    const { data: follower } = await admin
      .from("client_followers")
      .select("id")
      .eq("client_vault_id", clientVaultId)
      .eq("advisor_id", me.id)
      .maybeSingle();

    if (!isOwner && !follower) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }

  const { data: business } = await admin
    .from("business_profiles")
    .select("id, client_vault_id, is_primary, company_name")
    .eq("id", businessProfileId)
    .maybeSingle();

  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  if (business.client_vault_id !== clientVaultId) {
    return NextResponse.json({ error: "Business does not belong to this client" }, { status: 400 });
  }
  if (business.is_primary) {
    return NextResponse.json(
      { error: "Cannot delete the primary business. Delete the entire client instead." },
      { status: 400 }
    );
  }

  // 1. Storage cleanup — remove uploaded files for this business from the bucket.
  const { data: docsToRemove } = await admin
    .from("user_documents")
    .select("storage_path")
    .eq("business_profile_id", businessProfileId);
  const paths = (docsToRemove ?? []).map((d: any) => d.storage_path).filter(Boolean);
  if (paths.length > 0) {
    try {
      await admin.storage.from("user-documents").remove(paths);
    } catch (e) {
      console.error("Storage cleanup failed (non-fatal):", e);
    }
  }

  // 2. DB cleanup for tables where FK is SET NULL on business delete. Without
  //    these explicit deletes, the rows would survive with business_profile_id
  //    nulled out — visible on every tab via the legacy-row fallback, which
  //    isn't what "delete this business" means.
  const supaCleanup = async (table: string, column: string = "business_profile_id") => {
    const { error } = await admin.from(table).delete().eq(column, businessProfileId);
    if (error) console.error(`Cleanup failed for ${table}:`, error);
  };

  await Promise.all([
    supaCleanup("user_documents"),
    supaCleanup("client_dynamic_documents"),
    supaCleanup("document_category_approvals"),
    supaCleanup("client_open_positions"),
    supaCleanup("client_lender_assignments"),
    supaCleanup("bank_analysis_results"),
  ]);

  // 3. Delete the business itself. funding_deals + events cascade via FK.
  const { error: delErr } = await admin
    .from("business_profiles")
    .delete()
    .eq("id", businessProfileId);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, deleted_business_id: businessProfileId, company_name: business.company_name });
}
