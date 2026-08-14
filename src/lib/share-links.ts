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
import { formatGroupShort, type DocumentGroup } from "@/lib/document-groups";
import { isStampable } from "@/lib/watermark";

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
  /** Opt-in: files uploaded AFTER this link was minted join it automatically,
   *  bounded by the two arrays below. See migration 20260813. */
  auto_include_new: boolean;
  /** Categories eligible for auto-inclusion. NULL/empty disables it. */
  auto_include_doc_codes: string[] | null;
  /** Document groups eligible for auto-inclusion of new files (the accounts for
   *  statements, the years for tax returns…). NULL = no group restriction. */
  auto_include_group_ids: string[] | null;
  /** Stamp every file on this link with the Credit Banc mark. Default true. */
  watermark_enabled: boolean;
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
  /** Uploaded after this link was sent. Badged so a lender who already worked
   *  the packet can see what changed instead of re-reading all of it. */
  is_new: boolean;
}

export interface ResolvedShare {
  company_name: string;
  client_name: string | null;
  label: string | null;
  expires_at: string;
  documents: SharedDocument[];
  /** True when this link keeps itself current (auto_include_new). */
  is_live: boolean;
  /** How many of `documents` were uploaded after the link was sent. Drives the
   *  "new since you received this" notice — a lender who already reviewed the
   *  packet has no other way to spot what changed. */
  added_since_created: number;
  created_at: string;
}

/**
 * Document groups for a business, keyed by id.
 *
 * Both the share modal and the lender page fold the group into the CATEGORY
 * LABEL rather than adding a grouping axis of their own: each already groups by
 * that label, so "Business Bank Statements — Chase ••4821" splits a 124-file
 * category into per-account sections on both surfaces for free, and "Tax
 * Returns — 2024" does the same for a five-year run. That is the whole reason a
 * lender can navigate the packet.
 *
 * Client-scoped groups (business_profile_id NULL — the person a licence or PFS
 * belongs to) are pulled in alongside the business's own, since their documents
 * appear on every business tab and would otherwise lose their label.
 *
 * Returns an empty map on failure — the labels then read exactly as they did
 * before groups existed, which is a degraded packet, not a broken page.
 */
