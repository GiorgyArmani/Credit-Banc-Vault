"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import clsx from "clsx";
import {
  Upload, Trash2, Star, Download, FileText, Pencil, CheckCircle2, AlertCircle, X, ChevronDown, ChevronRight, Eye, MoreVertical
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { PremiumLoader } from "./ui/premium-loader";
import { Send } from "lucide-react";
import DocumentPreviewModal from "@/components/pdf/pdf-viewer";
import { isClientScopedDoc, isCarryOverDoc, matchesActiveBusiness, matchesActiveDeal } from "@/lib/document-scope";

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
}: DocumentCardProps) {
  const supabase = createClient();
  const { toast } = useToast();

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [customName, setCustomName] = useState("");

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

  const [isExpanded, setIsExpanded] = useState(!isApproved || isRejected || !isComplete);

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
    try {
      for (const file of selectedFiles) {
        const ext = file.name.split(".").pop() || "bin";
        const standardizedName = `${docType.label} - ${clientName || "Client"}`;
        const normalized = `${docType.code}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`;
        const filePath = `${userId}/${normalized}`;

        const { error: upErr } = await supabase.storage
          .from("user-documents")
          .upload(filePath, file, { upsert: true });
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
            metadata: { tags: [docType.code] },
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

  return (
    <div id={anchorId} className={clsx(
      "rounded-[2.5rem] border-2 transition-all duration-500 overflow-hidden shadow-sm group",
      isApproved
        ? "bg-emerald-50/30 border-emerald-100/50 hover:border-emerald-200"
        : isRejected
          ? "bg-rose-50/30 border-rose-100/50 hover:border-rose-200"
          : isReadyForReview
            ? "bg-amber-50/30 border-amber-100/50 hover:border-amber-200"
            : "bg-white border-emerald-50 hover:border-emerald-100 hover:shadow-md"
    )}>
      <div
        className="p-8 cursor-pointer flex items-center justify-between gap-4"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-5">
          <div className={clsx(
            "w-14 h-14 rounded-2xl flex items-center justify-center shadow-inner transition-all duration-500",
            isApproved
              ? "bg-emerald-500 text-white scale-110"
              : isRejected
                ? "bg-rose-500 text-white"
                : isReadyForReview
                  ? "bg-amber-500 text-white"
                  : "bg-emerald-50 text-emerald-500 group-hover:scale-105"
          )}>
            {isApproved ? <CheckCircle2 className="h-7 w-7" /> :
              isRejected ? <AlertCircle className="h-7 w-7" /> :
                isReadyForReview ? <AlertCircle className="h-7 w-7" /> : <FileText className="h-7 w-7" />}
          </div>
          <div>
            <h3 className="text-xl font-black text-emerald-950 tracking-tighter uppercase leading-none">
              {docType.label}
            </h3>
            <div className="flex items-center gap-2 mt-2">
              <span className={clsx(
                "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border",
                isApproved
                  ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                  : isRejected
                    ? "bg-rose-100 text-rose-700 border-rose-200"
                    : isReadyForReview
                      ? "bg-amber-100 text-amber-700 border-amber-200"
                      : "bg-slate-100 text-slate-500 border-slate-200"
              )}>
                {isApproved ? "Approved" : 
                 isRejected ? "Action Required" : 
                 isReadyForReview ? "Ready for Review" : "Awaiting Upload"}
              </span>
              {/* Rejection reason moved to expanded area or more prominent block */}
              {relevantDocs.length > 0 && (
                <span className="text-[10px] font-bold text-emerald-900/40 uppercase tracking-widest flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-emerald-900/20" />
                  {relevantDocs.length} File{relevantDocs.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isExpanded && (isApproved || isRejected || isReadyForReview) && (
            <span className={clsx(
              "hidden md:flex text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border",
              isApproved 
                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                : isRejected
                  ? "bg-rose-100 text-rose-700 border-rose-200"
                  : "bg-amber-100 text-amber-700 border-amber-200"
            )}>
              {isApproved ? "Approved" : isRejected ? "Action Req." : "Reviewing"}
            </span>
          )}
          <div className={clsx(
            "w-8 h-8 rounded-full flex items-center justify-center transition-all",
            isExpanded ? "bg-emerald-100 text-emerald-600 rotate-180" : "bg-slate-50 text-slate-400"
          )}>
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="px-8 pb-8 space-y-6 animate-in slide-in-from-top-2 duration-300">
          {/* Prominent Rejection Feedback */}
          {isRejected && rejectionReason && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 relative overflow-hidden group/feedback animate-pulse">
              <div className="absolute top-0 left-0 w-1 h-full bg-rose-500" />
              <div className="flex items-start gap-4">
                <div className="mt-1 bg-rose-100 p-2 rounded-xl text-rose-600">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-rose-900 mb-1">Action Required: Advisor Feedback</h4>
                  <p className="text-sm text-rose-700 leading-relaxed">
                    "{rejectionReason}"
                  </p>
                  <p className="mt-4 text-[11px] font-medium text-rose-500/80 uppercase tracking-wider">
                    Please upload a replacement file below to resolve this.
                  </p>
                </div>
              </div>
            </div>
          )}
          {(selectedFiles.length === 0 || docType.multiple) && (
            <div className="pt-2">
              <label className={clsx(
                "flex flex-col items-center justify-center border-2 border-dashed rounded-[1.5rem] p-8 cursor-pointer transition-all group/upload",
                isComplete ? "border-emerald-200 bg-white" : "border-emerald-100 bg-emerald-50/10"
              )}>
                <Upload className="h-6 w-6 text-emerald-500 mb-2" />
                <span className="text-sm font-bold text-emerald-950">Click to upload</span>
                <span className="text-xs text-emerald-900/50 mt-1 text-center">Choose a file from your device. A clear photo or PDF of the document is fine.</span>
                <input type="file" onChange={handleFileSelect} className="hidden" multiple={docType.multiple} />
              </label>
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="bg-white border border-emerald-100 rounded-xl p-4">
              <div className="space-y-2 mb-4">
                {selectedFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-emerald-50/50 p-2 rounded-lg text-xs">
                    <span className="truncate flex-1 pr-2">{file.name}</span>
                    <button onClick={() => removeSelectedFile(idx)}><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
              <Button onClick={handleUpload} disabled={uploading} className="w-full bg-emerald-500 text-white rounded-full">
                {uploading ? "Uploading..." : "Start Upload"}
              </Button>
            </div>
          )}

          {relevantDocs.length > 0 && (
            <div className="space-y-2 pt-4 border-t border-emerald-100/50">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-900/40">Uploaded Files</h4>
              {relevantDocs.map(doc => (
                <div key={doc.id} className="bg-white border border-emerald-100 rounded-xl p-3 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold truncate">{doc.custom_label || doc.name}</p>
                    <p className="text-[9px] text-gray-400">{(doc.size/1024).toFixed(0)} KB • {new Date(doc.upload_date).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => onPreview(doc)} className="h-7 px-2 text-[10px]">View</Button>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(doc)} className="h-7 px-2 text-[10px]">Rename</Button>
                    <Button variant="ghost" size="sm" onClick={() => onDownload(doc)} className="h-7 px-2 text-[10px]">Download</Button>
                    <Button variant="ghost" size="sm" onClick={() => onDelete(doc)} className="h-7 px-2 text-[10px] text-rose-500">Delete</Button>
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
  const [expandedCore, setExpandedCore] = useState(true);
  const [expandedAdditional, setExpandedAdditional] = useState(true);
  const [preview_modal, set_preview_modal] = useState<{ isOpen: boolean; doc: UserDocument | null }>({
    isOpen: false,
    doc: null
  });
  const [renaming_file, set_renaming_file] = useState<{ id: string; label: string } | null>(null);
  const [is_renaming_loading, setIs_renaming_loading] = useState(false);

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
    await supabase.storage.from("user-documents").remove([doc.storage_path]);
    await supabase.from("user_documents").delete().eq("id", doc.id);
    setDocuments(prev => prev.filter(d => d.id !== doc.id));
  };

  const handleDownload = async (doc: UserDocument) => {
    const { data } = await supabase.storage.from("user-documents").download(doc.storage_path);
    if (!data) return;
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    let downloadName = doc.name;
    if (doc.custom_label) {
      const extIndex = doc.name.lastIndexOf('.');
      const extension = extIndex !== -1 ? doc.name.substring(extIndex) : '';
      if (extension && !doc.custom_label.toLowerCase().endsWith(extension.toLowerCase())) {
        downloadName = doc.custom_label + extension;
      } else {
        downloadName = doc.custom_label;
      }
    }
    a.download = downloadName;
    a.click();
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
          description: `Your advisor requested updates for: ${docNames}. Please check the cards with red badges for feedback.`,
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

  return (
    <div className="w-full space-y-8">
      <div id="tour-checklist" className="bg-gradient-to-br from-emerald-50 to-blue-50 border border-emerald-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Document Checklist</h2>
            <p className="text-sm text-gray-600 mt-1">Upload required documents to move forward with underwriting.</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-emerald-600">{progressPct}%</div>
            <div className="text-xs text-gray-500 uppercase font-bold tracking-widest">Progress</div>
          </div>
        </div>
        <Progress value={progressPct} className="h-3" />

        {/* Always-on "how to upload" guide. A tour is momentary; this stays on
            screen so a confused client never has to remember the steps. Hidden
            once everything is uploaded to avoid clutter. */}
        {!allComplete && (
          <div className="mt-5 rounded-2xl bg-white/80 border border-emerald-100 p-5">
            <p className="text-sm font-bold text-emerald-900 mb-3 flex items-center gap-2">
              <Upload className="h-4 w-4 text-emerald-600" />
              How to upload a document (about 30 seconds):
            </p>
            <ol className="space-y-2.5">
              {[
                'Find a document in the list below and click it to open.',
                'Tap “Click to upload” and choose the file from your device. A clear photo or screenshot of the page works too.',
                'Press “Start Upload”. That’s it. Your advisor sees it right away, no email needed.',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-gray-500 mt-3 pl-9">
              A card turned <span className="font-semibold text-rose-500">red</span>? Your advisor left a note. Open it, read the feedback, and upload a new file. Stuck on anything? Message your advisor above.
            </p>
          </div>
        )}

        {allComplete && !isSubmitted && (
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm font-bold text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              All documents are in! Tap “Submit Vault” to send everything to underwriting.
            </p>
            <Button onClick={handleSubmission} disabled={submitting} className="bg-emerald-600 text-white">
              {submitting ? "Submitting..." : "Submit Vault"}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-8">
        {coreDocs.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-px flex-1 bg-emerald-100" />
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-emerald-900/40">Core Requirements</h3>
              <div className="h-px flex-1 bg-emerald-100" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {coreDocs.map((d, idx) => (
                <DocumentCard
                  key={d.code}
                  anchorId={idx === 0 ? 'tour-upload' : undefined}
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
                />
              ))}
            </div>
          </div>
        )}

        {addDocs.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-px flex-1 bg-blue-100" />
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-blue-900/40">Additional Requests</h3>
              <div className="h-px flex-1 bg-blue-100" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {addDocs.map((d, idx) => (
                <DocumentCard
                  key={d.code}
                  anchorId={coreDocs.length === 0 && idx === 0 ? 'tour-upload' : undefined}
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
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <DocumentPreviewModal
        isOpen={preview_modal.isOpen}
        onClose={() => set_preview_modal({ isOpen: false, doc: null })}
        docName={preview_modal.doc?.custom_label || preview_modal.doc?.name || ""}
        storagePath={preview_modal.doc?.storage_path || ""}
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
