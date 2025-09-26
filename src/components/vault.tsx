// src/components/vault/vault.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import clsx from "clsx";
import {
  Upload, Trash2, Star, Download, FileText, Folder, Heart, Pencil, CheckCircle2, AlertCircle
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

const REQUIRED_DOCS = [
  { code: "bank_statements_6mo", label: "Bank Statements (last 6 months)" },
  { code: "drivers_license_front", label: "Driver’s License — Front" },
  { code: "drivers_license_back", label: "Driver’s License — Back" },
  { code: "voided_check", label: "Voided Business Check" },
  { code: "debt_schedule", label: "Business Debt Schedule (if applicable)" },
] as const;
type RequiredCode = typeof REQUIRED_DOCS[number]["code"];

interface UserDocument {
  id: string; name: string; size: number; type: string;
  category: string | null; custom_label: string | null; description: string | null;
  is_favorite: boolean; upload_date: string; storage_path: string; tags?: string[];
}

type ChecklistInfo = { progress: number; complete: boolean };

export default function Vault({ onChecklist }: { onChecklist?: (info: ChecklistInfo) => void }) {
  const supabase = createClient();
  const { toast } = useToast();

  const [userId, setUserId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"required" | "all" | "favorites">("required");

  const [showModal, setShowModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<RequiredCode | "">("");
  const [fileName, setFileName] = useState("");
  const [editDoc, setEditDoc] = useState<UserDocument | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      await fetchDocuments(user.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchDocuments = async (uid: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("user_documents")
        .select("*")
        .eq("user_id", uid)
        .order("upload_date", { ascending: false });
      if (error) throw error;

      const mapped = (data || []).map((d: any) => ({
        ...d,
        tags: Array.isArray(d?.metadata?.tags) ? d.metadata.tags : [],
      })) as UserDocument[];

      setDocuments(mapped);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!userId || !e.target.files) return;
    const file = e.target.files[0];
    if (!file) return;
    setPendingFile(file);
    setFileName(file.name.replace(/\.[^.]+$/, ""));
    setDocType("");
    setShowModal(true);
    e.target.value = "";
  };

  const confirmUpload = async () => {
    if (!pendingFile || !userId || !docType) {
      toast({ title: "Missing info", description: "Select a document type.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = pendingFile.name.split(".").pop() || "bin";
      const normalized = `${docType}-${Date.now()}.${ext}`;
      const filePath = `${userId}/${normalized}`;

      const { error: upErr } = await supabase.storage.from("user-documents").upload(filePath, pendingFile);
      if (upErr) throw upErr;

      const { data, error: dbErr } = await supabase
        .from("user_documents")
        .insert({
          user_id: userId,
          name: pendingFile.name,
          size: pendingFile.size,
          type: pendingFile.type,
          storage_path: filePath,
          category: docType,
          custom_label: fileName || pendingFile.name,
          metadata: { tags: [docType] },
        })
        .select("*")
        .single();
      if (dbErr) throw dbErr;

      setDocuments((prev) => [{ ...data, tags: [docType] }, ...prev]);

      try {
        await fetch("/api/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ document_id: data.id, storage_path: data.storage_path, doc_code: docType }),
        });
      } catch {}

      toast({ title: "Uploaded", description: "Document uploaded successfully." });
    } catch (err: any) {
      toast({ title: "Upload error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setShowModal(false);
      setPendingFile(null);
    }
  };

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
      setDocuments((prev) => prev.map((d) => (d.id === editDoc.id ? editDoc : d)));
      setEditDoc(null);
      toast({ title: "Updated", description: "Document updated successfully." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const toggleFavorite = async (doc: UserDocument) => {
    try {
      const { error } = await supabase.from("user_documents").update({ is_favorite: !doc.is_favorite }).eq("id", doc.id);
      if (error) throw error;
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, is_favorite: !doc.is_favorite } : d)));
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (doc: UserDocument) => {
    try {
      await supabase.storage.from("user-documents").remove([doc.storage_path]);
      await supabase.from("user_documents").delete().eq("id", doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      toast({ title: "Deleted", description: `${doc.custom_label || doc.name} removed.` });
    } catch (err: any) {
      toast({ title: "Delete error", description: err.message, variant: "destructive" });
    }
  };

  const handleDownload = async (doc: UserDocument) => {
    try {
      const { data } = await supabase.storage.from("user-documents").download(doc.storage_path);
      if (!data) return;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download error", description: err.message, variant: "destructive" });
    }
  };

  // Checklist + progress
  const uploadedByCode = useMemo(() => {
    const map = new Map<string, number>();
    documents.forEach((d) => { if (d.category) map.set(d.category, (map.get(d.category) || 0) + 1); });
    return map;
  }, [documents]);

  const checklist = useMemo(() => {
    return REQUIRED_DOCS.map((r) => ({
      ...r,
      count: uploadedByCode.get(r.code) || 0,
      has: (uploadedByCode.get(r.code) || 0) > 0,
    }));
  }, [uploadedByCode]);

  const progressPct = useMemo(() => {
    const total = REQUIRED_DOCS.length;
    const have = checklist.filter((c) => c.has).length;
    return Math.round((have / total) * 100);
  }, [checklist]);

  const allComplete = checklist.every((c) => c.has);

  // 🔔 Notificar al dashboard
  useEffect(() => {
    onChecklist?.({ progress: progressPct, complete: allComplete });
  }, [progressPct, allComplete, onChecklist]);

  const filteredDocs = useMemo(() => {
    if (activeTab === "all") return documents;
    if (activeTab === "favorites") return documents.filter((d) => d.is_favorite);
    const allowed = new Set(REQUIRED_DOCS.map((r) => r.code));
    return documents.filter((d) => d.category && allowed.has(d.category as RequiredCode));
  }, [activeTab, documents]);

  return (
    <div className="w-full space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-emerald-600 rounded-lg flex items-center justify-center shadow">
          <Folder className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Document Vault</h2>
          <p className="text-gray-500">Upload, track, and submit your required documents.</p>
        </div>
      </div>

      {/* Checklist */}
      <div className="bg-white border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold text-gray-900">Checklist Progress</div>
          <div className="text-sm text-gray-600">{progressPct}% complete</div>
        </div>
        <Progress value={progressPct} className="mb-4" />
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {checklist.map((item) => (
            <div key={item.code} className={clsx("flex items-center gap-3 border rounded-lg px-3 py-2",
              item.has ? "bg-emerald-50 border-emerald-200" : "bg-gray-50")}>
              {item.has ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertCircle className="h-5 w-5 text-gray-400" />}
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">{item.label}</div>
                <div className="text-xs text-gray-500">{item.has ? `Uploaded (${item.count})` : "Missing"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-3">
        {[
          { key: "required", label: "Required", icon: FileText },
          { key: "all", label: "All", icon: Folder },
          { key: "favorites", label: "Favorites", icon: Heart },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition",
              activeTab === tab.key ? "bg-emerald-600 text-white shadow" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Upload + List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-white border rounded-xl shadow p-10 flex flex-col items-center justify-center">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-10 cursor-pointer hover:bg-gray-50 transition w-full">
            <Upload className="h-14 w-14 text-emerald-600 mb-3" />
            <span className="font-medium text-gray-700">Click or drag a file here</span>
            <span className="text-sm text-gray-500">PDF, images, Word, Excel…</span>
            <input type="file" onChange={handleUpload} className="hidden" />
          </label>
          {uploading && <p className="text-sm text-emerald-600 mt-3">Uploading...</p>}
        </div>

        <div className="bg-white border rounded-xl shadow p-6 lg:col-span-2">
          {loading ? (
            <p className="text-gray-500 text-center">Loading documents...</p>
          ) : filteredDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <FileText className="h-14 w-14 mb-3 text-gray-400" />
              <p>No documents found.</p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {filteredDocs.map((doc) => (
                <div key={doc.id} className="flex flex-col border rounded-lg p-4 bg-gray-50 hover:shadow-md transition">
                  <div className="flex justify-between items-start">
                    <p className="font-medium text-gray-900 truncate">{doc.custom_label || doc.name}</p>
                    <button onClick={() => toggleFavorite(doc)}>
                      <Star className={clsx("h-5 w-5", doc.is_favorite ? "text-yellow-500 fill-yellow-500" : "text-gray-400")} />
                    </button>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {(doc.size / 1024).toFixed(1)} KB • {REQUIRED_DOCS.find(r => r.code === doc.category)?.label || "Other"}
                  </p>
                  {doc.tags && doc.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {doc.tags.map((tag, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full text-xs">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => handleDownload(doc)} className="flex-1 py-2 text-sm font-medium text-emerald-600 border rounded hover:bg-emerald-50">
                      <Download className="inline h-4 w-4 mr-1" /> Download
                    </button>
                    <button onClick={() => setEditDoc(doc)} className="flex-1 py-2 text-sm font-medium text-blue-600 border rounded hover:bg-blue-50">
                      <Pencil className="inline h-4 w-4 mr-1" /> Edit
                    </button>
                    <button onClick={() => handleDelete(doc)} className="flex-1 py-2 text-sm font-medium text-red-600 border rounded hover:bg-red-50">
                      <Trash2 className="inline h-4 w-4 mr-1" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New upload modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Document details</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="Custom file name" />
            <Select value={docType} onValueChange={(v) => setDocType(v as RequiredCode)}>
              <SelectTrigger><SelectValue placeholder="Select document type" /></SelectTrigger>
              <SelectContent>
                {REQUIRED_DOCS.map((r) => (<SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={confirmUpload} disabled={uploading || !docType}>{uploading ? "Uploading..." : "Save & Upload"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit modal */}
      <Dialog open={!!editDoc} onOpenChange={() => setEditDoc(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit document</DialogTitle></DialogHeader>
          {editDoc && (
            <div className="space-y-4">
              <Input value={editDoc.custom_label || ""} onChange={(e) => setEditDoc({ ...editDoc, custom_label: e.target.value })} placeholder="Custom file name" />
              <Select value={(editDoc.category as RequiredCode) || ""} onValueChange={(v) => setEditDoc({ ...editDoc, category: v })}>
                <SelectTrigger><SelectValue placeholder="Select document type" /></SelectTrigger>
                <SelectContent>
                  {REQUIRED_DOCS.map((r) => (<SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
              <Input value={editDoc.tags?.join(", ") || ""} onChange={(e) => setEditDoc({ ...editDoc, tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) })} placeholder="Tags (comma separated)" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDoc(null)}>Cancel</Button>
            <Button onClick={confirmEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
