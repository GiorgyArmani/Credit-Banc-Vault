// src/lib/lender-api/documents.ts
//
// Which vault files can go to a lender, and turning the chosen ones into
// signed URLs the lender fetches. Reuses the share-link watermark pipeline:
// stampable files (PDF/JPEG/PNG) go out as the cached stamped copy; anything
// else goes out as the original — only because UW explicitly ticked it.

import { matchesActiveBusiness, matchesActiveDeal } from "@/lib/document-scope";
import { filterToExistingObjects, groupScopedCategoryLabel, loadGroupsByBusiness } from "@/lib/share-links";
import { DOCUMENTS_BUCKET, getWatermarkedPath, isStampable } from "@/lib/watermark";
import type {
  LenderApiProvider,
  LenderApiSource,
  OutboundDocument,
  OutboundDocumentResult,
  SubmittableDocument,
} from "./types";
import type { AdminClient } from "./source";

/** Lenders process attachments asynchronously; give them a day to fetch. */
export const SIGNED_URL_TTL_FOR_LENDER = 86_400;

export interface DocumentRow {
  id: string;
  name: string;
  custom_label: string | null;
  doc_code: string | null;
  category: string | null;
  business_profile_id: string | null;
  funding_deal_id: string | null;
  status: string | null;
  document_group_id: string | null;
  storage_path: string;
  type: string | null;
}

export interface ApprovalRow {
  doc_code: string;
  business_profile_id: string | null;
  funding_deal_id: string | null;
}

const DOCUMENT_COLUMNS =
  "id, name, custom_label, doc_code, category, business_profile_id, funding_deal_id, status, document_group_id, storage_path, type";

export function selectSubmittable(args: {
  rows: DocumentRow[];
  approvals: ApprovalRow[];
  businessProfileId: string | null;
  dealId: string | null;
  labelFor: (code: string, groupId: string | null) => string;
  tagsForDocCode: (code: string | null) => string[];
}): SubmittableDocument[] {
  const { rows, approvals, businessProfileId, dealId } = args;
  const out: SubmittableDocument[] = [];

  for (const row of rows) {
    const code = row.doc_code ?? row.category;
    if (!code) continue;
    if (row.status === "rejected") continue;
    if (!matchesActiveBusiness(row.business_profile_id, businessProfileId, code)) continue;
    if (!matchesActiveDeal(row.funding_deal_id, dealId)) continue;

    const approved = approvals.some(
      (a) =>
        a.doc_code === code &&
        matchesActiveBusiness(a.business_profile_id, businessProfileId, code) &&
        matchesActiveDeal(a.funding_deal_id, dealId)
    );

    out.push({
      id: row.id,
      file_name: row.custom_label || row.name || "Document",
      label: args.labelFor(code, row.document_group_id),
      doc_code: code,
      tags: args.tagsForDocCode(code),
      stampable: isStampable(row.type, row.name),
      preselected: approved,
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label) || a.file_name.localeCompare(b.file_name));
}

const EXTENSION_RE = /\.[A-Za-z0-9]+$/;

export function outboundFilename(row: { custom_label: string | null; name: string }, stamped: boolean): string {
  const base = (row.custom_label || row.name || "document").replace(/[\\/]+/g, "-").replace(/\s+-\s*|\s*-\s+/g, " - ").trim();
  if (stamped) return `${base.replace(EXTENSION_RE, "")}.pdf`;
  // A custom label usually has no extension; the lender needs one to open the
  // original (unstamped) file, so borrow it from the stored file name.
  if (!EXTENSION_RE.test(base)) {
    const ext = (row.name ?? "").match(EXTENSION_RE)?.[0];
    if (ext) return `${base}${ext}`;
  }
  return base;
}

async function loadRows(admin: AdminClient, source: LenderApiSource) {
  const clientId = source.assignment.client_id;
  const businessId = source.assignment.business_profile_id;

  const [{ data: rows }, { data: approvals }, { data: required }, groups] = await Promise.all([
    admin.from("user_documents").select(DOCUMENT_COLUMNS).eq("user_id", source.vault.user_id),
    admin
      .from("document_category_approvals")
      .select("doc_code, business_profile_id, funding_deal_id")
      .eq("client_vault_id", clientId),
    admin.from("required_documents").select("code, label"),
    loadGroupsByBusiness(admin, clientId, businessId),
  ]);

  const labelByCode = new Map<string, string>((required ?? []).map((r: any) => [r.code, r.label]));
  const existing = await filterToExistingObjects(admin, source.vault.user_id, (rows ?? []) as DocumentRow[]);

  return {
    rows: existing,
    approvals: (approvals ?? []) as ApprovalRow[],
    labelFor: (code: string, groupId: string | null) =>
      groupScopedCategoryLabel(labelByCode.get(code) || code, groupId, groups),
  };
}

export async function listSubmittableDocuments(
  admin: AdminClient,
  source: LenderApiSource,
  provider: LenderApiProvider
): Promise<SubmittableDocument[]> {
  const { rows, approvals, labelFor } = await loadRows(admin, source);
  return selectSubmittable({
    rows,
    approvals,
    businessProfileId: source.assignment.business_profile_id,
    dealId: source.assignment.funding_deal_id,
    labelFor,
    tagsForDocCode: (c) => provider.tagsForDocCode(c),
  });
}

export async function prepareOutboundDocuments(
  admin: AdminClient,
  source: LenderApiSource,
  provider: LenderApiProvider,
  documentIds: string[]
): Promise<{ docs: OutboundDocument[]; failures: OutboundDocumentResult[] }> {
  const { rows, approvals, labelFor } = await loadRows(admin, source);
  // Authorization: only files the panel could have offered for this business
  // and round may leave. Anything else (a forged id, or a file deleted or
  // re-scoped since the send) is recorded as unavailable — terminal, so the
  // submission can still settle instead of retrying it forever.
  const allowed = new Set(
    selectSubmittable({
      rows,
      approvals,
      businessProfileId: source.assignment.business_profile_id,
      dealId: source.assignment.funding_deal_id,
      labelFor,
      tagsForDocCode: (c) => provider.tagsForDocCode(c),
    }).map((d) => d.id)
  );
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const docs: OutboundDocument[] = [];
  const failures: OutboundDocumentResult[] = [];

  // Sequential on purpose: first-time stamping loads whole PDFs into memory.
  for (const id of documentIds) {
    const row = rowById.get(id);
    if (!row || !allowed.has(id)) {
      failures.push({
        documentId: id,
        filename: "(unavailable)",
        stamped: false,
        accepted: false,
        unavailable: true,
        error: "No longer available",
      });
      continue;
    }

    const serve = isStampable(row.type, row.name)
      ? await getWatermarkedPath(admin, { storage_path: row.storage_path, type: row.type, name: row.name })
      : { path: row.storage_path, stamped: false, generated: false };

    const filename = outboundFilename(row, serve.stamped);
    const { data: signed, error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(serve.path, SIGNED_URL_TTL_FOR_LENDER);

    if (error || !signed?.signedUrl) {
      console.error(`lender-api: could not sign document ${id}: ${error?.message ?? "no url"}`);
      failures.push({ documentId: id, filename, stamped: serve.stamped, accepted: false, error: "Could not prepare file" });
      continue;
    }

    docs.push({
      documentId: id,
      filename,
      url: signed.signedUrl,
      docCode: row.doc_code ?? row.category,
      stamped: serve.stamped,
    });
  }

  return { docs, failures };
}
