// src/app/api/bank-accounts/route.ts
/**
 * ============================================================================
 * GET  /api/bank-accounts?business_profile_id=…   — list accounts
 * POST /api/bank-accounts                          — create one
 * ============================================================================
 *
 * The account list behind the statement grouping (see @/lib/bank-accounts).
 * Serves every surface that touches statements — the client's vault, the
 * advisor/admin workspace, and the underwriting file — because all four roles
 * are allowed to organise statements as they upload them.
 *
 * AUTHORIZATION IS RLS, NOT CODE. Both handlers run through the RLS-gated
 * server client, so bank_accounts' policies (migration 20260813) are the whole
 * boundary: admin and UW see everything, an advisor sees files they own or
 * follow, a client sees their own businesses. Re-implementing that here would
 * mean two copies of the rule that drift.
 *
 * The one thing RLS does NOT do is fail loudly — a denied INSERT returns no row
 * rather than an error ([[rls_client_writes_need_service_role]]) — so the POST
 * checks for a returned row rather than only for `error`.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BANK_ACCOUNT_TYPES, type BankAccountType } from "@/lib/bank-accounts";

export const dynamic = "force-dynamic";

const ACCOUNT_COLUMNS =
  "id, business_profile_id, bank_name, account_last4, account_type, nickname, is_active, created_at, created_by_role";

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const business_profile_id = searchParams.get("business_profile_id");
    if (!business_profile_id) {
      return NextResponse.json(
        { error: "business_profile_id is required" },
        { status: 400 }
      );
    }

    // Inactive accounts are returned too. They're filtered out of the upload
    // picker by the caller, but the grouping still needs them: statements
    // already attached to a deactivated account must keep rendering under it
    // instead of silently dropping into "Unassigned".
    const { data, error } = await supabase
      .from("bank_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("business_profile_id", business_profile_id);

    if (error) {
      console.error("GET /api/bank-accounts error:", error);
      return NextResponse.json({ error: "Failed to load bank accounts" }, { status: 500 });
    }

    return NextResponse.json({ accounts: data ?? [] });
  } catch (err: any) {
    console.error("GET /api/bank-accounts threw:", err);
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
    const business_profile_id: string | undefined = body?.business_profile_id;
    const bank_name: string = (body?.bank_name ?? "").trim();
    const account_last4: string = (body?.account_last4 ?? "").trim();
    const account_type: string = body?.account_type ?? "checking";
    const nickname: string | null = (body?.nickname ?? "").trim() || null;

    if (!business_profile_id || !bank_name || !account_last4) {
      return NextResponse.json(
        { error: "business_profile_id, bank_name and account_last4 are required" },
        { status: 400 }
      );
    }
    // Mirrors the CHECK on the column. Validated here as well so the user gets
    // "must be the last 4 digits" instead of a raw Postgres constraint string.
    if (!/^\d{4}$/.test(account_last4)) {
      return NextResponse.json(
        { error: "account_last4 must be exactly 4 digits" },
        { status: 400 }
      );
    }
    if (!BANK_ACCOUNT_TYPES.includes(account_type as BankAccountType)) {
      return NextResponse.json({ error: "Invalid account_type" }, { status: 400 });
    }

    // Role is recorded for the audit trail only — it grants nothing. A missing
    // users row is not fatal here; RLS has already decided the caller may write.
    const { data: caller } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const { data, error } = await supabase
      .from("bank_accounts")
      .insert({
        business_profile_id,
        bank_name,
        account_last4,
        account_type,
        nickname,
        created_by: user.id,
        created_by_role: caller?.role ?? null,
      })
      .select(ACCOUNT_COLUMNS)
      .maybeSingle();

    if (error) {
      // 23505 = the (business, bank, last4) unique index. Two people organising
      // the same file at once is the expected way to hit this, so hand back the
      // account that already exists rather than an error the user can't act on.
      if ((error as any).code === "23505") {
        const { data: existing } = await supabase
          .from("bank_accounts")
          .select(ACCOUNT_COLUMNS)
          .eq("business_profile_id", business_profile_id)
          .eq("account_last4", account_last4)
          .ilike("bank_name", bank_name)
          .maybeSingle();
        if (existing) return NextResponse.json({ account: existing, already_existed: true });
        return NextResponse.json(
          { error: "That account already exists on this business" },
          { status: 409 }
        );
      }
      console.error("POST /api/bank-accounts error:", error);
      return NextResponse.json({ error: "Failed to create bank account" }, { status: 500 });
    }

    // No error and no row means RLS refused the write silently.
    if (!data) {
      return NextResponse.json(
        { error: "You do not have permission to add an account to this business" },
        { status: 403 }
      );
    }

    return NextResponse.json({ account: data });
  } catch (err: any) {
    console.error("POST /api/bank-accounts threw:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
