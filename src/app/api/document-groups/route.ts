// src/app/api/document-groups/route.ts
/**
 * ============================================================================
 * GET  /api/document-groups?client_vault_id=…&business_profile_id=…  — list
 * POST /api/document-groups                                          — create
 * ============================================================================
 *
 * The group list behind the per-field sections (see @/lib/document-groups).
 * Serves every surface that touches documents — the client's vault, the
 * advisor/admin workspace, and the underwriting file — because all of those
 * roles are allowed to organise files as they upload them.
 *
 * ONE REQUEST PER FILE, NOT PER FIELD. The GET returns every group on the file
 * (all 26 document codes at once) and callers slice it with `groupsForDocCode`.
 * A per-field endpoint would mean up to 26 round trips to render one client
 * page.
 *
 * AUTHORIZATION IS RLS, NOT CODE. Both handlers run through the RLS-gated
 * server client, so document_groups' policies (migration 20260814) are the
 * whole boundary: admin and UW see everything, an advisor sees files they own
 * or follow, a client sees their own. Re-implementing that here would mean two
 * copies of the rule that drift.
 *
 * The one thing RLS does NOT do is fail loudly — a denied INSERT returns no row
 * rather than an error ([[rls_client_writes_need_service_role]]) — so the POST
 * checks for a returned row rather than only for `error`.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateGroupInput } from "@/lib/document-groups";
import { isClientScopedDoc } from "@/lib/document-scope";

export const dynamic = "force-dynamic";

const GROUP_COLUMNS =
  "id, client_vault_id, business_profile_id, doc_code, name, identifier, subtype, nickname, is_active, created_at, created_by_role";

/**
 * Resolve the owning vault from whichever anchor the caller has.
 *
 * Surfaces differ in what's in scope: the client vault knows its business tab,
 * the underwriting file knows the vault. Accepting either keeps callers from
 * having to thread an id they don't hold. Returns null when neither resolves,
 * which the handlers turn into a 400 rather than a silent empty list.
 */
async function resolveVaultId(
  supabase: any,
  client_vault_id: string | null,
  business_profile_id: string | null,
): Promise<string | null> {
  if (client_vault_id) return client_vault_id;
  if (!business_profile_id) return null;
  const { data } = await supabase
    .from("business_profiles")
    .select("client_vault_id")
    .eq("id", business_profile_id)
    .maybeSingle();
  return (data?.client_vault_id as string) ?? null;
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const business_profile_id = searchParams.get("business_profile_id");
    const vault_id = await resolveVaultId(
      supabase,
      searchParams.get("client_vault_id"),
      business_profile_id,
    );

    if (!vault_id) {
      return NextResponse.json(
        { error: "client_vault_id or business_profile_id is required" },
        { status: 400 }
      );
    }

    // Inactive groups are returned too. They're filtered out of the picker by
    // the caller, but the sectioning still needs them: files already filed
    // under a retired group must keep rendering there instead of silently
    // dropping into "Ungrouped".
    let query = supabase
      .from("document_groups")
      .select(GROUP_COLUMNS)
      .eq("client_vault_id", vault_id);

    // Scoped to the active business tab, PLUS the client-scoped groups
    // (business_profile_id NULL) that belong to DL / PFS / MyScoreIQ and render
    // on every tab. Without the NULL arm those fields could never be grouped.
    if (business_profile_id) {
      query = query.or(`business_profile_id.eq.${business_profile_id},business_profile_id.is.null`);
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET /api/document-groups error:", error);
      return NextResponse.json({ error: "Failed to load document groups" }, { status: 500 });
    }

    return NextResponse.json({ groups: data ?? [] });
  } catch (err: any) {
    console.error("GET /api/document-groups threw:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const doc_code: string = (body?.doc_code ?? "").trim();
    const name: string = (body?.name ?? "").trim();
    const identifier: string | null = (body?.identifier ?? "").trim() || null;
    const subtype: string | null = (body?.subtype ?? "").trim() || null;
    const nickname: string | null = (body?.nickname ?? "").trim() || null;
    const requested_business_id: string | null = body?.business_profile_id ?? null;

    if (!doc_code) {
      return NextResponse.json({ error: "doc_code is required" }, { status: 400 });
    }

    const vault_id = await resolveVaultId(
      supabase,
      body?.client_vault_id ?? null,
      requested_business_id,
    );
    if (!vault_id) {
      return NextResponse.json(
        { error: "client_vault_id or business_profile_id is required" },
        { status: 400 }
      );
    }

    // The same validator the picker runs, so the two cannot disagree about what
    // this field requires. Bank statements demand four digits here exactly as
    // they did before the generalization.
    const invalid = validateGroupInput(doc_code, { name, identifier, subtype, nickname });
    if (invalid) {
      return NextResponse.json({ error: invalid }, { status: 400 });
    }

    // Client-scoped fields (DL / PFS / MyScoreIQ) describe the human, and their
    // documents carry business_profile_id NULL — a business-anchored group could
    // never match them. Forcing NULL here rather than trusting the caller means
    // one mis-set field on one surface can't create groups that never appear.
    const business_profile_id = isClientScopedDoc(doc_code) ? null : requested_business_id;

    // Role is recorded for the audit trail only — it grants nothing. A missing
    // users row is not fatal here; RLS has already decided the caller may write.
    const { data: caller } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const { data, error } = await supabase
      .from("document_groups")
      .insert({
        client_vault_id: vault_id,
        business_profile_id,
        doc_code,
        name,
        identifier,
        subtype,
        nickname,
        created_by: user.id,
        created_by_role: caller?.role ?? null,
      })
      .select(GROUP_COLUMNS)
      .maybeSingle();

    if (error) {
      // 23505 = document_groups_dedupe_key. Two people organising the same file
      // at once is the expected way to hit this, so hand back the group that
      // already exists rather than an error the user can't act on.
      if ((error as any).code === "23505") {
        let existing_query = supabase
          .from("document_groups")
          .select(GROUP_COLUMNS)
          .eq("client_vault_id", vault_id)
          .eq("doc_code", doc_code)
          .ilike("name", name);

        existing_query = business_profile_id
          ? existing_query.eq("business_profile_id", business_profile_id)
          : existing_query.is("business_profile_id", null);

        existing_query = identifier
          ? existing_query.eq("identifier", identifier)
          : existing_query.is("identifier", null);

        const { data: existing } = await existing_query.maybeSingle();
        if (existing) return NextResponse.json({ group: existing, already_existed: true });
        return NextResponse.json(
          { error: "That group already exists on this field" },
          { status: 409 }
        );
      }
      console.error("POST /api/document-groups error:", error);
      return NextResponse.json({ error: "Failed to create document group" }, { status: 500 });
    }

    // No error and no row means RLS refused the write silently.
    if (!data) {
      return NextResponse.json(
        { error: "You do not have permission to add a group to this file" },
        { status: 403 }
      );
    }

    return NextResponse.json({ group: data });
  } catch (err: any) {
    console.error("POST /api/document-groups threw:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
