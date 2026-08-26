// src/lib/document-access.ts
//
// Who may read one row of `user_documents`, decided in ONE place.
//
// WHY THIS EXISTS. `user-documents` is the bucket holding every client file —
// bank statements, tax returns, driver's licences, signed applications. It used
// to be a PUBLIC bucket, which meant a stored object URL returned the bytes to
// anyone on the internet with no key at all, and the browser's anon key could
// `.download()` any path it knew. Storage RLS does not apply to downloads from
// a public bucket, so the thirteen hand-written storage policies on it were
// decoration.
//
// The fix is to stop letting browsers touch storage: the service role is the
// only thing that reads the bucket, and reads are authorised HERE by the same
// rules the rest of the app already uses, then handed out as a short-lived
// signed URL by GET /api/documents/[id]/file.
//
// Deliberately NOT re-expressed as storage RLS. "The advisor assigned to this
// vault, or following it, or internal staff" is app logic that already lives in
// TypeScript (see checkClientAccess). Copying it into storage policies would
// mean two definitions of access that drift the moment one changes — which is
// how the bucket ended up with three overlapping generations of policy in the
// first place.

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isScopedAdvisorRole } from "@/lib/auth/roles";

/** The columns a caller needs to serve or name a file. */
export interface AccessibleDocument {
  id: string;
  user_id: string;
  storage_path: string;
  name: string | null;
  custom_label: string | null;
  type: string | null;
}

export type DocumentAccessResult =
  | { ok: true; doc: AccessibleDocument }
  | { ok: false; status: 401 | 403 | 404 };

/**
 * Roles that work every file and so need no per-vault check. Mirrors the
 * `is_staff` shortcut in /api/advisor/clients/upload/sign — an underwriter is
 * handed the whole pipeline, not an assignment list.
 *
 * `setter` is absent on purpose: setters create fast-funding files and never
 * open a document. `referral_partner`, `affiliate` and `free` are absent
 * because a client reaches their OWN documents through the owner branch below,
 * never through a role.
 */
const UNSCOPED_STAFF_ROLES = ["admin", "underwriting"] as const;

/**
 * Resolve a document id for the CURRENT request's caller.
 *
 * Returns a discriminated result rather than throwing so the route can answer
 * the right status code. 404 is used both for "no such document" and for
 * "exists but you may not have it", so a stranger cannot probe which document
 * ids are real — the same reason /api/share/[token]/file collapses its
 * failures into one 404.
 */
export async function resolveDocumentForCaller(
  document_id: string
): Promise<DocumentAccessResult> {
  if (!document_id) return { ok: false, status: 404 };

  const supabase = await createClient();
  const {
    data: { user },
    error: auth_error,
  } = await supabase.auth.getUser();

  if (auth_error || !user) return { ok: false, status: 401 };

  const admin = createAdminClient();

  const { data: doc } = await admin
    .from("user_documents")
    .select("id, user_id, storage_path, name, custom_label, type")
    .eq("id", document_id)
    .maybeSingle();

  if (!doc?.storage_path) return { ok: false, status: 404 };

  const allowed = await callerMayReadClientFiles(admin, user.id, doc.user_id);
  if (!allowed) return { ok: false, status: 404 };

  return { ok: true, doc: doc as AccessibleDocument };
}

/**
 * The access rule itself: may `caller_user_id` read files belonging to the
 * client whose auth id is `client_user_id`?
 *
 * Exported because the batch/ZIP path authorises many documents belonging to
 * one client and must not repeat the vault lookup per file.
 */
export async function callerMayReadClientFiles(
  admin: ReturnType<typeof createAdminClient>,
  caller_user_id: string,
  client_user_id: string
): Promise<boolean> {
  // 1. The client themselves. This is the vault at /dashboard, and it is the
  //    only branch that needs no vault lookup at all.
  if (caller_user_id === client_user_id) return true;

  const { data: caller } = await admin
    .from("users")
    .select("role")
    .eq("id", caller_user_id)
    .maybeSingle();

  const role = caller?.role ?? null;

  // 2. Internal desks that work every file.
  if (role && (UNSCOPED_STAFF_ROLES as readonly string[]).includes(role)) return true;

  // 3. Advisor-shaped callers — the staff advisor and the external
  //    partner_advisor alike — are bounded to files they own or follow.
  //    Anything else (client of another vault, affiliate, setter,
  //    referral_partner, unknown role) falls through to false.
  if (!isScopedAdvisorRole(role)) return false;

  const { data: advisor } = await admin
    .from("advisors")
    .select("id")
    .eq("user_id", caller_user_id)
    .maybeSingle();

  if (!advisor?.id) return false;

  const { data: vault } = await admin
    .from("client_data_vault")
    .select("id, advisor_id")
    .eq("user_id", client_user_id)
    .maybeSingle();

  if (!vault?.id) return false;
  if (vault.advisor_id === advisor.id) return true;

  const { data: follower } = await admin
    .from("client_followers")
    .select("id")
    .eq("client_vault_id", vault.id)
    .eq("advisor_id", advisor.id)
    .maybeSingle();

  return !!follower;
}

/**
 * What the file is called when it lands on disk. Same rule as the staff
 * download helper: prefer the human label, never hand the OS an extensionless
 * file.
 */
export function resolveServedFileName(doc: AccessibleDocument): string {
  const fallback = doc.name || "document";
  if (!doc.custom_label) return fallback;

  const ext_index = fallback.lastIndexOf(".");
  const extension = ext_index !== -1 ? fallback.substring(ext_index) : "";
  if (extension && !doc.custom_label.toLowerCase().endsWith(extension.toLowerCase())) {
    return doc.custom_label + extension;
  }
  return doc.custom_label;
}
