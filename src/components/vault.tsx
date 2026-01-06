"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import clsx from "clsx";
import {
  Upload, Trash2, Star, Download, FileText, Pencil, CheckCircle2, AlertCircle, X
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { PremiumLoader } from "./ui/premium-loader";
import { Send } from "lucide-react";

/**
 * REQUIRED_DOCS: Core 9 documents that ALL clients must upload
 * These are always required regardless of GHL tags
 */
const REQUIRED_DOCS = [
  {
    code: "business_bank_statements",
    label: "Bank Statements (last 6 months)",
    multiple: true,
    maxFiles: 12,
    isCore: true
  },
  {
    code: "drivers_license",
    label: "Driver's License (Front & Back)",
    multiple: true,
    minFiles: 2,
    maxFiles: 2,
    legacyCodes: ["drivers_license_front", "drivers_license_back"],
    isCore: true
  },
  {
    code: "voided_check", label: "Voided Business Check",
    multiple: true,
    maxFiles: 12,
    isCore: true
  },
  {
    code: "balance_sheets", label: "Balance Sheets",
    multiple: true,
    maxFiles: 12,
    isCore: true
  },
  {
    code: "profit_loss", label: "Profit & Loss",
    multiple: true,
    maxFiles: 12,
    isCore: true
  },
  {
    code: "tax_returns", label: "Tax Returns",
    multiple: true,
    maxFiles: 12,
    isCore: true
  },
  { code: "funding_application", label: "Funding Application", isCore: true },
  { code: "ar_report", label: "A/R Report", isCore: true },
  {
    code: "debt_schedule", label: "Debt Schedule",
    multiple: true,
    maxFiles: 12,
    isCore: true
  },
] as const;

/**
 * DocumentType: Interface for both core and dynamic documents
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

type RequiredCode = typeof REQUIRED_DOCS[number]["code"];

/**
 * UserDocument: Interface for documents stored in the database
 * Includes metadata like tags for advisor/underwriting categorization
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
}

type ChecklistInfo = { progress: number; complete: boolean };

/**
 * DocumentCard: Individual card component for each document type
 * Handles file selection, upload, and display of uploaded files for a specific document type
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
}

function DocumentCard({
  docType,
  documents,
  userId,
  onUploadComplete,
  onDelete,
  onEdit,
  onToggleFavorite,
  onDownload
}: DocumentCardProps) {
  const supabase = createClient();
  const { toast } = useToast();

  // State for handling file selection and upload
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [customName, setCustomName] = useState("");

  /**
   * Filter documents to only show those matching this card's document type
   * Includes support for legacy codes (e.g. old driver's license front/back)
   */
  const relevantDocs = documents.filter(doc =>
    doc.category === docType.code ||
    //@ts-ignore - legacyCodes might not exist on all types
    docType.legacyCodes?.includes(doc.category)
  );

  const hasDocuments = relevantDocs.length > 0;
  //@ts-ignore
  const isComplete = hasDocuments && relevantDocs.length >= (docType.minFiles || 1);

  /**
   * handleFileSelect: Triggered when user selects files
   * Enforces maxFiles limit
   */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const newFiles = Array.from(e.target.files);

    //@ts-ignore
    const max = docType.maxFiles || 1;
    //@ts-ignore
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
      setCustomName(""); // Disable custom name for batch
    }
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  /**
   * handleUpload: Uploads all selected files
   */
  const handleUpload = async () => {
    if (selectedFiles.length === 0 || !userId) return;

    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const file of selectedFiles) {
        try {
          // Generate unique filename
          const ext = file.name.split(".").pop() || "bin";
          const normalized = `${docType.code}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`;
          const filePath = `${userId}/${normalized}`;

          // Upload file
          const { error: upErr } = await supabase.storage
            .from("user-documents")
            .upload(filePath, file, { upsert: true });
          if (upErr) throw upErr;

          // Create database record
          const { data, error: dbErr } = await supabase
            .from("user_documents")
            .insert({
              user_id: userId,
              name: file.name,
              size: file.size,
              type: file.type,
              storage_path: filePath,
              category: docType.code,
              // Use custom name only if single file and specified, otherwise filename
              custom_label: (selectedFiles.length === 1 && customName) ? customName : file.name,
              metadata: { tags: [docType.code] },
            })
            .select("*")
            .single();
          if (dbErr) throw dbErr;

          // Optional: Notify backend
          try {
            await fetch("/api/uploads", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                document_id: data.id,
                storage_path: data.storage_path,
                doc_code: docType.code
              }),
            });
          } catch (apiError) {
            console.error("API notification failed:", apiError);
          }

          // Add submitted tag to GHL for dynamic documents
          if (!docType.isCore) {
            try {
              await fetch("/api/vault/mark-submitted", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ doc_code: docType.code }),
              });
            } catch (ghlError) {
              console.error("Failed to update GHL tag:", ghlError);
            }
          }

          successCount++;
        } catch (err) {
          console.error("Error uploading file:", file.name, err);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast({
          title: "Upload complete",
          description: `Successfully uploaded ${successCount} file(s).${failCount > 0 ? ` Failed: ${failCount}` : ""}`
        });
        setSelectedFiles([]);
        setCustomName("");
        onUploadComplete();
      } else {
        throw new Error("Failed to upload files");
      }

    } catch (err: any) {
      toast({
        title: "Upload error",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };

  /**
   * clearSelection: Removes the selected file without uploading
   * Allows user to change their mind before submitting
   */
  const clearSelection = () => {
    setSelectedFiles([]);
    setCustomName("");
  };

  return (
    <div className={clsx(
      "border rounded-xl p-6 transition-all",
      isComplete ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-200"
    )}>
      {/* Card Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {isComplete ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-6 w-6 text-gray-400 flex-shrink-0" />
          )}
          <div>
            <h3 className="font-semibold text-gray-900">{docType.label}</h3>
            <p className="text-sm text-gray-600">
              {relevantDocs.length} file(s) uploaded
              {/* @ts-ignore */}
              {docType.minFiles && docType.minFiles > 1 && ` (Min: ${docType.minFiles})`}
            </p>
          </div>
        </div>
      </div>

      {/* Upload Area */}
      {/* @ts-ignore */}
      {(selectedFiles.length === 0 || docType.multiple) && (
        <div className="mb-4">
          <label className={clsx(
            "flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition",
            isComplete
              ? "border-emerald-300 bg-white hover:bg-emerald-50"
              : "border-gray-300 bg-gray-50 hover:bg-gray-100"
          )}>
            <Upload className={clsx(
              "h-8 w-8 mb-2",
              isComplete ? "text-emerald-600" : "text-gray-400"
            )} />
            <span className="text-sm font-medium text-gray-700">
              Click to upload {docType.label}
            </span>
            <span className="text-xs text-gray-500 mt-1">
              {/* @ts-ignore */}
              {docType.multiple ? `Up to ${docType.maxFiles} files` : "Single file"} supported
            </span>
            <input
              type="file"
              onChange={handleFileSelect}
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
              // @ts-ignore
              multiple={docType.multiple}
            />
          </label>
        </div>
      )}

      {/* Selected Files Preview (Before Upload) */}
      {selectedFiles.length > 0 && (
        <div className="mb-4 bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Selected for Upload:</h4>
          <div className="space-y-2 mb-3">
            {selectedFiles.map((file, idx) => (
              <div key={idx} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                <div className="flex items-center gap-2 overflow-hidden">
                  <FileText className="h-4 w-4 text-blue-600 flex-shrink-0" />
                  <span className="text-sm text-gray-700 truncate">{file.name}</span>
                  <span className="text-xs text-gray-500">({(file.size / 1024).toFixed(0)} KB)</span>
                </div>
                <button
                  onClick={() => removeSelectedFile(idx)}
                  className="text-gray-400 hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Custom Name Input (Only for single file) */}
          {selectedFiles.length === 1 && (
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Custom file name (optional)"
              className="mb-3"
            />
          )}

          <Button
            onClick={handleUpload}
            disabled={uploading}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            {uploading ? (
              <>
                <Upload className="h-4 w-4 mr-2 animate-pulse" />
                Uploading {selectedFiles.length} file(s)...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload {selectedFiles.length} File(s)
              </>
            )}
          </Button>
        </div>
      )}

      {/* Uploaded Documents List */}
      {relevantDocs.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            Uploaded Files:
          </h4>
          {relevantDocs.map((doc) => (
            <div
              key={doc.id}
              className="bg-white border border-gray-200 rounded-lg p-3"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {doc.custom_label || doc.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {(doc.size / 1024).toFixed(1)} KB ΓÇó
                    Uploaded {new Date(doc.upload_date).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={() => onToggleFavorite(doc)}>
                  <Star className={clsx(
                    "h-5 w-5",
                    doc.is_favorite
                      ? "text-yellow-500 fill-yellow-500"
                      : "text-gray-400"
                  )} />
                </button>
              </div>

              {doc.tags && doc.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {doc.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => onDownload(doc)}
                  className="flex-1 py-1.5 text-xs font-medium text-emerald-600 border border-emerald-200 rounded hover:bg-emerald-50 transition"
                >
                  <Download className="inline h-3 w-3 mr-1" />
                  Download
                </button>
                <button
                  onClick={() => onEdit(doc)}
                  className="flex-1 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded hover:bg-blue-50 transition"
                >
                  <Pencil className="inline h-3 w-3 mr-1" />
                  Edit
                </button>
                <button
                  onClick={() => onDelete(doc)}
                  className="flex-1 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50 transition"
                >
                  <Trash2 className="inline h-3 w-3 mr-1" />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Main Vault Component: Manages all client documents
 * Displays individual cards for each required document type
 */
export default function Vault({ onChecklist }: { onChecklist?: (info: ChecklistInfo) => void }) {
  const supabase = createClient();
  const { toast } = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editDoc, setEditDoc] = useState<UserDocument | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Dynamic documents state
  const [dynamicDocs, setDynamicDocs] = useState<DocumentType[]>([]);
  const [loadingDynamic, setLoadingDynamic] = useState(true);

  /**
   * handleSubmission: Submits the vault and tags the user in GHL
   */
  const handleSubmission = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/vault/submit", {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to submit vault");

      toast({
        title: "Vault Submitted",
        description: "Your documents have been submitted successfully.",
      });
      setIsSubmitted(true);
    } catch (error: any) {
      toast({
        title: "Submission Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Initialize component: Get authenticated user and fetch their documents
   */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      await fetchDocuments(user.id);
      await fetchDynamicRequirements();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * fetchDynamicRequirements: Fetches ALL document requirements from API
   * This includes both core documents and dynamic documents requested via GHL tags
   */
  const fetchDynamicRequirements = async () => {
    try {
      console.log('🔄 Fetching dynamic document requirements...');
      const res = await fetch('/api/vault/requirements');
      if (!res.ok) throw new Error('Failed to fetch requirements');

      const data = await res.json();
      console.log('📥 Received requirements data:', {
        coreCount: data.coreCount,
        dynamicCount: data.dynamicCount,
        totalRequirements: data.requirements?.length,
        requirements: data.requirements
      });

      // Use ALL requirements from API (both core and dynamic)
      const allDocs = (data.requirements || []).map((doc: any) => ({
        code: doc.code,
        label: doc.label,
        multiple: doc.multiple,
        minFiles: doc.minFiles,
        maxFiles: doc.maxFiles,
        isCore: doc.isCore,
        ghlTag: doc.ghlTag,
      }));

      console.log('✅ Using API requirements:', {
        count: allDocs.length,
        coreCount: allDocs.filter((d: any) => d.isCore).length,
        dynamicCount: allDocs.filter((d: any) => !d.isCore).length,
        documents: allDocs.map((d: any) => ({ code: d.code, label: d.label, isCore: d.isCore }))
      });

      setDynamicDocs(allDocs);
    } catch (error: any) {
      console.error('❌ Failed to load dynamic documents:', error);
      toast({
        title: "Warning",
        description: "Could not load document requirements. Please refresh the page.",
        variant: "default"
      });
      // Set empty array on error instead of using hardcoded fallback
      setDynamicDocs([]);
    } finally {
      setLoadingDynamic(false);
    }
  };

  /**
   * fetchDocuments: Retrieves all documents for the authenticated user
   * Maps database metadata to include tags array for easier manipulation
   */
  const fetchDocuments = async (uid: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_documents")
        .select("*")
        .eq("user_id", uid)
        .order("upload_date", { ascending: false });
      if (error) throw error;

      // Map documents and extract tags from metadata
      const mapped = (data || []).map((d: any) => ({
        ...d,
        tags: Array.isArray(d?.metadata?.tags) ? d.metadata.tags : [],
      })) as UserDocument[];

      setDocuments(mapped);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  /**
   * confirmEdit: Updates document metadata (name, category, tags)
   * Advisors/underwriting can add tags for categorization and workflow management
   */
  const confirmEdit = async () => {
    if (!editDoc) return;
    try {
      const { error } = await supabase
        .from("user_documents")
        .update({
          custom_label: editDoc.custom_label,
          category: editDoc.category,
          metadata: { tags: editDoc.tags ?? [] },
        })
        .eq("id", editDoc.id);
      if (error) throw error;

      setDocuments((prev) =>
        prev.map((d) => (d.id === editDoc.id ? editDoc : d))
      );
      setEditDoc(null);
      toast({
        title: "Updated",
        description: "Document updated successfully."
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    }
  };

  /**
   * toggleFavorite: Marks/unmarks a document as favorite
   * Useful for quickly accessing important documents
   */
  const toggleFavorite = async (doc: UserDocument) => {
    try {
      const { error } = await supabase
        .from("user_documents")
        .update({ is_favorite: !doc.is_favorite })
        .eq("id", doc.id);
      if (error) throw error;

      setDocuments((prev) =>
        prev.map((d) =>
          d.id === doc.id ? { ...d, is_favorite: !doc.is_favorite } : d
        )
      );
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    }
  };

  /**
   * handleDelete: Removes document from storage and database
   * Permanently deletes the file
   */
  const handleDelete = async (doc: UserDocument) => {
    try {
      // Delete from storage bucket
      await supabase.storage
        .from("user-documents")
        .remove([doc.storage_path]);

      // Delete database record
      await supabase
        .from("user_documents")
        .delete()
        .eq("id", doc.id);

      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      toast({
        title: "Deleted",
        description: `${doc.custom_label || doc.name} removed.`
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    }
  };

  /**
   * handleDownload: Downloads a document from Supabase storage
   * Creates a temporary download link and triggers download
   */
  const handleDownload = async (doc: UserDocument) => {
    try {
      const { data, error } = await supabase.storage
        .from("user-documents")
        .download(doc.storage_path);
      if (error) throw error;

      // Create blob URL and trigger download
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({
        title: "Download error",
        description: err.message,
        variant: "destructive"
      });
    }
  };

  /**
   * uploadedByCode: Map of document codes to count of uploaded documents
   * Used for checklist progress calculation
   */
  const uploadedByCode = useMemo(() => {
    const map = new Map<string, number>();
    documents.forEach((doc) => {
      if (doc.category) {
        map.set(doc.category, (map.get(doc.category) || 0) + 1);
      }
    });
    return map;
  }, [documents]);

  /**
   * allRequiredDocs: All documents from API (core + dynamic)
   * Previously merged hardcoded REQUIRED_DOCS with API data, now uses only API
   */
  const allRequiredDocs = useMemo(() => {
    return dynamicDocs as DocumentType[];
  }, [dynamicDocs]);

  /**
   * checklist: Array showing status of each required document (core + dynamic)
   * Includes count of uploaded files for each document type
   */
  const checklist = useMemo(() => {
    return allRequiredDocs.map((r) => {
      // @ts-ignore
      const legacyCount = r.legacyCodes?.reduce((acc, code) => acc + (uploadedByCode.get(code) || 0), 0) || 0;
      const count = (uploadedByCode.get(r.code) || 0) + legacyCount;
      // @ts-ignore
      const minRequired = r.minFiles || 1;

      return {
        ...r,
        count,
        has: count >= minRequired,
      };
    });
  }, [allRequiredDocs, uploadedByCode]);

  /**
   * progressPct: Percentage of required documents that have been uploaded
   * Used for progress bar and dashboard notifications
   * Includes both core documents and dynamic documents requested via GHL tags
   */
  const progressPct = useMemo(() => {
    const total = allRequiredDocs.length;
    const have = checklist.filter((c) => c.has).length;
    return total > 0 ? Math.round((have / total) * 100) : 0;
  }, [checklist, allRequiredDocs]);

  const allComplete = checklist.every((c) => c.has);

  /**
   * Notify parent component (dashboard) of checklist progress
   * Allows dashboard to show overall completion status
   */
  useEffect(() => {
    onChecklist?.({ progress: progressPct, complete: allComplete });
  }, [progressPct, allComplete, onChecklist]);

  if (loading || loadingDynamic) {
    return <PremiumLoader message="Syncing your document vault..." fullScreen={false} />;
  }

  return (
    <div className="w-full space-y-8">
      {/* Progress Overview - Shows overall completion status */}
      <div className="bg-gradient-to-br from-emerald-50 to-blue-50 border border-emerald-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Document Checklist
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Upload all required documents to complete your application
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-emerald-600">
              {progressPct}%
            </div>
            <div className="text-sm text-gray-600">Complete</div>
          </div>
        </div>
        <Progress value={progressPct} className="h-3" />
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-600">
            {checklist.filter(c => c.has).length} of {allRequiredDocs.length} documents uploaded
          </span>
          {allComplete && (
            <span className="flex items-center gap-2 text-emerald-600 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              All documents complete
            </span>
          )}
        </div>

        {allComplete && !isSubmitted && (
          <div className="mt-6 flex justify-end">
            <Button
              onClick={handleSubmission}
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? (
                <>Submitting...</>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Submit Vault
                </>
              )}
            </Button>
          </div>
        )}

        {isSubmitted && (
          <div className="mt-4 p-4 bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-800">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Vault Submitted Successfully!</span>
          </div>
        )}
      </div>

      {/* Document Cards Grid - Core 9 + Dynamic documents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loadingDynamic ? (
          <div className="col-span-2 text-center py-8">
            <p className="text-gray-500">Loading document requirements...</p>
          </div>
        ) : (
          allRequiredDocs.map((docType) => (
            <DocumentCard
              key={docType.code}
              docType={docType}
              documents={documents}
              userId={userId || ""}
              onUploadComplete={() => fetchDocuments(userId || "", true)}
              onDelete={handleDelete}
              onEdit={setEditDoc}
              onToggleFavorite={toggleFavorite}
              onDownload={handleDownload}
            />
          ))
        )}
      </div>

      {/* Edit Document Modal - Allows editing of document metadata and tags */}
      <Dialog open={!!editDoc} onOpenChange={() => setEditDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Document</DialogTitle>
          </DialogHeader>
          {editDoc && (
            <div className="space-y-4">
              {/* Custom Label Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Document Name
                </label>
                <Input
                  value={editDoc.custom_label || ""}
                  onChange={(e) => setEditDoc({
                    ...editDoc,
                    custom_label: e.target.value
                  })}
                  placeholder="Enter custom name"
                />
              </div>

              {/* Tags Input - Important for advisor/underwriting workflow */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tags (comma separated)
                </label>
                <Input
                  value={editDoc.tags?.join(", ") || ""}
                  onChange={(e) => setEditDoc({
                    ...editDoc,
                    tags: e.target.value
                      .split(",")
                      .map(t => t.trim())
                      .filter(Boolean)
                  })}
                  placeholder="e.g., verified, reviewed, needs-attention"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Add tags for categorization and workflow management
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDoc(null)}
            >
              Cancel
            </Button>
            <Button onClick={confirmEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
