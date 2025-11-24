// src/components/vault/vault.tsx
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

/**
 * REQUIRED_DOCS: Array of document types that clients must upload
 * Each document type will have its own card with upload functionality
 */
const REQUIRED_DOCS = [
  { code: "bank_statements_6mo", label: "Bank Statements (last 6 months)" },
  { code: "drivers_license_front", label: "Driver's License — Front" },
  { code: "drivers_license_back", label: "Driver's License — Back" },
  { code: "voided_check", label: "Voided Business Check" },
  { code: "balance_sheets", label: "Balance Sheets" },
  { code: "profit_loss", label: "Profit & Loss" },
  { code: "tax_returns", label: "Tax Returns" },
] as const;
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
  docType: typeof REQUIRED_DOCS[number];
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

  // State for handling file selection and upload for this specific document type
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [customName, setCustomName] = useState("");

  /**
   * Filter documents to only show those matching this card's document type
   * This allows multiple versions of the same document type
   */
  const relevantDocs = documents.filter(doc => doc.category === docType.code);
  const hasDocuments = relevantDocs.length > 0;

  /**
   * handleFileSelect: Triggered when user selects a file for this document type
   * Pre-fills the custom name with the original filename (without extension)
   */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setSelectedFile(file);
    // Pre-fill custom name with filename without extension
    setCustomName(file.name.replace(/\.[^.]+$/, ""));
  };

  /**
   * handleUpload: Uploads the selected file to Supabase storage and creates database record
   * Each document is stored with the document type code as a prefix for organization
   */
  const handleUpload = async () => {
    if (!selectedFile || !userId) return;

    setUploading(true);
    try {
      // Generate unique filename with document type prefix
      const ext = selectedFile.name.split(".").pop() || "bin";
      const normalized = `${docType.code}-${Date.now()}.${ext}`;
      const filePath = `${userId}/${normalized}`;

      // Upload file to Supabase storage bucket
      const { error: upErr } = await supabase.storage
        .from("user-documents")
        .upload(filePath, selectedFile);
      if (upErr) throw upErr;

      // Create database record with document metadata
      const { data, error: dbErr } = await supabase
        .from("user_documents")
        .insert({
          user_id: userId,
          name: selectedFile.name,
          size: selectedFile.size,
          type: selectedFile.type,
          storage_path: filePath,
          category: docType.code, // Links this document to its type
          custom_label: customName || selectedFile.name,
          metadata: { tags: [docType.code] }, // Initial tag is the document type
        })
        .select("*")
        .single();
      if (dbErr) throw dbErr;

      // Optional: Notify backend API about the upload (for workflows, notifications, etc.)
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
        // API notification is optional, don't block on errors
        console.error("API notification failed:", apiError);
      }

      toast({
        title: "Success",
        description: `${docType.label} uploaded successfully.`
      });

      // Reset form state
      setSelectedFile(null);
      setCustomName("");
      onUploadComplete();
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
    setSelectedFile(null);
    setCustomName("");
  };

  return (
    <div className={clsx(
      "border rounded-xl p-6 transition-all",
      hasDocuments ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-200"
    )}>
      {/* Card Header - Shows document type and status */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {hasDocuments ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-6 w-6 text-gray-400 flex-shrink-0" />
          )}
          <div>
            <h3 className="font-semibold text-gray-900">{docType.label}</h3>
            <p className="text-sm text-gray-600">
              {hasDocuments ? `${relevantDocs.length} file(s) uploaded` : "Not uploaded yet"}
            </p>
          </div>
        </div>
      </div>

      {/* Upload Area - Shows when no file is selected */}
      {!selectedFile && (
        <div className="mb-4">
          <label className={clsx(
            "flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition",
            hasDocuments
              ? "border-emerald-300 bg-white hover:bg-emerald-50"
              : "border-gray-300 bg-gray-50 hover:bg-gray-100"
          )}>
            <Upload className={clsx(
              "h-8 w-8 mb-2",
              hasDocuments ? "text-emerald-600" : "text-gray-400"
            )} />
            <span className="text-sm font-medium text-gray-700">
              Click to upload {docType.label}
            </span>
            <span className="text-xs text-gray-500 mt-1">
              PDF, images, or documents
            </span>
            <input
              type="file"
              onChange={handleFileSelect}
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
            />
          </label>
        </div>
      )}

      {/* File Preview - Shows when a file is selected but not yet uploaded */}
      {selectedFile && (
        <div className="mb-4 bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3 flex-1">
              <FileText className="h-8 w-8 text-blue-600" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">
                  {selectedFile.name}
                </p>
                <p className="text-sm text-gray-500">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
            </div>
            <button
              onClick={clearSelection}
              className="text-gray-400 hover:text-red-600 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Custom Name Input */}
          <Input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Custom file name (optional)"
            className="mb-3"
          />

          {/* Upload Button - Submits this specific document */}
          <Button
            onClick={handleUpload}
            disabled={uploading}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            {uploading ? (
              <>
                <Upload className="h-4 w-4 mr-2 animate-pulse" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload {docType.label}
              </>
            )}
          </Button>
        </div>
      )}

      {/* Uploaded Documents List - Shows all documents of this type */}
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
                    {(doc.size / 1024).toFixed(1)} KB •
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

              {/* Document Tags - Can be added by advisors/underwriting */}
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

              {/* Document Actions */}
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
  const [editDoc, setEditDoc] = useState<UserDocument | null>(null);

  /**
   * Initialize component: Get authenticated user and fetch their documents
   */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      await fetchDocuments(user.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * fetchDocuments: Retrieves all documents for the authenticated user
   * Maps database metadata to include tags array for easier manipulation
   */
  const fetchDocuments = async (uid: string) => {
    setLoading(true);
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
      setLoading(false);
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
   * checklist: Array showing status of each required document
   * Includes count of uploaded files for each document type
   */
  const checklist = useMemo(() => {
    return REQUIRED_DOCS.map((r) => ({
      ...r,
      count: uploadedByCode.get(r.code) || 0,
      has: (uploadedByCode.get(r.code) || 0) > 0,
    }));
  }, [uploadedByCode]);

  /**
   * progressPct: Percentage of required documents that have been uploaded
   * Used for progress bar and dashboard notifications
   */
  const progressPct = useMemo(() => {
    const total = REQUIRED_DOCS.length;
    const have = checklist.filter((c) => c.has).length;
    return Math.round((have / total) * 100);
  }, [checklist]);

  const allComplete = checklist.every((c) => c.has);

  /**
   * Notify parent component (dashboard) of checklist progress
   * Allows dashboard to show overall completion status
   */
  useEffect(() => {
    onChecklist?.({ progress: progressPct, complete: allComplete });
  }, [progressPct, allComplete, onChecklist]);

  if (loading) {
    return (
      <div className="w-full py-12 text-center">
        <p className="text-gray-500">Loading your document vault...</p>
      </div>
    );
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
            {checklist.filter(c => c.has).length} of {REQUIRED_DOCS.length} documents uploaded
          </span>
          {allComplete && (
            <span className="flex items-center gap-2 text-emerald-600 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              All documents complete
            </span>
          )}
        </div>
      </div>

      {/* Document Cards Grid - Individual card for each required document type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {REQUIRED_DOCS.map((docType) => (
          <DocumentCard
            key={docType.code}
            docType={docType}
            documents={documents}
            userId={userId || ""}
            onUploadComplete={() => fetchDocuments(userId || "")}
            onDelete={handleDelete}
            onEdit={setEditDoc}
            onToggleFavorite={toggleFavorite}
            onDownload={handleDownload}
          />
        ))}
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