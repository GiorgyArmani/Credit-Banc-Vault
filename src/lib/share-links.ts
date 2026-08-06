// src/lib/share-links.ts
//
// Service-role helpers for lender document share links. A staff member
// generates an expiring, unguessable link to a public page (/share/[token])
// that lists the documents they picked for one business, so the file can be
// handed to an external lender. Sharing is NOT gated on advisor approval —
// staff shop a deal well before the packet is signed off.
//
// Everything here runs server-side with the service role — the table is
// RLS-locked with no policies, so it is unreachable any other way. Validation
// (not revoked, not expired) lives in resolveShareLink.

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchesActiveBusiness } from "@/lib/document-scope";

export const SHARE_BUCKET = "user-documents";
// How long the per-file signed URLs handed to the lender stay valid. The share
// LINK itself lives for days (expires_at); these are regenerated on every page
// load, so a short window is plenty and limits leakage of a copied file URL.
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 2; // 2 hours
export const ALLOWED_EXPIRY_DAYS = [7, 14, 30] as const;
export type ShareExpiryDays = (typeof ALLOWED_EXPIRY_DAYS)[number];

export interface ShareLinkRow {
  id: string;
  token: string;
  client_id: string;
  business_profile_id: string | null;
  created_by: string | null;
  created_by_email: string | null;
  label: string | null;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
  /** Doc codes this link exposes. null = every approved doc (legacy behavior). */
  selected_doc_codes: string[] | null;
  /** Specific file ids this link exposes. Takes precedence over codes when set;
   *  null = fall back to selected_doc_codes (or all approved). */
  selected_document_ids: string[] | null;
}

/** One selectable file for the share modal (grouped under its category label). */
export interface ShareableFile {
  id: string;
  file_name: string;
  doc_code: string;
  label: string;
  /** Whether the category has an advisor approval. Shown as a badge so staff
   *  know what they're sending — it is NOT a gate on sharing. */
  approved: boolean;
}

export interface SharedDocument {
  id: string;
  display_name: string;
  category_label: string;
  size: number | null;
  type: string | null;
  view_url: string;
  download_url: string;
}

export interface ResolvedShare {
  company_name: string;
  client_name: string | null;
  label: string | null;
  expires_at: string;
  documents: SharedDocument[];
}

