// src/lib/share-links.ts
//
// Service-role helpers for lender document share links. A staff member
// generates an expiring, unguessable link to a public page (/share/[token])
// that lists a client's APPROVED documents for one business, so the file can be
// handed to an external lender.
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
  let query = supabase
    .from("document_share_links")
    .select("*")
    .eq("client_id", client_id)
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
 * Resolve a token into the client's approved, signed documents — or null when
 * the token is unknown, revoked, or expired. Also bumps view tracking.
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

  // Approved doc codes for this business (client-scoped approvals surface on
  // every business via matchesActiveBusiness).
  const { data: approvals } = await supabase
    .from("document_category_approvals")
    .select("doc_code, business_profile_id")
    .eq("client_vault_id", link.client_id);

  const approved_codes = new Set<string>(
    (approvals ?? [])
      .filter((a: any) => matchesActiveBusiness(a.business_profile_id, business_profile_id, a.doc_code))
      .map((a: any) => a.doc_code as string)
  );

  // Human labels per doc code.
  const { data: required } = await supabase
    .from("required_documents")
    .select("code, label");
  const label_by_code = new Map<string, string>(
    (required ?? []).map((r: any) => [r.code as string, r.label as string])
  );

  // The client's uploaded files, kept only if their category is approved AND
  // belongs to this business tab.
  const { data: docs } = await supabase
    .from("user_documents")
    .select("id, name, custom_label, size, type, category, doc_code, business_profile_id, storage_path")
    .eq("user_id", client.user_id);

  const eligible = (docs ?? []).filter((d: any) => {
    const code = (d.doc_code ?? d.category ?? null) as string | null;
    if (!code || !approved_codes.has(code)) return false;
    return matchesActiveBusiness(d.business_profile_id, business_profile_id, code);
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