async function loadGroupsByBusiness(
  supabase: ReturnType<typeof createAdminClient>,
  client_vault_id: string,
  business_profile_id: string | null
): Promise<Map<string, DocumentGroup>> {
  // Scoped to the vault FIRST. This runs on the service-role client, which
  // bypasses RLS entirely — the client_vault_id filter is the only thing
  // keeping the `business_profile_id IS NULL` arm from sweeping up every
  // client-scoped group in the database.
  let query = supabase
    .from("document_groups")
    .select(
      "id, client_vault_id, business_profile_id, doc_code, name, identifier, subtype, nickname, is_active"
    )
    .eq("client_vault_id", client_vault_id);

  // On a link with no business (legacy rows), every group on the vault is fair
  // game — there is no tab to narrow to.
  if (business_profile_id) {
    query = query.or(`business_profile_id.eq.${business_profile_id},business_profile_id.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("loadGroupsByBusiness error:", error);
    return new Map();
  }
  return new Map((data ?? []).map((g: any) => [g.id as string, g as DocumentGroup]));
}

/** `Business Bank Statements — Chase ••4821`, or the plain label. */
function groupScopedCategoryLabel(
  base_label: string,
  document_group_id: string | null | undefined,
  groups: Map<string, DocumentGroup>
): string {
  if (!document_group_id) return base_label;
  const group = groups.get(document_group_id);
  if (!group) return base_label;
  return `${base_label} — ${formatGroupShort(group)}`;
}

/**
 * Drop documents whose file is not actually in the bucket.
 *
 * user_documents rows and storage objects can drift apart — a failed upload
 * that still inserted its row, a restored database, a manual cleanup of the
 * bucket. One real client currently has five rows and an EMPTY storage folder.
 *
 * This used to happen by accident: resolveShareLink signed a URL per document
 * and skipped any that failed, so a missing file quietly never appeared. Moving
 * to route URLs for watermarking removed that check, which would have left the
 * lender staring at rows that 404 on click. This restores the behaviour
 * deliberately — and does it in ONE storage call for the whole packet rather
 * than the 155 the old per-document signing cost.
 *
 * Fails OPEN: if the listing errors, or is long enough that it may have been
 * truncated, every document is kept. Hiding a real document from a lender is a
 * worse failure than showing one that turns out to be broken.
 */
const STORAGE_LIST_LIMIT = 1000;

async function filterToExistingObjects<T extends { storage_path: string }>(
  supabase: ReturnType<typeof createAdminClient>,
  user_id: string,
  docs: T[]
): Promise<T[]> {
  if (docs.length === 0) return docs;

  const { data, error } = await supabase.storage
    .from(SHARE_BUCKET)
    .list(user_id, { limit: STORAGE_LIST_LIMIT });

  if (error) {
    console.error("share: storage listing failed, keeping every document:", error.message);
    return docs;
  }
  if ((data?.length ?? 0) >= STORAGE_LIST_LIMIT) {
    console.warn(`share: ${user_id} has >= ${STORAGE_LIST_LIMIT} objects; skipping existence filter`);
    return docs;
  }

  const present = new Set((data ?? []).map((f) => f.name));
  const kept = docs.filter((d) => present.has(d.storage_path.split("/").pop() ?? ""));

  if (kept.length !== docs.length) {
    console.warn(
      `share: hiding ${docs.length - kept.length} document(s) with no file in storage (user ${user_id})`
    );
  }
  return kept;
}

/** Unguessable URL-safe token. 32 bytes ≈ 43 chars of base64url entropy. */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Work out what "new files like these" means for a link, from the files staff
 * actually ticked.
 *
 * Runs at mint time rather than at resolve time on purpose: the answer has to
 * reflect the intent expressed WHEN THE LINK WAS MADE. Deriving it live would
 * let today's document set redefine what a link sent last week is allowed to
 * expose.
 *
 * Returns doc codes plus the groups involved. The group list is null — meaning
 * "no restriction" — whenever any shared file was UNGROUPED, because staff
 * sharing unsorted files have not expressed a group intent and narrowing to
 * whichever ones happened to be sorted would quietly drop the rest.
 */
async function deriveAutoIncludeScope(
  supabase: ReturnType<typeof createAdminClient>,
  document_ids: string[]
): Promise<{ doc_codes: string[]; group_ids: string[] | null }> {
  if (document_ids.length === 0) return { doc_codes: [], group_ids: null };

  const { data, error } = await supabase
    .from("user_documents")
    .select("doc_code, category, document_group_id")
    .in("id", document_ids);

  if (error) {
    console.error("deriveAutoIncludeScope error:", error);
    // Empty codes disable auto-inclusion. Failing CLOSED is the only safe
    // direction here — a broken lookup must never widen a link.
    return { doc_codes: [], group_ids: null };
  }

  const doc_codes = new Set<string>();
  const group_ids = new Set<string>();
  let shares_ungrouped_file = false;

  for (const d of (data ?? []) as any[]) {
    const code = (d.doc_code ?? d.category ?? null) as string | null;
    if (!code) continue;
    doc_codes.add(code);

    if (d.document_group_id) group_ids.add(d.document_group_id as string);
    else shares_ungrouped_file = true;
  }

  return {
    doc_codes: Array.from(doc_codes),
    group_ids:
      shares_ungrouped_file || group_ids.size === 0 ? null : Array.from(group_ids),
  };
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
  /** Opt-in: keep the link current as new files land in the shared categories. */
  auto_include_new?: boolean;
  /** Stamp every file with the CB mark. Defaults to true when omitted. */
  watermark_enabled?: boolean;
}): Promise<ShareLinkRow | null> {
  const supabase = createAdminClient();
  const token = generateShareToken();
  const expires_at = new Date(
    Date.now() + params.expires_in_days * 24 * 60 * 60 * 1000
  ).toISOString();

  // Only compute the scope when the flag is on — otherwise the columns stay
  // NULL and the link is a pure snapshot, byte-identical to pre-feature rows.
  const auto_include_new = params.auto_include_new === true;
  const scope = auto_include_new
    ? await deriveAutoIncludeScope(supabase, params.selected_document_ids ?? [])
    : null;

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
      auto_include_new,
      auto_include_doc_codes: scope?.doc_codes ?? null,
      auto_include_group_ids: scope?.group_ids ?? null,
      // Only an explicit false turns stamping off — an omitted or malformed
      // field leaves the link protected.
      watermark_enabled: params.watermark_enabled !== false,
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
    .select("id, name, custom_label, doc_code, category, business_profile_id, status, document_group_id")
    .eq("user_id", client.user_id);

  const groups = await loadGroupsByBusiness(supabase, client_id, business_profile_id);

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
      // Per-group grouping in the picker, so staff can tick "everything from
      // the Chase account" — or "everything from 2024" — instead of hunting
      // through 124 identical rows.
      label: groupScopedCategoryLabel(
        label_by_code.get(code) || code,
        d.document_group_id,
        groups
      ),
      approved: approved_codes.has(code),
    });
  }

  // Group visually by category label, then file name.
  return files.sort(
    (a, b) => a.label.localeCompare(b.label) || a.file_name.localeCompare(b.file_name)
  );
}

/**
 * Everything a token authorises, resolved once.
 *
 * Split out of resolveShareLink because the per-file route
 * (/api/share/[token]/file/[docId]) has to answer exactly the same question —
 * "is this token allowed to see this document?" — and answering it twice, in
 * two places, is how a share link ends up serving a file the page never listed.
 * The eligibility rules live here and nowhere else.
 *
 * A link stores the exact files staff picked, so that list is authoritative:
 * the approval state at mint time doesn't re-filter it later (a doc approved
 * after the link was made still isn't shared; a doc shared before approval
 * stays shared). Legacy links with no stored selection fall back to the old
 * "every approved doc for this business" behavior. Files uploaded AFTER the
 * link was minted join it only when auto-include is on.
 *
 * Returns null when the token is unknown, revoked, or expired.
 */
interface ShareContext {
  supabase: ReturnType<typeof createAdminClient>;
  link: any;
  client: { user_id: string; company_name: string | null; client_name: string | null };
  business_profile_id: string | null;
  /** Rows this token may see, already filtered. */
  eligible: any[];
  label_by_code: Map<string, string>;
  link_created_ms: number;
}

async function loadShareContext(
  token: string,
  /**
   * Narrow the document scan to a single row.
   *
   * The per-file route runs this once PER FILE, and a ZIP of a full packet is
   * 155 of those. Scanning every document the client owns each time turns one
   * download into 155 full-table reads for no benefit — the answer only ever
   * concerns one row. Eligibility is evaluated identically either way.
   */
  only_document_id?: string
): Promise<ShareContext | null> {
  if (!token) return null;
  const supabase = createAdminClient();

  const { data: link, error: link_error } = await supabase
    .from("document_share_links")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (link_error) {
    console.error("loadShareContext lookup error:", link_error);
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

  // Auto-inclusion scope. Empty codes means the link is a snapshot even if the
  // flag somehow got set — deriveAutoIncludeScope fails closed to exactly that.
  const auto_include_new = link.auto_include_new === true;
  const auto_codes = (link.auto_include_doc_codes as string[] | null) ?? null;
  const auto_code_set =
    auto_include_new && auto_codes && auto_codes.length > 0 ? new Set(auto_codes) : null;
  const auto_groups = (link.auto_include_group_ids as string[] | null) ?? null;
  const auto_group_set = auto_groups ? new Set(auto_groups) : null;
  const link_created_ms = new Date(link.created_at as string).getTime();

  // The client's uploaded files, narrowed to this business tab and then to the
  // link's stored selection (or, on legacy links, to approved categories).
  let docs_query = supabase
    .from("user_documents")
    .select("id, name, custom_label, size, type, category, doc_code, business_profile_id, storage_path, document_group_id, status, upload_date")
    .eq("user_id", client.user_id);
  if (only_document_id) docs_query = docs_query.eq("id", only_document_id);
  const { data: docs } = await docs_query;

  /**
   * Does this file join the link through auto-inclusion?
   *
   * Four conditions, all required:
   *   1. the link opted in and named at least one category;
   *   2. the file is in one of those categories;
   *   3. it was uploaded AFTER the link was minted — a file that existed at mint
   *      time and was NOT ticked was deliberately withheld, and must stay
   *      withheld forever. This is the condition that keeps auto-include from
   *      quietly undoing staff's unticking;
   *   4. it sits in one of the shared groups (when the link recorded a group
   *      restriction at all).
   */
  function joins_by_auto_include(d: any, code: string): boolean {
    if (!auto_code_set || !auto_code_set.has(code)) return false;
    const uploaded_ms = d.upload_date ? new Date(d.upload_date).getTime() : NaN;
    if (!Number.isFinite(uploaded_ms) || uploaded_ms <= link_created_ms) return false;
    if (auto_group_set) {
      // An ungrouped file has no group to match, so a link that named groups
      // does not pick it up. It reaches the lender once someone files it.
      if (!d.document_group_id || !auto_group_set.has(d.document_group_id)) return false;
    }
    return true;
  }

  const eligible = (docs ?? []).filter((d: any) => {
    const code = (d.doc_code ?? d.category ?? null) as string | null;
    if (!code) return false;
    if (!matchesActiveBusiness(d.business_profile_id, business_profile_id, code)) return false;
    // Rejected uploads are known-bad. listShareableFiles has always excluded
    // them from the PICKER, but this resolver did not, so a document rejected
    // AFTER being shared stayed visible to the lender for the life of the link
    // — and an auto-included link would have started pulling in fresh rejects.
    // Applies to every path, snapshot links included: this is a bug fix.
    if (d.status === "rejected") return false;

    // The stored file list is the whole gate for what existed at mint time...
    if (id_set) return id_set.has(d.id) || joins_by_auto_include(d, code);

    // ...legacy links keep their category-level behaviour, plus auto-include if
    // it was ever switched on for one.
    if (joins_by_auto_include(d, code)) return true;
    if (!approved_codes.has(code)) return false;
    if (code_set) return code_set.has(code);
    return true;
  });

  return {
    supabase,
    link,
    client: client as ShareContext["client"],
    business_profile_id,
    eligible,
    label_by_code,
    link_created_ms,
  };
}

/**
 * One document this token is allowed to see, as a storage path — or null.
 *
 * Used by the per-file route to answer "may this token fetch this document?"
 * before it stamps or signs anything. Goes through the same eligibility filter
 * as the page listing, so a document that isn't on the page can't be pulled by
 * guessing its id.
 */
export async function resolveShareFile(
  token: string,
  document_id: string
): Promise<{
  supabase: ReturnType<typeof createAdminClient>;
  doc: { id: string; storage_path: string; type: string | null; name: string | null; custom_label: string | null };
  watermark_enabled: boolean;
} | null> {
  const ctx = await loadShareContext(token, document_id);
  if (!ctx) return null;

  const doc = ctx.eligible.find((d: any) => d.id === document_id);
  if (!doc) return null;

  return {
    supabase: ctx.supabase,
    doc: {
      id: doc.id,
      storage_path: doc.storage_path,
      type: doc.type ?? null,
      name: doc.name ?? null,
      custom_label: doc.custom_label ?? null,
    },
    // Column added by 20260813_share_links_watermark.sql. Default TRUE in code
    // as well as in the schema, so a deploy that lands ahead of the migration
    // fails safe (stamped) rather than open.
    watermark_enabled: ctx.link.watermark_enabled !== false,
  };
}

/**
 * Resolve a token into the shared documents for the lender page. Also bumps
 * view tracking.
 */
export async function resolveShareLink(token: string): Promise<ResolvedShare | null> {
  const ctx = await loadShareContext(token);
  if (!ctx) return null;

  const { supabase, link, client, business_profile_id, label_by_code, link_created_ms } = ctx;

  // Only the page listing needs this. The per-file route resolves one document
  // and 404s on its own if the object is gone — paying for a listing there
  // would be one extra storage call per file in a 155-file ZIP.
  const eligible = await filterToExistingObjects(supabase, client.user_id, ctx.eligible);

  const groups = await loadGroupsByBusiness(
    supabase,
    link.client_id as string,
    business_profile_id
  );

  // Whether files on this link are stamped decides what the lender actually
  // RECEIVES, and stamping converts images to PDF. Describing the original type
  // here would name a scan `.jpg` inside the ZIP while its bytes are a PDF —
  // a file the recipient can't open.
  const stamping = link.watermark_enabled !== false;

  const documents: SharedDocument[] = [];
  for (const d of eligible as any[]) {
    const code = (d.doc_code ?? d.category ?? "") as string;
    const raw_name = d.custom_label || d.name || "document";
    const will_be_pdf = stamping && isStampable(d.type, d.name ?? raw_name);
    const filename = will_be_pdf
      ? `${raw_name.replace(/\.[A-Za-z0-9]+$/, "")}.pdf`
      : raw_name;

    // Point at OUR route, never at the stored original.
    //
    // Two things follow from this. The lender never holds a URL to an unstamped
    // file — which is the whole control, since the recipient is the adversary.
    // And the route answers with a 302 to a signed URL for the cached stamped
    // copy, so the bytes still travel Supabase → browser directly and the
    // client-side ZIP is unaffected.
    //
    // A side benefit worth keeping: revocation now bites immediately. Before,
    // a signed URL copied out of the page stayed live for its full 2h TTL after
    // the link was revoked.
    const view_url = `/api/share/${encodeURIComponent(link.token)}/file/${encodeURIComponent(d.id)}`;

    documents.push({
      id: d.id,
      display_name: filename,
      // The lender page groups by this label, so folding the group in is what
      // turns a wall of statements into one section per account — and a stack
      // of returns into one section per year.
      category_label: groupScopedCategoryLabel(
        label_by_code.get(code) || code || "Document",
        d.document_group_id,
        groups
      ),
      // Size is the ORIGINAL's — the stamped copy is a little larger, and we
      // deliberately don't stat storage for 155 files just to refine a hint.
      size: d.size ?? null,
      type: will_be_pdf ? "application/pdf" : d.type ?? null,
      view_url,
      download_url: `${view_url}?download=1`,
      // Computed from upload_date, not from "was it in the snapshot" — a file
      // added by staff re-minting is just as new to the reader.
      is_new: d.upload_date
        ? new Date(d.upload_date).getTime() > link_created_ms
        : false,
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
    // Read off the link row rather than the local it used to close over —
    // the eligibility logic moved into loadShareContext.
    is_live: link.auto_include_new === true,
    added_since_created: documents.filter((d) => d.is_new).length,
    created_at: link.created_at as string,
  };
}
