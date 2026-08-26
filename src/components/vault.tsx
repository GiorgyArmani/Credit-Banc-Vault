"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import clsx from "clsx";
import {
  Upload, Trash2, Download, FileText, Pencil, CheckCircle2, AlertCircle, X, ChevronDown, ChevronRight, Eye
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { PremiumLoader } from "./ui/premium-loader";
import DocumentPreviewModal from "@/components/pdf/pdf-viewer";
import { isClientScopedDoc, isCarryOverDoc, matchesActiveBusiness, matchesActiveDeal } from "@/lib/document-scope";
import {
  buildGroupedDisplayLabel,
  groupsForDocCode,
  offersGrouping,
  parseDocumentPeriod,
  type DocumentGroup,
} from "@/lib/document-groups";
import { DocumentGroupPicker } from "@/components/document-group-picker";
import { useDocumentGroups } from "@/hooks/use-document-groups";
import { markLabelAsManual } from '@/lib/group-assignment';
import { downloadDocument } from '@/lib/document-download';

/**
 * DocumentType: Interface for documents requested for the user
 */
interface DocumentType {
  code: string;
  label: string;
  multiple?: boolean;
  minFiles?: number;
  maxFiles?: number;
  legacyCodes?: readonly string[];
  isCore?: boolean;
  ghlTag?: string;
}

/**
 * UserDocument: Interface for documents stored in the database
 */
interface UserDocument {
  id: string;
  name: string;
  size: number;
  type: string;
  category: string | null;
  custom_label: string | null;
  description: string | null;
  is_favorite: boolean;
  upload_date: string;
  storage_path: string;
  tags?: string[];
  uploaded_by_role?: 'advisor' | 'client';
  status?: string;
  metadata?: any;
}

type ChecklistInfo = { progress: number; complete: boolean };

/**
 * DocumentCard: Individual card component for each document type
 */
interface DocumentCardProps {
  docType: DocumentType;
  documents: UserDocument[];
  userId: string;
  onUploadComplete: () => void;
  onDelete: (doc: UserDocument) => void;
  onEdit: (doc: UserDocument) => void;
  onToggleFavorite: (doc: UserDocument) => void;
  onDownload: (doc: UserDocument) => void;
  onPreview: (doc: UserDocument) => void;
  clientName: string | null;
  isApproved?: boolean;
  isRejected?: boolean;
  rejectionReason?: string;
  /** Active business tab. Uploads land scoped to this business, unless the
   *  doc is client-scoped (DL/PFS/MyScoreIQ), which always land NULL so they
   *  serve every tab and survive business deletion. */
  activeBusinessId?: string | null;
  /** The funding round this upload belongs to. Carry-over docs (identity /
   *  entity paperwork) are stamped NULL so they serve every future round. */
  activeDealId?: string | null;
  /** Optional DOM id for the website tour to anchor on (set on the first card). */
  anchorId?: string;
  /** Start expanded. The list opens ONE row on arrival — the next thing the
   *  client actually has to do — so the page shows what to do without a wall of
   *  fourteen open dropzones. A rejected row overrides this and always opens. */
  defaultOpen?: boolean;
  /** Every group on the file; each card slices out its own field's. */
  documentGroups?: DocumentGroup[];
  /** Lifts a newly created group up to the shared list. */
  onGroupCreated?: (group: DocumentGroup) => void;
}

function DocumentCard({
  docType,
  documents,
  userId,
  onUploadComplete,
  onDelete,
  onEdit,
  onToggleFavorite,
  onDownload,
  onPreview,
  clientName,
  isApproved = false,
  isRejected = false,
  rejectionReason,
  activeBusinessId,
  activeDealId,
  anchorId,
  defaultOpen = false,
  documentGroups = [],
  onGroupCreated,
}: DocumentCardProps) {
  const supabase = createClient();
  const { toast } = useToast();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [customName, setCustomName] = useState("");
  // Null means "not specified" — the file still uploads and lands in the
  // Ungrouped section for staff to sort. Never a blocking requirement.
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const fieldGroups = groupsForDocCode(documentGroups, docType.code);
  // `multiple` is required_documents.is_multiple, threaded through the
  // requirements API — the authoritative signal, so this card doesn't fall back
  // to the static mirror in @/lib/document-groups.
  const offersGroupPicker = offersGrouping(docType.code, {
    isMultiple: docType.multiple,
    groupCount: fieldGroups.length,
  });

  const relevantDocs = documents.filter(doc =>
    doc.category === docType.code ||
    (doc as any).doc_code === docType.code ||
    docType.legacyCodes?.includes(doc.category || "") ||
    docType.legacyCodes?.includes((doc as any).doc_code || "")
  );

  const hasDocuments = relevantDocs.length > 0;
  //@ts-ignore
  const isComplete = hasDocuments && relevantDocs.length >= (docType.minFiles || 1);
  const isReadyForReview = isComplete && !isApproved && !isRejected;

  // Closed by default, because in a list "open" is the exception. Rejected rows
  // open regardless — the advisor's note is the whole reason the row is red and
  // a client should never have to click to discover it.
  const [isExpanded, setIsExpanded] = useState(defaultOpen || isRejected);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const newFiles = Array.from(e.target.files);

    const max = docType.maxFiles || 1;
    const multiple = docType.multiple || false;

    if (!multiple && newFiles.length > 1) {
      toast({
        title: "Single file only",
        description: "Please select only one file for this document type.",
        variant: "destructive"
      });
      return;
    }

    if (selectedFiles.length + newFiles.length > max) {
      toast({
        title: "Too many files",
        description: `You can only upload up to ${max} files.`,
        variant: "destructive"
      });
      return;
    }

    if (!multiple) {
      setSelectedFiles([newFiles[0]]);
      setCustomName(newFiles[0].name.replace(/\.[^.]+$/, ""));
    } else {
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0 || !userId) return;
    setUploading(true);
    let successCount = 0;
    // Only honour the picker on a card that actually shows it, and only for a
    // group that is really on this field's list — a stale id (business tab
    // switched mid-upload) must not be written.
    const selectedGroup = offersGroupPicker
      ? fieldGroups.find(g => g.id === selectedGroupId) ?? null
      : null;

    try {
      for (const file of selectedFiles) {
        const ext = file.name.split(".").pop() || "bin";
        // With a group, the label carries it and — when the original filename
        // gives it up — the period, so twelve statements no longer download as
        // twelve identically named files. Without one, this returns exactly the
        // old `${label} - ${client}` string.
        const standardizedName = buildGroupedDisplayLabel({
          doc_label: docType.label,
          client_name: clientName || "Client",
          group: selectedGroup,
          period: selectedGroup ? parseDocumentPeriod(file.name) : null,
        });
        // The path and the upload credential both come from the server now:
        // the browser holds no storage key, and the route builds the path from
        // the caller's own auth id so it cannot be aimed at another vault.
        const signRes = await fetch("/api/documents/upload/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doc_code: docType.code, file_name: file.name }),
        });
        const sign = await signRes.json().catch(() => null);
        if (!signRes.ok || !sign?.success) {
          throw new Error(sign?.error || `Could not start upload (${signRes.status})`);
        }
        const filePath: string = sign.file_path;

        const { error: upErr } = await supabase.storage
          .from("user-documents")
          .uploadToSignedUrl(filePath, sign.token, file, {
            contentType: file.type || "application/octet-stream",
            upsert: true,
          });
        if (upErr) throw upErr;

        const { data, error: dbErr } = await supabase
          .from("user_documents")
          .insert({
            user_id: userId,
            name: `${standardizedName}.${ext}`,
            size: file.size,
            type: file.type,
            storage_path: filePath,
            category: docType.code,
            doc_code: docType.code,
            custom_label: standardizedName,
            uploaded_by_role: 'client',
            // Scope this upload to the active business tab. Client-scoped docs
            // (driver's license, MyScoreIQ, PFS) land with business_profile_id
            // NULL so they aren't pinned to a single business — the matcher
            // surfaces them on every tab and they survive business deletion.
            business_profile_id: isClientScopedDoc(docType.code)
              ? null
              : (activeBusinessId ?? null),
            // Carry-over paperwork (identity + entity docs) stays unstamped so
            // it serves every future funding round; everything else belongs to
            // the round it was collected for.
            funding_deal_id: isCarryOverDoc(docType.code) ? null : (activeDealId ?? null),
            document_group_id: selectedGroup?.id ?? null,
            metadata: {
              tags: [docType.code],
              // `name` above is the standardized label, so the original file
              // name is otherwise discarded — and with it the only clue to which
              // period a file covers.
              original_file_name: file.name,
            },
          })
          .select("*")
          .single();
        if (dbErr) throw dbErr;

        // /api/uploads runs the slow bookkeeping (GHL file sync, advisor email,
        // pipeline advance). We DON'T await it: the file is already in Supabase
        // and listed in the vault, so the client has nothing to wait for — the
        // perceived upload time is just storage + this DB insert. `keepalive`
        // lets the request finish server-side even if the client navigates away
        // right after. Failures only mean GHL/advisor lag behind; log them.
        void fetch("/api/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            document_id: data.id,
            storage_path: data.storage_path,
            doc_code: docType.code
          }),
          keepalive: true,
        })
          .then(async (res) => {
            if (!res.ok) {
              console.error(`Post-upload sync failed for ${docType.code}: ${res.status} ${await res.text().catch(() => "")}`);
            }
          })
          .catch((e) => {
            console.error(`Post-upload sync threw for ${docType.code}:`, e);
          });

        successCount++;
      }
      if (successCount > 0) {
        toast({ title: "Upload complete", description: `Successfully uploaded ${successCount} file(s).` });
        setSelectedFiles([]);
        onUploadComplete();
      }
    } catch (err: any) {
      toast({ title: "Upload error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // A row, not a card. Fourteen always-open cards in a two-column grid meant a
  // client scrolled a full screen per document and could not see how many were
  // left; the checklist is a LIST, and a list reads as one thing to work down.
  // Everything below the header is the same upload flow as before — only the
  // presentation changed.
  const statusLabel = isApproved
    ? "Approved"
    : isRejected
      ? "Action needed"
      : isReadyForReview
        ? "In review"
        : "Upload";

  return (
    <div
      id={anchorId}
      className={clsx(
        "overflow-hidden rounded-xl border transition-colors",
        isRejected
          ? "border-rose-200 bg-rose-50/40"
          : isApproved
            ? "border-cb-mint/30 bg-cb-mint/[0.04]"
            : "border-black/[0.07] bg-white hover:border-black/15"
      )}
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className={clsx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            isApproved
              ? "bg-cb-mint text-white"
              : isRejected
                ? "bg-rose-500 text-white"
                : isReadyForReview
                  ? "bg-amber-400 text-white"
                  : "bg-cb-cream text-cb-ink/35"
          )}
        >
          {isApproved ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : isRejected ? (
            <AlertCircle className="h-4 w-4" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-cb-ink">
            {docType.label}
          </span>
          {relevantDocs.length > 0 && (
            <span className="mt-0.5 block text-[11px] text-cb-ink/40">
              {relevantDocs.length} file{relevantDocs.length !== 1 ? "s" : ""} uploaded
            </span>
          )}
        </span>

        <span
          className={clsx(
            "hidden shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] sm:inline-block",
            isApproved
              ? "bg-cb-mint/15 text-emerald-700"
              : isRejected
                ? "bg-rose-100 text-rose-700"
                : isReadyForReview
                  ? "bg-amber-100 text-amber-700"
                  : "bg-black/[0.04] text-cb-ink/45"
          )}
        >
          {statusLabel}
        </span>

        <ChevronDown
          className={clsx(
            "h-4 w-4 shrink-0 text-cb-ink/30 transition-transform",
            isExpanded && "rotate-180"
          )}
        />
      </button>

      {isExpanded && (
        <div className="space-y-4 border-t border-black/5 px-4 pb-4 pt-4">
          {isRejected && rejectionReason && (
            <div className="rounded-xl border border-rose-200 bg-white p-4">
              <p className="flex items-center gap-2 text-xs font-bold text-rose-700">
                <AlertCircle className="h-3.5 w-3.5" />
                Your advisor asked for a new file
              </p>
              <p className="mt-2 text-sm leading-relaxed text-cb-ink/70">
                &ldquo;{rejectionReason}&rdquo;
              </p>
            </div>
          )}

          {/* Which group these files belong to. Above the dropzone on purpose:
              picked BEFORE the files, so a batch drop of twelve months lands
              already sorted. Applies to every file in this upload — one group
              per batch is how documents actually arrive, and it keeps the
              client from tagging file-by-file. */}
          {offersGroupPicker && (
            <DocumentGroupPicker
              docCode={docType.code}
              businessProfileId={activeBusinessId}
              groups={documentGroups}
              value={selectedGroupId}
              onChange={setSelectedGroupId}
              onGroupCreated={(group) => onGroupCreated?.(group)}
              disabled={uploading}
              tone="emerald"
            />
          )}

          {(selectedFiles.length === 0 || docType.multiple) && (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-black/15 bg-cb-cream/40 px-4 py-3 transition-colors hover:border-cb-mint hover:bg-cb-mint/5">
              <Upload className="h-4 w-4 shrink-0 text-cb-mint" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-cb-ink">
                  Choose a file
                </span>
                <span className="block text-[11px] text-cb-ink/45">
                  PDF, or a clear photo or screenshot. From your phone is fine.
                </span>
              </span>
              <input
                type="file"
                onChange={handleFileSelect}
                className="hidden"
                multiple={docType.multiple}
              />
            </label>
          )}

          {selectedFiles.length > 0 && (
            <div className="rounded-xl border border-black/[0.07] bg-white p-3">
              <div className="mb-3 space-y-1.5">
                {selectedFiles.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 rounded-lg bg-cb-cream/60 px-3 py-2"
                  >
                    <span className="truncate text-xs text-cb-ink/70">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeSelectedFile(idx)}
                      aria-label={`Remove ${file.name}`}
                      className="shrink-0 text-cb-ink/30 hover:text-cb-ink"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                onClick={handleUpload}
                disabled={uploading}
                className="w-full rounded-lg bg-cb-ink py-5 text-sm font-semibold text-cb-mint hover:bg-cb-ink/90"
              >
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </div>
          )}

          {relevantDocs.length > 0 && (
            <div className="space-y-1.5">
              {relevantDocs.map(doc => (
                <div
                  key={doc.id}
                  className="flex items-center gap-2 rounded-xl border border-black/[0.07] bg-white px-3 py-2"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-cb-ink/25" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-cb-ink">
                      {doc.custom_label || doc.name}
                    </p>
                    <p className="text-[10px] text-cb-ink/40">
                      {(doc.size / 1024).toFixed(0)} KB ·{" "}
                      {new Date(doc.upload_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => onPreview(doc)}
                      aria-label="View"
                      title="View"
                      className="rounded-md p-1.5 text-cb-ink/40 hover:bg-cb-cream hover:text-cb-ink"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(doc)}
                      aria-label="Rename"
                      title="Rename"
                      className="rounded-md p-1.5 text-cb-ink/40 hover:bg-cb-cream hover:text-cb-ink"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownload(doc)}
                      aria-label="Download"
                      title="Download"
                      className="rounded-md p-1.5 text-cb-ink/40 hover:bg-cb-cream hover:text-cb-ink"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(doc)}
                      aria-label="Delete"
                      title="Delete"
                      className="rounded-md p-1.5 text-cb-ink/40 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Vault({
  onChecklist,
  clientName,
  onLoad,
  activeBusinessId,
  activeDealId,
}: {
  onChecklist?: (info: ChecklistInfo & { isSubmitted: boolean }) => void;
  clientName: string | null;
  onLoad?: () => void;
  /** When provided, all doc requests / uploads / approvals are scoped to this business. */
  activeBusinessId?: string | null;
  /** The funding round being worked. Files and approvals belonging to a
   *  previous round drop out of the checklist, so a repeat client is asked for
   *  fresh statements instead of seeing last year's already ticked off. */
  activeDealId?: string | null;
}) {
  const supabase = createClient();
  const { toast } = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDynamic, setLoadingDynamic] = useState(true);
  const [approvals, setApprovals] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [dynamicDocs, setDynamicDocs] = useState<DocumentType[]>([]);
  const [preview_modal, set_preview_modal] = useState<{ isOpen: boolean; doc: UserDocument | null }>({
    isOpen: false,
    doc: null
  });
  const [renaming_file, set_renaming_file] = useState<{ id: string; label: string } | null>(null);
  const [is_renaming_loading, setIs_renaming_loading] = useState(false);
  // Filing groups for the business tab on screen, across every field. Reloads
  // on tab switch — business-scoped groups belong to one tab, and offering
  // another business's would be rejected by the upload path anyway.
  const { groups: documentGroups, addGroup: addDocumentGroup } = useDocumentGroups(activeBusinessId);

  useEffect(() => {
    // Wait for the parent to resolve which business tab is active before
    // hitting any of the doc endpoints. Otherwise an unfiltered fetch returns
    // dynamic-doc rows from EVERY business, producing duplicate React keys
    // (same doc_code seen twice — once per business) and a render crash.
    if (!activeBusinessId) return;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: vault } = await supabase.from("client_data_vault").select("id").eq("user_id", user.id).single();
      const vid = vault?.id || '';
      setVaultId(vid);

      await Promise.all([
        fetchDocuments(user.id),
        fetchDynamicRequirements(),
        fetchApprovals(vid)
      ]);
      setLoading(false);
      setLoadingDynamic(false);
    })();
  // Re-run when activeBusinessId changes so docs/approvals/requirements rescope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusinessId]);

  const fetchApprovals = async (vid: string) => {
    if (!vid) return;
    try {
      const { data, error } = await supabase
        .from("document_category_approvals")
        .select("doc_code, business_profile_id, funding_deal_id")
        .eq("client_vault_id", vid);
      if (error) throw error;
      // Scope to active business via the shared matcher — client-scoped doc
      // approvals (DL/PFS/MyScoreIQ) automatically surface on every tab — then
      // to the active round, so a closed financing's approvals don't make the
      // new round look already-satisfied.
      const filtered = (data || []).filter((d: any) =>
        matchesActiveBusiness(d.business_profile_id, activeBusinessId, d.doc_code) &&
        matchesActiveDeal(d.funding_deal_id, activeDealId)
      );
      setApprovals(new Set(filtered.map((d: any) => d.doc_code)));
    } catch (e) {
      console.error("fetchApprovals failed:", e);
    }
  };

  const fetchDynamicRequirements = async () => {
    try {
      const url = activeBusinessId
        ? `/api/vault/requirements?business_profile_id=${encodeURIComponent(activeBusinessId)}`
        : '/api/vault/requirements';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`requirements fetch failed: ${res.status}`);
      const data = await res.json();
      // Defensive dedupe by code. Strict business scoping already guarantees
      // uniqueness, but if a caller ever fetches without a business filter
      // (initial mount, debug, etc.) this keeps React's key check from blowing
      // up with duplicate doc_codes coming from sibling businesses.
      const raw: DocumentType[] = data.requirements || [];
      const seen = new Set<string>();
      const deduped: DocumentType[] = [];
      for (const d of raw) {
        if (seen.has(d.code)) continue;
        seen.add(d.code);
        deduped.push(d);
      }
      setDynamicDocs(deduped);
    } catch (e) {
      console.error("fetchDynamicRequirements failed:", e);
    }
  };

  const fetchDocuments = async (uid: string, silent = false) => {
    try {
      const { data, error } = await supabase
        .from("user_documents")
        .select("*, business_profile_id, doc_code, funding_deal_id")
        .eq("user_id", uid)
        .order("upload_date", { ascending: false });
      if (error) throw error;
      // Scope to active business via the shared matcher — client-scoped docs
      // (DL/PFS/MyScoreIQ) automatically surface on every tab regardless of
      // which business they were uploaded under — then to the active round.
      const filtered = (data || []).filter((d: any) =>
        matchesActiveBusiness(d.business_profile_id, activeBusinessId, d.doc_code || d.category) &&
        matchesActiveDeal(d.funding_deal_id, activeDealId)
      );
      setDocuments(filtered);
      const { data: v } = await supabase.from("client_data_vault").select("data_vault_submitted_at").eq("user_id", uid).maybeSingle();
      if (v?.data_vault_submitted_at) setIsSubmitted(true);
    } catch (e) {
      console.error("fetchDocuments failed:", e);
    }
  };

  const handleDelete = async (doc: UserDocument) => {
    // Storage object and row are removed together server-side; the browser has
    // no delete credential on the bucket any more.
    const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
    if (!res.ok) {
      console.error("Delete failed:", await res.text().catch(() => res.status));
      return;
    }
    setDocuments(prev => prev.filter(d => d.id !== doc.id));
  };

  // The route names the file (resolveServedFileName) and streams it, so the
  // whole blob-and-object-URL dance the browser used to do is gone along with
  // its direct storage access.
  const handleDownload = (doc: UserDocument) => {
    downloadDocument(doc.id);
  };

  const handleRenameSubmit = async (newLabel: string) => {
    if (!renaming_file || !newLabel.trim()) return;
    setIs_renaming_loading(true);
    try {
      const { error } = await supabase
        .from('user_documents')
        .update({ custom_label: newLabel.trim() })
        .eq('id', renaming_file.id);

      if (error) throw error;

      // Mark the name as hand-typed so filing this document into a group later
      // never rebuilds over it.
      await markLabelAsManual(supabase, renaming_file.id);

      toast({ title: 'Success', description: 'File renamed successfully' });
      setDocuments(prev => prev.map(d =>
        d.id === renaming_file.id ? { ...d, custom_label: newLabel.trim() } : d
      ));
      set_renaming_file(null);
    } catch (err: any) {
      toast({ title: 'Rename error', description: err.message, variant: 'destructive' });
    } finally {
      setIs_renaming_loading(false);
    }
  };

  const checklist = useMemo(() => {
    return dynamicDocs.map(r => {
      const docs = documents.filter(d => d.category === r.code || (d as any).doc_code === r.code);
      const count = docs.length;
      const isApproved = approvals.has(r.code);
      const isRejected = !isApproved && docs.some(d => d.status === 'rejected');
      
      // Robust extraction of rejection reason
      let rejectionReason = "";
      const rejectedDoc = docs.find(d => d.status === 'rejected');
      if (rejectedDoc?.metadata) {
        if (typeof rejectedDoc.metadata === 'string') {
           try {
             const meta = JSON.parse(rejectedDoc.metadata);
             rejectionReason = meta.rejection_reason || meta.reason || "";
           } catch {
             rejectionReason = rejectedDoc.metadata;
           }
        } else {
           rejectionReason = rejectedDoc.metadata.rejection_reason || rejectedDoc.metadata.reason || "";
        }
      }

      return { ...r, count, has: isApproved, isApproved, isRejected, rejectionReason, hasDocs: count >= (r.minFiles || 1) };
    });
  }, [dynamicDocs, documents, approvals]);

  const progressPct = useMemo(() => {
    const total = dynamicDocs.length;
    const have = checklist.filter(c => c.has).length;
    return total > 0 ? Math.round((have / total) * 100) : 0;
  }, [checklist, dynamicDocs]);

  const allComplete = checklist.every(c => c.has);

  // Trigger real-time toast for rejections on load
  useEffect(() => {
    if (!loading && !loadingDynamic && checklist.length > 0) {
      const rejectedItems = checklist.filter(c => c.isRejected);
      if (rejectedItems.length > 0) {
        const docNames = rejectedItems.map(item => item.label).join(", ");
        toast({
          title: "Action Required",
          description: `Your advisor requested updates for: ${docNames}. The rows in red are already open with their feedback.`,
          variant: "destructive"
        });
      }
    }
  }, [loading, loadingDynamic]); // Run once when loading completes

  useEffect(() => {
    if (!loading && !loadingDynamic) {
      onChecklist?.({ progress: progressPct, complete: allComplete, isSubmitted });
    }
  }, [progressPct, allComplete, isSubmitted, loading, loadingDynamic, onChecklist]);

  const handleSubmission = async () => {
    setSubmitting(true);
    await fetch("/api/vault/submit", { method: "POST" });
    setIsSubmitted(true);
    setSubmitting(false);
  };

  if (loading || loadingDynamic) return <PremiumLoader message="Syncing vault..." fullScreen={false} />;

  const coreDocs = checklist.filter(d => d.isCore);
  const addDocs = checklist.filter(d => !d.isCore);

  // The first row the client still has to act on. It is the one row that opens
  // on arrival, so the page answers "what do I do now?" without them clicking.
  // Rejected first — a file the advisor sent back outranks one never uploaded.
  const firstOpenCode =
    [...coreDocs, ...addDocs].find(d => d.isRejected)?.code ??
    [...coreDocs, ...addDocs].find(d => !d.isApproved && !d.isRejected)?.code ??
    null;

  const totalDocs = coreDocs.length + addDocs.length;
  const remaining = [...coreDocs, ...addDocs].filter(d => !d.isApproved).length;

  const renderSection = (label: string, docs: typeof coreDocs, tourFirst: boolean) => (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-cb-gray">
          {label}
        </h3>
        <span className="text-[11px] font-medium text-cb-ink/35">{docs.length}</span>
      </div>
      <div className="space-y-2">
        {docs.map((d, idx) => (
          <DocumentCard
            key={d.code}
            anchorId={tourFirst && idx === 0 ? 'tour-upload' : undefined}
            defaultOpen={d.code === firstOpenCode}
            docType={d}
            documents={documents}
            userId={userId || ""}
            clientName={clientName}
            activeBusinessId={activeBusinessId}
            activeDealId={activeDealId}
            onUploadComplete={() => fetchDocuments(userId || "", true)}
            onDelete={handleDelete}
            onEdit={d => set_renaming_file({ id: d.id, label: d.custom_label || d.name })}
            onToggleFavorite={() => {}}
            onDownload={handleDownload}
            onPreview={d => set_preview_modal({ isOpen: true, doc: d })}
            isApproved={d.isApproved}
            isRejected={d.isRejected}
            rejectionReason={d.rejectionReason}
            documentGroups={documentGroups}
            onGroupCreated={addDocumentGroup}
          />
        ))}
      </div>
    </section>
  );

  return (
    <div className="w-full space-y-5">
      {/* Progress header. Was a 300px gradient panel carrying a permanent
          three-step tutorial; the tutorial is now a disclosure, because a
          client who has uploaded once should not have to scroll past
          instructions they no longer read. */}
      <div id="tour-checklist" className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-manrope text-lg font-extrabold tracking-tight text-cb-ink">
              {allComplete
                ? "Everything is in"
                : remaining === 1
                  ? "1 document to go"
                  : `${remaining} documents to go`}
            </h2>
            <p className="mt-0.5 text-[13px] text-cb-ink/50">
              {allComplete
                ? "Nothing else is needed from you right now."
                : "Upload these and underwriting can move on your file."}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-manrope text-2xl font-extrabold leading-none text-cb-ink">
              {progressPct}%
            </div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-cb-gray">
              {totalDocs - remaining}/{totalDocs}
            </div>
          </div>
        </div>

        <Progress value={progressPct} className="mt-4 h-1.5" />

        {!allComplete && (
          <details className="group mt-4 border-t border-black/5 pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-cb-ink/50 hover:text-cb-ink">
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
              How do I upload a document?
            </summary>
            <ol className="mt-3 space-y-2 pl-5">
              {[
                'Click a document in the list below to open it.',
                'Choose the file from your device. A clear photo or screenshot of the page works too.',
                'Press Upload. Your advisor sees it right away — no email needed.',
              ].map((step, idx) => (
                <li key={idx} className="flex gap-2.5 text-[13px] leading-relaxed text-cb-ink/60">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-cb-mint/15 text-[10px] font-bold text-cb-ink">
                    {idx + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-3 pl-[26px] text-[12px] leading-relaxed text-cb-ink/40">
              A row turned <span className="font-semibold text-rose-500">red</span>? Your
              advisor left a note on it. Open it, read the feedback and upload a new file.
            </p>
          </details>
        )}

        {allComplete && !isSubmitted && (
          <div className="mt-4 flex flex-col gap-3 border-t border-black/5 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-cb-ink">
              <CheckCircle2 className="h-4 w-4 text-cb-mint" />
              Ready to send to underwriting.
            </p>
            <Button
              onClick={handleSubmission}
              disabled={submitting}
              className="rounded-lg bg-cb-ink px-5 py-5 text-sm font-semibold text-cb-mint hover:bg-cb-ink/90"
            >
              {submitting ? "Submitting…" : "Submit vault"}
            </Button>
          </div>
        )}
      </div>

      {coreDocs.length > 0 && renderSection("Required", coreDocs, true)}
      {addDocs.length > 0 &&
        renderSection("Also requested", addDocs, coreDocs.length === 0)}

      <DocumentPreviewModal
        isOpen={preview_modal.isOpen}
        onClose={() => set_preview_modal({ isOpen: false, doc: null })}
        docName={preview_modal.doc?.custom_label || preview_modal.doc?.name || ""}
        documentId={preview_modal.doc?.id || ""}
        fileType={preview_modal.doc?.type}
        onRename={preview_modal.doc ? () => set_renaming_file({
          id: preview_modal.doc!.id,
          label: preview_modal.doc!.custom_label || preview_modal.doc!.name,
        }) : undefined}
      />

      <Dialog open={!!renaming_file} onOpenChange={(open) => !open && set_renaming_file(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={renaming_file?.label || ''}
              onChange={(e) => set_renaming_file(prev => prev ? { ...prev, label: e.target.value } : null)}
              placeholder="Enter new file name..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit(renaming_file?.label || '');
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => set_renaming_file(null)} disabled={is_renaming_loading}>Cancel</Button>
            <Button onClick={() => handleRenameSubmit(renaming_file?.label || '')} disabled={is_renaming_loading || !renaming_file?.label.trim()} className="bg-emerald-600 text-white">
              {is_renaming_loading ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