/** Unguessable URL-safe token. 32 bytes ≈ 43 chars of base64url entropy. */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createShareLink(params: {
  client_id: string;
  business_profile_id: string | null;
  created_by: string | null;
  created_by_email: string | null;
  label: string | null;
  expires_in_days: number;
  /** Exact file ids to expose. Always set by the share modal; null only on
   *  legacy rows, which fall back to "every approved doc". */
  selected_document_ids: string[] | null;
}): Promise<ShareLinkRow | null> {
  const supabase = createAdminClient();
  const token = generateShareToken();
  const expires_at = new Date(
    Date.now() + params.expires_in_days * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("document_share_links")
    .insert({
      token,
      client_id: params.client_id,
      business_profile_id: params.business_profile_id,
      created_by: params.created_by,
      created_by_email: params.created_by_email,
      label: params.label,
      expires_at,
      selected_document_ids: params.selected_document_ids,
    })
    .select("*")
    .single();

  if (error) {
    console.error("createShareLink error:", error);
    return null;
  }
  return data as ShareLinkRow;
}

export async function listShareLinks(
  client_id: string,
  business_profile_id: string | null
): Promise<ShareLinkRow[]> {
  const supabase = createAdminClient();
  // Revoked links are hidden from the manager — once revoked they're gone from
  // the staff's view (the token is already dead server-side).
  let query = supabase
    .from("document_share_links")
    .select("*")
    .eq("client_id", client_id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  // Scope to the active business when one is supplied (client-scoped links with
  // a null business id still belong to the whole client and aren't filtered).
  if (business_profile_id) {
    query = query.eq("business_profile_id", business_profile_id);
  }
  const { data, error } = await query;
  if (error) {
    console.error("listShareLinks error:", error);
    return [];
  }
  return (data ?? []) as ShareLinkRow[];
}

export async function revokeShareLink(id: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("document_share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
  if (error) {
    console.error("revokeShareLink error:", error);
    return false;
  }
  return true;
}

/**
 * Every file a staff member can pick from when minting a share link — one entry
 * per uploaded file on the active business. Approval is reported per file
 * (`approved`) so the modal can badge un-reviewed docs, but it is deliberately
 * NOT a filter: UW/admin share files with lenders long before the packet is
 * fully approved, so waiting on approvals would block the whole workflow.
 */
export async function listShareableFiles(
  client_id: string,
  business_profile_id: string | null
): Promise<ShareableFile[]> {
  const supabase = createAdminClient();

  const { data: client } = await supabase
    .from("client_data_vault")
    .select("user_id")
    .eq("id", client_id)
    .maybeSingle();
  if (!client?.user_id) return [];

  const { data: approvals } = await supabase
    .from("document_category_approvals")
    .select("doc_code, business_profile_id")
    .eq("client_vault_id", client_id);

  const approved_codes = new Set<string>(
    (approvals ?? [])
      .filter((a: any) => matchesActiveBusiness(a.business_profile_id, business_profile_id, a.doc_code))
      .map((a: any) => a.doc_code as string)
  );

  const { data: required } = await supabase
    .from("required_documents")
    .select("code, label");
  const label_by_code = new Map<string, string>(
    (required ?? []).map((r: any) => [r.code as string, r.label as string])
  );

  const { data: docs } = await supabase
    .from("user_documents")
    .select("id, name, custom_label, doc_code, category, business_profile_id, status")
    .eq("user_id", client.user_id);

  const files: ShareableFile[] = [];
  for (const d of (docs ?? []) as any[]) {
    const code = (d.doc_code ?? d.category ?? null) as string | null;
    if (!code) continue;
    // Rejected uploads are known-bad — never offer them to a lender.
    if (d.status === "rejected") continue;
    if (!matchesActiveBusiness(d.business_profile_id, business_profile_id, code)) continue;
    files.push({
      id: d.id as string,
      file_name: (d.custom_label || d.name || "Document") as string,
      doc_code: code,
      label: label_by_code.get(code) || code,
      approved: approved_codes.has(code),
    });
  }

  // Group visually by category label, then file name.
  return files.sort(
    (a, b) => a.label.localeCompare(b.label) || a.file_name.localeCompare(b.file_name)
  );
}

/**
 * Resolve a token into the shared, signed documents — or null when the token is
 * unknown, revoked, or expired. Also bumps view tracking.
 *
 * A link stores the exact files staff picked, so that list is authoritative:
 * the approval state at mint time doesn't re-filter it later (a doc approved
 * after the link was made still isn't shared; a doc shared before approval
 * stays shared). Legacy links with no stored selection fall back to the old
 * "every approved doc for this business" behavior.
 */
export async function resolveShareLink(token: string): Promise<ResolvedShare | null> {
  if (!token) return null;
  const supabase = createAdminClient();

  const { data: link, error: link_error } = await supabase
    .from("document_share_links")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (link_error) {
    console.error("resolveShareLink lookup error:", link_error);
    return null;
  }
  if (!link) return null;
  if (link.revoked_at) return null;
  if (new Date(link.expires_at).getTime() < Date.now()) return null;

  // Client → user_id (documents are keyed by auth user) + display names.
  const { data: client } = await supabase
    .from("client_data_vault")
    .select("user_id, company_name, client_name")
    .eq("id", link.client_id)
    .maybeSingle();

  if (!client?.user_id) return null;

  const business_profile_id = link.business_profile_id as string | null;

  // A link may expose only a chosen subset of files. Precedence:
  //   1. selected_document_ids — the exact files staff picked (current behavior).
  //   2. selected_doc_codes — legacy category-level selection, approved-only.
  //   3. neither — legacy "every approved file".
  const selected_ids = (link.selected_document_ids as string[] | null) ?? null;
  const id_set = selected_ids ? new Set(selected_ids) : null;
  const selected_codes = (link.selected_doc_codes as string[] | null) ?? null;
  const code_set = selected_codes ? new Set(selected_codes) : null;

  // Approved doc codes for this business (client-scoped approvals surface on
  // every business via matchesActiveBusiness). Only the legacy paths need them.
  const approved_codes = new Set<string>();
  if (!id_set) {
    const { data: approvals } = await supabase
      .from("document_category_approvals")
      .select("doc_code, business_profile_id")
      .eq("client_vault_id", link.client_id);
    for (const a of (approvals ?? []) as any[]) {
      if (matchesActiveBusiness(a.business_profile_id, business_profile_id, a.doc_code)) {
        approved_codes.add(a.doc_code as string);
      }
    }
  }

  // Human labels per doc code.
  const { data: required } = await supabase
    .from("required_documents")
    .select("code, label");
  const label_by_code = new Map<string, string>(
    (required ?? []).map((r: any) => [r.code as string, r.label as string])
  );

  // The client's uploaded files, narrowed to this business tab and then to the
  // link's stored selection (or, on legacy links, to approved categories).
  const { data: docs } = await supabase
    .from("user_documents")
    .select("id, name, custom_label, size, type, category, doc_code, business_profile_id, storage_path")
    .eq("user_id", client.user_id);

  const eligible = (docs ?? []).filter((d: any) => {
    const code = (d.doc_code ?? d.category ?? null) as string | null;
    if (!code) return false;
    if (!matchesActiveBusiness(d.business_profile_id, business_profile_id, code)) return false;
    // The stored file list is the whole gate — it was chosen deliberately.
    if (id_set) return id_set.has(d.id);
    if (!approved_codes.has(code)) return false;
    if (code_set) return code_set.has(code);
    return true;
  });

  const documents: SharedDocument[] = [];
  for (const d of eligible as any[]) {
    const code = (d.doc_code ?? d.category ?? "") as string;
    const { data: signed } = await supabase.storage
      .from(SHARE_BUCKET)
      .createSignedUrl(d.storage_path, SIGNED_URL_TTL_SECONDS);
    if (!signed?.signedUrl) continue;
    const view_url = signed.signedUrl;
    const sep = view_url.includes("?") ? "&" : "?";
    const filename = d.custom_label || d.name || "document";
    documents.push({
      id: d.id,
      display_name: filename,
      category_label: label_by_code.get(code) || code || "Document",
      size: d.size ?? null,
      type: d.type ?? null,
      view_url,
      download_url: `${view_url}${sep}download=${encodeURIComponent(filename)}`,
    });
  }

  // Fire-and-forget view tracking.
  supabase
    .from("document_share_links")
    .update({
      view_count: (link.view_count ?? 0) + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq("id", link.id)
    .then(({ error }) => {
      if (error) console.error("resolveShareLink view-bump error:", error);
    });

  return {
    company_name: client.company_name || "Business",
    client_name: client.client_name ?? null,
    label: link.label ?? null,
    expires_at: link.expires_at,
    documents,
  };
}
