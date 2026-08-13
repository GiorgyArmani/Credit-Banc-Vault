// src/app/api/bank-accounts/[id]/route.ts
/**
 * ============================================================================
 * PATCH  /api/bank-accounts/[id]   — rename / retype / reactivate an account
 * DELETE /api/bank-accounts/[id]   — remove it, or retire it if it holds files
 * ============================================================================
 *
 * STAFF ONLY, and that is enforced by RLS rather than here: ba_update and
 * ba_delete (migration 20260813) admit admin, UW and the assigned advisor, but
 * NOT the owning client — ba_insert is the only write a client gets. Renaming
 * an account re-labels statements that may already sit in a lender's inbox, so
 * it is not a client-side action.
 *
 * Both handlers therefore look identical to the account routes above; the
 * difference in who may call them lives entirely in the policies.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BANK_ACCOUNT_TYPES, type BankAccountType } from "@/lib/bank-accounts";
import { applyStatementAccount, loadDocLabels } from "@/lib/statement-assignment";

export const dynamic = "force-dynamic";

const ACCOUNT_COLUMNS =
  "id, business_profile_id, bank_name, account_last4, account_type, nickname, is_active, created_at, created_by_role";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const updates: Record<string, unknown> = {};

    if (typeof body?.bank_name === "string") {
      const bank_name = body.bank_name.trim();
      if (!bank_name) {
        return NextResponse.json({ error: "bank_name cannot be empty" }, { status: 400 });
      }
      updates.bank_name = bank_name;
    }

    if (typeof body?.account_last4 === "string") {
      const last4 = body.account_last4.trim();
      if (!/^\d{4}$/.test(last4)) {
        return NextResponse.json(
          { error: "account_last4 must be exactly 4 digits" },
          { status: 400 }
        );
      }
      updates.account_last4 = last4;
    }

    if (typeof body?.account_type === "string") {
      if (!BANK_ACCOUNT_TYPES.includes(body.account_type as BankAccountType)) {
        return NextResponse.json({ error: "Invalid account_type" }, { status: 400 });
      }
      updates.account_type = body.account_type;
    }

    // Explicit null clears the nickname; undefined leaves it alone.
    if (body?.nickname !== undefined) {
      const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
      updates.nickname = nickname || null;
    }

    if (typeof body?.is_active === "boolean") {
      updates.is_active = body.is_active;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("bank_accounts")
      .update(updates)
      .eq("id", id)
      .select(ACCOUNT_COLUMNS)
      .maybeSingle();

    if (error) {
      if ((error as any).code === "23505") {
        return NextResponse.json(
          { error: "Another account on this business already uses that bank and last 4" },
          { status: 409 }
        );
      }
      console.error("PATCH /api/bank-accounts/[id] error:", error);
      return NextResponse.json({ error: "Failed to update bank account" }, { status: 500 });
    }

    // Silent RLS refusal, or the row simply isn't there.
    if (!data) {
      return NextResponse.json(
        { error: "Account not found, or you do not have permission to edit it" },
        { status: 403 }
      );
    }

    // ------------------------------------------------------------------
    // Re-label the account's statements when its NAME changed.
    //
    // custom_label embeds the account as `Chase ••4821` (formatBankAccountShort),
    // so correcting a typo in the bank name or the digits would otherwise leave
    // every file on that account still carrying the wrong one — visible the
    // moment anyone downloads, and on the lender share page.
    //
    // Only bank_name / account_last4 feed the label; nickname and account_type
    // are display-only on the group header, so editing those skips this entirely.
    // ------------------------------------------------------------------
    const label_fields_changed =
      updates.bank_name !== undefined || updates.account_last4 !== undefined;
    let relabelled = 0;

    if (label_fields_changed) {
      const { data: attached } = await supabase
        .from("user_documents")
        .select("id, user_id, doc_code, category, metadata")
        .eq("bank_account_id", id);

      if (attached && attached.length > 0) {
        const label_by_code = await loadDocLabels(
          supabase,
          Array.from(new Set(attached.map((d: any) => (d.doc_code ?? d.category) as string)))
        );
        const { data: vault } = await supabase
          .from("client_data_vault")
          .select("client_name")
          .eq("user_id", attached[0].user_id as string)
          .maybeSingle();

        // Re-apply the SAME account — the row already carries the new name, so
        // this rebuilds each label against it.
        const result = await applyStatementAccount(supabase, {
          documents: attached as any[],
          account: data as any,
          label_by_code,
          client_name: vault?.client_name ?? null,
        });
        relabelled = result.updated;

        // Non-fatal: the account rename itself succeeded and is the thing the
        // user asked for. Report the shortfall rather than pretending.
        if (result.skipped.length > 0) {
          console.error("PATCH /api/bank-accounts/[id]: relabel incomplete", result.skipped);
        }
      }
    }

    return NextResponse.json({ account: data, relabelled });
  } catch (err: any) {
    console.error("PATCH /api/bank-accounts/[id] threw:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Delete an account. THE CLIENT'S FILES ARE NEVER TOUCHED.
 *
 * The FK is ON DELETE SET NULL, so nothing cascades — statements detach and
 * reappear under "Unassigned", where they can be filed onto another account.
 * Deleting an account is a filing-cabinet operation, not a document operation.
 *
 * Two modes, because dumping a sorted account's contents back into the pile is
 * only correct when someone meant it:
 *
 *   * DEFAULT (no ?force) — if the account still holds statements, the request
 *     is REFUSED with a 409 carrying `document_count`. The caller shows that
 *     number and asks. Nothing changes.
 *   * ?force=true — detach and delete. The statements are relabelled on the way
 *     out (via the same helper the assign endpoint uses) so they don't sit in
 *     "Unassigned" still named after an account that no longer exists.
 *
 * An empty account is a typo or a test row, and is removed outright either way.
 *
 * Previously the loaded case deactivated instead of refusing. That was worse:
 * the account vanished from the picker while its group kept rendering, which
 * reads as a failed delete rather than as a deliberate retirement.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const force = new URL(req.url).searchParams.get("force") === "true";

    // Everything currently filed under this account. Selected in full (not just
    // counted) because the force path has to relabel each row.
    const { data: attached, error: attached_error } = await supabase
      .from("user_documents")
      .select("id, user_id, doc_code, category, metadata")
      .eq("bank_account_id", id);

    if (attached_error) {
      console.error("DELETE /api/bank-accounts/[id] attached lookup error:", attached_error);
      return NextResponse.json({ error: "Failed to check attached documents" }, { status: 500 });
    }

    const document_count = (attached ?? []).length;

    if (document_count > 0 && !force) {
      return NextResponse.json(
        {
          error: "account_has_documents",
          document_count,
          message:
            `This account still holds ${document_count} file(s). Deleting it moves them back ` +
            `to Unassigned — the files themselves are not deleted.`,
        },
        { status: 409 }
      );
    }

    // Detach + relabel BEFORE the delete. Doing it after would mean the FK has
    // already nulled bank_account_id and we'd have lost the row set.
    if (document_count > 0) {
      const label_by_code = await loadDocLabels(
        supabase,
        Array.from(
          new Set((attached ?? []).map((d: any) => (d.doc_code ?? d.category) as string))
        )
      );

      const owner_user_id = (attached ?? [])[0].user_id as string;
      const { data: vault } = await supabase
        .from("client_data_vault")
        .select("client_name")
        .eq("user_id", owner_user_id)
        .maybeSingle();

      const result = await applyStatementAccount(supabase, {
        documents: (attached ?? []) as any[],
        account: null,
        label_by_code,
        client_name: vault?.client_name ?? null,
      });

      // Refuse to delete the account while any of its files are still pointing
      // at it — otherwise the FK nulls them out and they keep the old account's
      // name forever, with nothing left to trace it back to.
      if (result.skipped.length > 0) {
        console.error("DELETE /api/bank-accounts/[id]: detach incomplete", result.skipped);
        return NextResponse.json(
          {
            error:
              "Could not detach every file from this account, so it was left in place. " +
              "No files were lost.",
            detached: result.updated,
            failed: result.skipped.length,
          },
          { status: 500 }
        );
      }
    }

    const { data, error } = await supabase
      .from("bank_accounts")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("DELETE /api/bank-accounts/[id] error:", error);
      return NextResponse.json({ error: "Failed to delete bank account" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Account not found, or you do not have permission to remove it" },
        { status: 403 }
      );
    }

    return NextResponse.json({ deleted: true, detached: document_count });
  } catch (err: any) {
    console.error("DELETE /api/bank-accounts/[id] threw:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
