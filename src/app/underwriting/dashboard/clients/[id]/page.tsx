// src/app/underwriting/dashboard/clients/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    ArrowLeft,
    Download,
    FileText,
    Calendar,
    Mail,
    Phone,
    Building2,
    DollarSign,
    AlertCircle,
    Loader2,
    CheckCircle2,
    ShieldCheck,
    Bell,
    ExternalLink,
    Clock,
    Plus,
    ChevronDown,
    ChevronUp,
    Eye,
    Star,
    Trash2,
    Pencil
} from "lucide-react";
import DocumentPreviewModal from "@/components/pdf/pdf-viewer";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { notifyAdvisor, markDocumentAsViewed } from "../../actions";
import { fetchInternalNotes, addInternalNote } from "@/app/actions/internal-notes";
import { toast } from "sonner";
import clsx from "clsx";
import { format } from "date-fns";
import { LoanFundedDialog } from "@/components/loan-funded-dialog";
import { getClientPipelineHistory, updateLoanStatus, type LoanStatus, type PipelineStatusEntry } from "@/app/actions/pipeline";
import { LoanPipelineFull, PIPELINE_STEPS } from "@/components/loan-pipeline-status";

enum ComponentState {
    LOADING = "LOADING",
    ERROR = "ERROR",
    SUCCESS = "SUCCESS",
    ACCESS_DENIED = "ACCESS_DENIED",
}

interface ClientProfile {
    id: string;
    user_id: string;
    client_name: string;
    client_email: string;
    client_phone: string;
    company_name: string;
    company_city: string;
    company_state: string;
    capital_requested: number;
    legal_entity_type: string;
    business_start_date: string;
    avg_monthly_deposits: number;
    credit_score: string;
    created_at: string;
    proposed_loan_type: string;
    loan_purpose: string;
    industry: string;
    number_of_owners: string;
    owner_1_name: string;
    owner_1_ownership_pct: number;
    owner_2_name: string | null;
    owner_2_ownership_pct: number | null;
    owner_3_name: string | null;
    owner_3_ownership_pct: number | null;
    owner_4_name: string | null;
    owner_4_ownership_pct: number | null;
    owner_5_name: string | null;
    owner_5_ownership_pct: number | null;
    advisor: {
        first_name: string;
        last_name: string;
        email: string;
    };
}

interface OpenPosition {
    id: string;
    lender_name: string;
    loan_type: string;
    current_balance: number | null;
    payment_amount: number | null;
    payment_term: string | null;
}

interface LenderAssignment {
    id: string;
    lender_name: string;
    specialty: string | null;
    decision: 'approved' | 'rejected';
    payment_type: string | null;
    min_funding: number | null;
    max_funding: number | null;
    assigned_at: string;
}

interface UserDocument {
    id: string;
    name: string;
    size: number;
    type: string;
    category: string | null;
    custom_label: string | null;
    upload_date: string;
    storage_path: string;
    viewed_at: string | null;
    uploaded_by_role?: 'advisor' | 'client';
}

interface InternalNote {
    id: string;
    author_name: string;
    author_role: string;
    content: string;
    created_at: string;
}

export default function UnderwritingClientDetailsPage() {
    const supabase = createClient();
    const router = useRouter();
    const params = useParams();
    const client_id = params.id as string;

    const [component_state, set_component_state] = useState<ComponentState>(ComponentState.LOADING);
    const [client_profile, set_client_profile] = useState<ClientProfile | null>(null);
    const [documents, set_documents] = useState<UserDocument[]>([]);
    const [open_positions, set_open_positions] = useState<OpenPosition[]>([]);
    const [required_docs, set_required_docs] = useState<{ code: string; label: string }[]>([]);
    const [error_message, set_error_message] = useState<string>("");
    const [lender_assignments, set_lender_assignments] = useState<LenderAssignment[]>([]);
    const [is_loading_assignments, set_is_loading_assignments] = useState(false);

    const [is_notify_modal_open, set_is_notify_modal_open] = useState(false);
    const [selected_missing_docs, set_selected_missing_docs] = useState<string[]>([]);
    const [all_available_docs, set_all_available_docs] = useState<{ code: string; label: string }[]>([]);
    const [selected_extra_docs, set_selected_extra_docs] = useState<string[]>([]);
    const [custom_note, set_custom_note] = useState("");
    const [is_notifying, set_is_notifying] = useState(false);

    // Internal Notes state
    const [notes, set_notes] = useState<InternalNote[]>([]);
    const [new_standalone_note, set_new_standalone_note] = useState("");
    const [is_adding_note, set_is_adding_note] = useState(false);

    // Documents state enhancement
    const [approvals, set_approvals] = useState<Set<string>>(new Set());
    const [expanded_categories, set_expanded_categories] = useState<Set<string>>(new Set());
    const [preview_modal, set_preview_modal] = useState<{ isOpen: boolean; doc: UserDocument | null }>({
        isOpen: false,
        doc: null,
    });

    // Pipeline State
    const [current_pipeline_status, set_current_pipeline_status] = useState<LoanStatus>("created");
    const [pipeline_history, set_pipeline_history] = useState<PipelineStatusEntry[]>([]);
    const [is_advancing_status, set_is_advancing_status] = useState(false);

    useEffect(() => {
        if (client_id) fetch_client_details();
    }, [client_id]);

    async function fetch_client_details() {
        try {
            set_component_state(ComponentState.LOADING);

            // 1. Fetch Client Profile with Advisor details
            const { data: client, error: client_error } = await supabase
                .from("client_data_vault")
                .select(`
                    id, user_id, client_name, client_email, client_phone, 
                    company_name, company_city, company_state, capital_requested,
                    legal_entity_type, business_start_date, avg_monthly_deposits,
                    credit_score, created_at, 
                    proposed_loan_type, loan_purpose, industry, 
                    number_of_owners, owner_1_name, owner_1_ownership_pct,
                    owner_2_name, owner_2_ownership_pct, owner_3_name, owner_3_ownership_pct,
                    owner_4_name, owner_4_ownership_pct, owner_5_name, owner_5_ownership_pct,
                    advisors (
                        first_name, last_name, email
                    )
                `)
                .eq("id", client_id)
                .maybeSingle();

            if (client_error || !client) throw new Error("Client not found.");

            const advisor: any = client.advisors;
            set_client_profile({
                ...client,
                advisor: {
                    first_name: advisor?.first_name || "Unknown",
                    last_name: advisor?.last_name || "Advisor",
                    email: advisor?.email || ""
                }
            } as any);

            // 2. Fetch all documents for this client
            const { data: docs } = await supabase
                .from("user_documents")
                .select("*")
                .eq("user_id", client.user_id)
                .order("upload_date", { ascending: false });
            set_documents(docs || []);

            // 2.5 Fetch Open Positions
            const { data: positions } = await supabase
                .from("client_open_positions")
                .select("*")
                .eq("client_vault_id", client_id)
                .order("position_number", { ascending: true });
            set_open_positions(positions || []);

            // 3. Fetch current requirements (core + dynamic)
            const { data: coreDocs } = await supabase
                .from("required_documents")
                .select("code, label")
                .eq("is_core", true);
            const coreReqs = coreDocs || [];

            // 4. Fetch all available document types FOR THE CATALOG
            const { data: allDocs } = await supabase
                .from("required_documents")
                .select("code, label")
                .order("label", { ascending: true });
            set_all_available_docs(allDocs || []);

            const { data: dynamicDocs } = await supabase
                .from("client_dynamic_documents")
                .select("required_documents(code, label)")
                .eq("user_id", client.user_id)
                .eq("is_active", true);

            const dynamicReqs = (dynamicDocs || []).map((d: any) => d.required_documents).filter(Boolean);
            const allReqs = [...coreReqs, ...dynamicReqs];

            // Unique by code
            const uniqueReqs = Array.from(new Map(allReqs.map(r => [r.code, r])).values());
            set_required_docs(uniqueReqs);

            // 5. Fetch internal notes
            const notesRes = await fetchInternalNotes(client_id);
            if (notesRes.success) {
                set_notes(notesRes.notes || []);
            }

            // 6. Fetch pipeline history
            const history = await getClientPipelineHistory(client_id);
            set_pipeline_history(history);

            // 7. Fetch approvals for this client
            const { data: categoryApprovals } = await supabase
                .from("document_category_approvals")
                .select("doc_code")
                .eq("client_vault_id", client_id);
            set_approvals(new Set((categoryApprovals || []).map(a => a.doc_code)));

            // 8. Fetch Lender Assignments
            await fetch_lender_assignments();

            set_component_state(ComponentState.SUCCESS);

        } catch (err: any) {
            console.error("fetch_client_details error:", err);
            set_error_message(err.message || "An unexpected error occurred.");
            set_component_state(ComponentState.ERROR);
        }
    }

    async function fetch_lender_assignments() {
        set_is_loading_assignments(true);
        try {
            const { data, error } = await supabase
                .from("client_lender_assignments")
                .select("*")
                .eq("client_id", client_id)
                .order("assigned_at", { ascending: false });

            if (data) set_lender_assignments(data);
        } catch (err) {
            console.error("fetch_lender_assignments error:", err);
        } finally {
            set_is_loading_assignments(false);
        }
    }

    async function download_document(doc: UserDocument) {
        try {
            const { data, error } = await supabase.storage
                .from("user-documents")
                .download(doc.storage_path);
            if (error) throw error;

            const url = URL.createObjectURL(data);
            const a = document.createElement("a");
            a.href = url; a.download = doc.name;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);

            // Mark as viewed if not already
            if (!doc.viewed_at) {
                const res = await markDocumentAsViewed(doc.id);
                if (res.success) {
                    set_documents(prev => prev.map(d => 
                        d.id === doc.id ? { ...d, viewed_at: new Date().toISOString() } : d
                    ));
                }
            }
        } catch (err) {
            toast.error(`Error downloading ${doc.name}`);
        }
    }

    /**
     * download_all_documents: Downloads all documents in a category sequentially
     */
    async function download_all_documents(docs: UserDocument[]) {
        if (docs.length === 0) return;
        
        toast.info(`Preparing to download ${docs.length} files...`);
        
        for (let i = 0; i < docs.length; i++) {
            const doc = docs[i];
            await download_document(doc);
            
            // Add a small delay between downloads
            if (i < docs.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 800));
            }
        }
        
        toast.success("All downloads initiated!");
    }

    async function handleNotifyAdvisor() {
        if (selected_missing_docs.length === 0 && selected_extra_docs.length === 0) {
            toast.error("Please select at least one document or requirement");
            return;
        }

        set_is_notifying(true);
        try {
            // Construct the final note content with ALL requested items
            let items_summary = "";
            if (selected_missing_docs.length > 0) {
                items_summary += `MISSING REQUIRED ITEMS:\n- ${selected_missing_docs.join("\n- ")}\n\n`;
            }
            if (selected_extra_docs.length > 0) {
                items_summary += `ADDITIONAL DOCUMENTS REQUESTED:\n- ${selected_extra_docs.join("\n- ")}\n\n`;
            }

            let final_note = custom_note;
            if (items_summary) {
                final_note = final_note
                    ? `${items_summary}--- NOTES ---\n${final_note}`
                    : items_summary.trim();
            }

            // Consolidate labels for the email notification
            const all_labels = [...selected_missing_docs, ...selected_extra_docs];

            const res = await notifyAdvisor(client_id, all_labels, final_note);
            if (res.success) {
                toast.success("Advisor notified successfully!");
                set_is_notify_modal_open(false);
                set_selected_missing_docs([]);
                set_selected_extra_docs([]);
                set_custom_note("");
                // Refresh notes since notifyAdvisor might have added a system note/audit trail
                const notesRes = await fetchInternalNotes(client_id);
                if (notesRes.success) {
                    set_notes(notesRes.notes || []);
                }
            } else {
                toast.error(res.error || "Failed to notify advisor");
            }
        } finally {
            set_is_notifying(false);
        }
    }

    async function handleAddNote() {
        if (!new_standalone_note.trim()) return;

        set_is_adding_note(true);
        try {
            const res = await addInternalNote(client_id, new_standalone_note, "underwriting");
            if (res.success) {
                toast.success("Note added!");
                set_new_standalone_note("");
                // Refresh notes
                const notesRes = await fetchInternalNotes(client_id);
                if (notesRes.success) {
                    set_notes(notesRes.notes || []);
                }
            } else {
                toast.error(res.error || "Failed to add note");
            }
        } finally {
            set_is_adding_note(false);
        }
    }

    async function handleAdvanceStatus(newStatus: LoanStatus) {
        set_is_advancing_status(true);
        try {
            const res = await updateLoanStatus(client_id, newStatus);
            if (res.success) {
                toast.success(`Status updated to "${newStatus.replace(/_/g, " ")}"`); 
                // Refresh pipeline
                const history = await getClientPipelineHistory(client_id);
                set_pipeline_history(history);
                set_current_pipeline_status(newStatus);
            }
        } finally {
            set_is_advancing_status(false);
        }
    }
    /**
     * render_outstanding_banner: UI component for the top alert in underwriting
     */
    function render_outstanding_banner(required_docs: { code: string; label: string }[]) {
        const outstanding = required_docs.filter(
            doc_type => !approvals.has(doc_type.code) || get_documents_by_category(doc_type.code).length === 0
        );

        if (outstanding.length === 0) return null;

        return (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-[2rem] p-6 mb-8 shadow-xl shadow-amber-500/5">
                <div className="flex items-start gap-4">
                    <div className="bg-amber-100 p-3 rounded-2xl">
                        <AlertCircle className="h-7 w-7 text-amber-600" />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                            <h4 className="text-amber-900 font-black text-sm uppercase tracking-widest">
                                Vault Health Check: {outstanding.length} Pending Actions
                            </h4>
                            <Badge className="bg-amber-500 text-white border-none font-black text-[10px] uppercase px-3">Attention Required</Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {outstanding.map(doc => {
                                const category_docs = get_documents_by_category(doc.code);
                                const is_pending_upload = category_docs.length === 0;
                                
                                return (
                                    <Badge 
                                        key={doc.code}
                                        variant="outline"
                                        className={clsx(
                                            "cursor-pointer hover:shadow-lg hover:scale-105 active:scale-95 transition-all px-4 py-2 border-2 rounded-xl text-[10px] font-black uppercase tracking-widest",
                                            is_pending_upload 
                                                ? "bg-red-50 text-red-500 border-red-100 hover:bg-red-100" 
                                                : "bg-amber-100/50 text-amber-700 border-amber-200 hover:bg-amber-200"
                                        )}
                                        onClick={() => {
                                            if (!expanded_categories.has(doc.code)) {
                                                toggle_category_expansion(doc.code);
                                            }
                                            const el = document.getElementById(`category-${doc.code}`);
                                            setTimeout(() => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                                        }}
                                    >
                                        {doc.label} {is_pending_upload ? "• Missing" : "• Awaiting Advisor"}
                                    </Badge>
                                );
                            })}
                        </div>
                        <p className="text-[10px] font-bold text-amber-600 mt-4 uppercase tracking-[0.2em] opacity-80 italic">
                            * Advisors must verify all documents before underwriting final review.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    /**
     * get_documents_by_category: Groups documents by their category
     */
    function get_documents_by_category(category_code: string): UserDocument[] {
        return documents.filter(doc => doc.category === category_code);
    }

    /**
     * toggle_category_expansion: Expands or collapses a document category section
     */
    function toggle_category_expansion(code: string) {
        set_expanded_categories(prev => {
            const next = new Set(prev);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            return next;
        });
    }

    function format_file_size(bytes: number): string {
        if (!bytes) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    /**
     * render_document_card: Renders individual document card with download/preview for underwriting
     */
    function render_document_card(doc: UserDocument) {
        return (
            <Card
                key={doc.id}
                className="hover:shadow-md transition-shadow group border-slate-100 bg-white"
            >
                <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                                <FileText className="h-5 w-5 text-slate-300 flex-shrink-0" />
                                <h4 className="font-bold text-slate-900 truncate">
                                    {doc.custom_label || doc.name}
                                </h4>
                                {doc.uploaded_by_role && (
                                    <Badge variant="outline" className={clsx(
                                        "text-[8px] font-black uppercase px-2 h-4 border-none shrink-0",
                                        doc.uploaded_by_role === 'advisor' ? "bg-blue-50 text-blue-500" : "bg-slate-50 text-slate-400"
                                    )}>
                                        {doc.uploaded_by_role === 'advisor' ? "By Advisor" : "By Client"}
                                    </Badge>
                                )}
                                {!doc.viewed_at && (
                                    <Badge className="bg-emerald-500 text-white border-none text-[8px] font-black uppercase px-2 h-4 scale-90 origin-left animate-pulse">
                                        NEW
                                    </Badge>
                                )}
                            </div>

                            <div className="space-y-1 text-xs text-slate-500">
                                <p className="truncate">{doc.name}</p>
                                <div className="flex items-center gap-3 font-bold opacity-60">
                                    <span>{format_file_size(doc.size)}</span>
                                    <span>•</span>
                                    <span>Uploaded {format(new Date(doc.upload_date), "MMM d, yyyy")}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => set_preview_modal({ isOpen: true, doc })}
                                className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                title="Preview Document"
                            >
                                <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => download_document(doc)}
                                className="h-8 w-8 p-0 text-slate-400 hover:text-slate-900"
                                title="Download File"
                            >
                                <Download className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    /**
     * render_document_category: Renders a category section with its documents for underwriting
     */
    function render_document_category(doc_type: { code: string; label: string }) {
        const category_docs = documents.filter(d => d.category === doc_type.code);
        const has_docs = category_docs.length > 0;
        const is_approved = approvals.has(doc_type.code);
        const is_expanded = expanded_categories.has(doc_type.code);

        // Define status theme
        const status = is_approved ? 'approved' : has_docs ? 'uploaded' : 'pending';
        
        const themes = {
            approved: "bg-emerald-50 border-emerald-200",
            uploaded: "bg-amber-50 border-amber-200",
            pending: "bg-slate-50 border-slate-100 opacity-60"
        };

        return (
            <div
                key={doc_type.code}
                id={`category-${doc_type.code}`}
                className={clsx(
                    "border rounded-[2rem] transition-all duration-300 shadow-sm overflow-hidden",
                    themes[status]
                )}
            >
                {/* Category Header */}
                <div 
                    className="flex items-center justify-between p-5 cursor-pointer hover:bg-black/[0.02] active:scale-[0.995] transition-all"
                    onClick={() => toggle_category_expansion(doc_type.code)}
                >
                    <div className="flex items-center gap-4">
                        <div className={clsx(
                            "w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm transition-colors",
                            status === 'approved' ? "bg-emerald-500 text-white" :
                            status === 'uploaded' ? "bg-amber-500 text-white" : "bg-white border border-slate-200 text-slate-300"
                        )}>
                            {status === 'approved' ? <ShieldCheck className="h-6 w-6" /> :
                             status === 'uploaded' ? <CheckCircle2 className="h-6 w-6" /> : <Clock className="h-6 w-6" />}
                        </div>
                        <div>
                            <h3 className="font-black text-slate-900 leading-tight uppercase tracking-tighter">{doc_type.label}</h3>
                            <div className="flex items-center gap-2 mt-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    {status === 'approved' ? 'Advisor Verified' :
                                     status === 'uploaded' ? 'Ready for Audit' : 'Awaiting Submission'}
                                </p>
                                {has_docs && (
                                    <>
                                        <div className="w-1 h-1 rounded-full bg-slate-300" />
                                        <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                                            {category_docs.length} File{category_docs.length > 1 ? 's' : ''}
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Download All if multiple docs */}
                        {has_docs && category_docs.length > 1 && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    download_all_documents(category_docs);
                                }}
                                className="border-emerald-200 text-emerald-600 hover:bg-emerald-50 rounded-xl h-8 px-3 font-black text-[9px] uppercase tracking-widest shadow-lg shadow-emerald-500/10"
                            >
                                <Download className="h-3.5 w-3.5 mr-1" />
                                Download All
                            </Button>
                        )}
                        
                        <div className="w-px h-6 bg-slate-200 mx-1" />
                        
                        {is_expanded ? <ChevronUp className="h-5 w-5 text-slate-400" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}
                    </div>
                </div>

                {/* Docs List if expanded */}
                {is_expanded && has_docs && (
                    <div className="px-5 pb-5 space-y-3">
                        {category_docs.map(doc => render_document_card(doc))}
                    </div>
                )}
            </div>
        );
    }

    /**
     * render_lender_assignments: UI component for the lender matching results
     */
    function render_lender_assignments() {
        if (lender_assignments.length === 0) return null;

        const approved = lender_assignments.filter(a => a.decision === 'approved');
        const rejected = lender_assignments.filter(a => a.decision === 'rejected');

        return (
            <Card className="rounded-[2.5rem] border-slate-200 overflow-hidden shadow-sm">
                <CardHeader className="pb-4 border-b border-slate-100 flex flex-row items-center justify-between bg-slate-50/30">
                    <div className="flex items-center gap-3">
                        <div className="bg-emerald-500/10 p-2 rounded-xl">
                            <Star className="h-4 w-4 text-emerald-600" />
                        </div>
                        <div>
                            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Lender Matching Results</CardTitle>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                {approved.length} Approved • {rejected.length} Rejected
                            </p>
                        </div>
                    </div>
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => router.push('/underwriting/lender-match')}
                        className="h-8 rounded-xl text-[9px] font-black uppercase tracking-widest border-slate-200 hover:bg-slate-50"
                    >
                        <ExternalLink className="w-3 h-3 mr-1.5" />
                        Match Tool
                    </Button>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y divide-slate-100">
                        {lender_assignments.map((assign) => (
                            <div key={assign.id} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition-all group">
                                <div className="flex items-center gap-4">
                                    <div className={clsx(
                                        "w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shadow-sm",
                                        assign.decision === 'approved' ? "bg-emerald-500 text-white" : "bg-orange-500 text-white"
                                    )}>
                                        {assign.decision === 'approved' ? '✓' : '✕'}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-black text-slate-900 group-hover:text-emerald-600 transition-colors uppercase tracking-tight">
                                                {assign.lender_name}
                                            </p>
                                            {assign.specialty && (
                                                <Badge variant="outline" className="text-[8px] font-black tracking-widest uppercase py-0 px-2 border-slate-200 text-slate-400">
                                                    {assign.specialty}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                            <span>{assign.payment_type || 'Custom Terms'}</span>
                                            {assign.min_funding && (
                                                <>
                                                    <span className="opacity-30">•</span>
                                                    <span>Min: ${(assign.min_funding / 1000).toFixed(0)}k</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <Badge className={clsx(
                                        "font-black text-[9px] uppercase tracking-widest px-3 py-1",
                                        assign.decision === 'approved' ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : "bg-orange-100 text-orange-700 hover:bg-orange-100"
                                    )}>
                                        {assign.decision}
                                    </Badge>
                                    <p className="text-[8px] font-bold text-slate-300 mt-1 uppercase tracking-tighter">
                                        Assigned {format(new Date(assign.assigned_at), 'MMM d')}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (component_state === ComponentState.LOADING) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="h-12 w-12 text-emerald-500 animate-spin mb-4" />
                <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Loading Review Profile...</p>
            </div>
        );
    }

    if (component_state === ComponentState.ERROR) {
        return (
            <div className="max-w-md mx-auto py-20">
                <Card className="bg-red-50 border-red-100 p-8 text-center rounded-[2.5rem]">
                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter mb-2">Review Error</h3>
                    <p className="text-slate-500 font-bold mb-6">{error_message}</p>
                    <Button onClick={() => router.push("/underwriting/dashboard")} variant="outline">Back to Queue</Button>
                </Card>
            </div>
        );
    }

    if (!client_profile) return null;

    const completed_count = required_docs.filter(r => documents.some(d => d.category === r.code)).length;
    const total_count = required_docs.length;
    const completion_pct = Math.round((completed_count / (total_count || 1)) * 100);

    return (
        <div className="space-y-8">
            {/* Header / Actions */}
            <div className="flex items-center justify-between">
                <Button variant="ghost" onClick={() => router.push("/underwriting/dashboard")} className="text-slate-400 font-bold hover:text-slate-900 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Queue
                </Button>

                <Dialog open={is_notify_modal_open} onOpenChange={set_is_notify_modal_open}>
                    <DialogTrigger asChild>
                        <Button className="h-12 bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-xl shadow-slate-900/10 px-6 font-black uppercase tracking-widest text-xs">
                            <Bell className="w-4 h-4 mr-2" />
                            Notify Advisor
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md rounded-[3rem] p-8">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Missing Documents</DialogTitle>
                            <DialogDescription className="text-slate-500 font-bold">
                                Select which documents are missing or rejected to notify <strong>{client_profile.advisor.first_name} {client_profile.advisor.last_name}</strong>.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-6 space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                            <div className="space-y-3">
                                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Select Missing Required Items</p>
                                <div className="grid grid-cols-1 gap-2 border rounded-2xl p-4 bg-slate-50/50">
                                    {required_docs.map((doc) => {
                                        const is_done = documents.some(d => d.category === doc.code);
                                        return (
                                            <div key={doc.code} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-white transition-colors">
                                                <Checkbox
                                                    id={`missing-${doc.code}`}
                                                    checked={selected_missing_docs.includes(doc.label)}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) set_selected_missing_docs([...selected_missing_docs, doc.label]);
                                                        else set_selected_missing_docs(selected_missing_docs.filter(l => l !== doc.label));
                                                    }}
                                                />
                                                <label htmlFor={`missing-${doc.code}`} className={clsx("text-sm font-bold leading-none cursor-pointer", is_done ? "text-slate-400 line-through font-medium" : "text-slate-700")}>
                                                    {doc.label} {is_done && "(Already Uploaded)"}
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Select Additional Documents to Request</p>
                                <div className="grid grid-cols-1 gap-2 border rounded-2xl p-4 bg-slate-50/50 max-h-[250px] overflow-y-auto custom-scrollbar">
                                    {all_available_docs
                                        .filter(doc => !required_docs.some(r => r.code === doc.code))
                                        .map((doc) => (
                                            <div key={`extra-${doc.code}`} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-white transition-colors">
                                                <Checkbox
                                                    id={`extra-${doc.code}`}
                                                    checked={selected_extra_docs.includes(doc.label)}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) set_selected_extra_docs([...selected_extra_docs, doc.label]);
                                                        else set_selected_extra_docs(selected_extra_docs.filter(l => l !== doc.label));
                                                    }}
                                                />
                                                <label htmlFor={`extra-${doc.code}`} className="text-sm font-bold text-slate-700 leading-none cursor-pointer">
                                                    {doc.label}
                                                </label>
                                            </div>
                                        ))}
                                </div>
                            </div>

                            <div className="space-y-2 pt-2">
                                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Custom message (Internal Note)</label>
                                <Textarea
                                    placeholder="Add specific instructions for the advisor..."
                                    className="min-h-[100px] rounded-2xl border-slate-200 focus:ring-emerald-500"
                                    value={custom_note}
                                    onChange={(e) => set_custom_note(e.target.value)}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => set_is_notify_modal_open(false)} className="rounded-xl font-bold">Cancel</Button>
                            <Button
                                onClick={handleNotifyAdvisor}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black shadow-lg shadow-emerald-500/20"
                                disabled={is_notifying || (selected_missing_docs.length === 0 && selected_extra_docs.length === 0)}
                            >
                                {is_notifying ? "Sending..." : "Send Notification"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <LoanFundedDialog 
                    clientId={client_id} 
                    clientName={client_profile.client_name} 
                    onSuccess={fetch_client_details}
                />
            </div>

            {/* Outstanding Documents Banner */}
            {render_outstanding_banner(required_docs)}

            {/* Pipeline Status Card */}
            <Card className="bg-white border-slate-200 rounded-[2.5rem] shadow-sm overflow-hidden">
                <CardHeader className="px-8 pt-8 pb-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Funding Pipeline</CardTitle>
                            <CardDescription className="text-slate-400 font-bold text-xs mt-1">Current stage: <span className="text-slate-700 uppercase">{current_pipeline_status.replace(/_/g, " ")}</span></CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {/* Next step button */}
                            {(() => {
                                const currentIdx = PIPELINE_STEPS.findIndex((s: { status: LoanStatus }) => s.status === current_pipeline_status);
                                const nextStep = currentIdx >= 0 && currentIdx < PIPELINE_STEPS.length - 1 ? PIPELINE_STEPS[currentIdx + 1] : null;
                                return nextStep ? (
                                    <Button
                                        size="sm"
                                        className="h-9 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black uppercase tracking-widest text-[9px] shadow-lg shadow-emerald-500/20"
                                        onClick={() => handleAdvanceStatus(nextStep.status)}
                                        disabled={is_advancing_status}
                                    >
                                        {is_advancing_status ? <Loader2 className="w-4 h-4 animate-spin" /> : `→ ${nextStep.shortLabel}`}
                                    </Button>
                                ) : null;
                            })()}
                            {/* Decline button */}
                            {current_pipeline_status !== "declined" && current_pipeline_status !== "funded" && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-9 border-red-200 text-red-500 hover:bg-red-50 rounded-xl font-black uppercase tracking-widest text-[9px]"
                                    onClick={() => handleAdvanceStatus("declined")}
                                    disabled={is_advancing_status}
                                >
                                    Decline
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="px-8 pb-8">
                    <LoanPipelineFull
                        currentStatus={current_pipeline_status}
                        history={pipeline_history}
                        onStatusChange={handleAdvanceStatus}
                    />
                </CardContent>
            </Card>

            {/* Profile Hero */}
            <Card className="bg-slate-900 text-white border-slate-800 rounded-[3rem] shadow-2xl overflow-hidden relative">
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-[100px] -mr-32 -mt-32" />
                <CardContent className="p-10 relative z-10 flex flex-col md:flex-row justify-between items-center gap-8">
                    <div className="space-y-4 text-center md:text-left">
                        <Badge className="bg-white/10 text-emerald-400 hover:bg-white/10 border-white/20 uppercase tracking-widest font-black text-[10px] px-3 py-1">
                            {completion_pct}% Documentation Verified
                        </Badge>
                        <h2 className="text-4xl md:text-5xl font-black uppercase tracking-tighter leading-none">{client_profile.client_name}</h2>
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-6 text-slate-400 font-bold">
                            <span className="flex items-center gap-2"><Building2 className="w-4 h-4" /> {client_profile.company_name}</span>
                            <span className="flex items-center gap-2 text-emerald-400"><DollarSign className="w-4 h-4" /> {client_profile.capital_requested.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-20">
                {/* Information Column */}
                <div className="lg:col-span-1 space-y-6">
                    <Card className="rounded-[2.5rem] border-slate-200">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Company Integrity</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Assigned Advisor</p>
                                <p className="text-slate-900 font-black">{client_profile.advisor.first_name} {client_profile.advisor.last_name}</p>
                                <p className="text-slate-500 font-medium text-xs break-all">{client_profile.advisor.email}</p>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Industry</p>
                                <p className="text-slate-900 font-black uppercase tracking-tight">{client_profile.industry || "Not Specified"}</p>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Proposed Loan Type</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {(client_profile.proposed_loan_type || "").split(',').map((type, i) => (
                                        <Badge key={i} variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none text-[9px] font-black uppercase">
                                            {type.trim()}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Time in Biz (Full)</p>
                                    <p className="text-slate-900 font-black text-xs">{format(new Date(client_profile.business_start_date), "MMM d, yyyy")}</p>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Credit Score</p>
                                    <p className="text-emerald-500 font-black">{client_profile.credit_score}</p>
                                </div>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Entity Profile</p>
                                <p className="text-slate-900 font-black uppercase tracking-tighter">{client_profile.legal_entity_type}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="rounded-[2.5rem] border-slate-200">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Ownership & Structure</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Amount of Owners</p>
                                <p className="text-slate-900 font-black">{client_profile.number_of_owners}</p>
                            </div>
                            
                            <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Owner Detail</p>
                                <div className="space-y-2">
                                    <div className="p-3 bg-white rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
                                        <span className="text-xs font-bold text-slate-700 truncate pr-2">{client_profile.owner_1_name}</span>
                                        <Badge className="bg-slate-900 text-white text-[10px]">{client_profile.owner_1_ownership_pct}%</Badge>
                                    </div>
                                    {client_profile.owner_2_name && (
                                        <div className="p-3 bg-white rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
                                            <span className="text-xs font-bold text-slate-700 truncate pr-2">{client_profile.owner_2_name}</span>
                                            <Badge className="bg-slate-400 text-white text-[10px]">{client_profile.owner_2_ownership_pct}%</Badge>
                                        </div>
                                    )}
                                    {client_profile.owner_3_name && (
                                        <div className="p-3 bg-white rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
                                            <span className="text-xs font-bold text-slate-700 truncate pr-2">{client_profile.owner_3_name}</span>
                                            <Badge className="bg-slate-400 text-white text-[10px]">{client_profile.owner_3_ownership_pct}%</Badge>
                                        </div>
                                    )}
                                    {client_profile.owner_4_name && (
                                        <div className="p-3 bg-white rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
                                            <span className="text-xs font-bold text-slate-700 truncate pr-2">{client_profile.owner_4_name}</span>
                                            <Badge className="bg-slate-400 text-white text-[10px]">{client_profile.owner_4_ownership_pct}%</Badge>
                                        </div>
                                    )}
                                    {client_profile.owner_5_name && (
                                        <div className="p-3 bg-white rounded-xl border border-slate-100 flex justify-between items-center shadow-sm">
                                            <span className="text-xs font-bold text-slate-700 truncate pr-2">{client_profile.owner_5_name}</span>
                                            <Badge className="bg-slate-400 text-white text-[10px]">{client_profile.owner_5_ownership_pct}%</Badge>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="rounded-[2.5rem] border-slate-200">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Client Direct Contact</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex items-center gap-3 p-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-colors">
                                <Mail className="w-5 h-5 text-emerald-500" />
                                <span className="truncate text-sm">{client_profile.client_email}</span>
                            </div>
                            <div className="flex items-center gap-3 p-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-colors">
                                <Phone className="w-5 h-5 text-emerald-500" />
                                <span className="text-sm">{client_profile.client_phone}</span>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Internal Notes Feed */}
                    <Card className="rounded-[2.5rem] border-slate-200 flex flex-col h-[500px]">
                        <CardHeader className="pb-4 shrink-0">
                            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 flex items-center justify-between">
                                Internal Communication
                                <Badge variant="outline" className="text-[9px]">{notes.length}</Badge>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col min-h-0 overflow-hidden">
                            {/* Notes List */}
                            <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 custom-scrollbar">
                                {notes.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-center p-8">
                                        <Clock className="w-8 h-8 text-slate-200 mb-2" />
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">No activity yet</p>
                                    </div>
                                ) : (
                                    notes.map((note) => (
                                        <div key={note.id} className="space-y-1">
                                            <div className="flex items-center justify-between">
                                                <span className={clsx(
                                                    "text-[10px] font-black uppercase tracking-tighter px-2 py-0.5 rounded",
                                                    note.author_role === 'underwriting' ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700"
                                                )}>
                                                    {note.author_name}
                                                </span>
                                                <span className="text-[9px] font-bold text-slate-400">
                                                    {format(new Date(note.created_at), 'MMM d, h:mm a')}
                                                </span>
                                            </div>
                                            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                                <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">{note.content}</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Add Note Input */}
                            <div className="shrink-0 space-y-2 pt-4 border-t border-slate-100">
                                <Textarea
                                    placeholder="Type a note..."
                                    className="min-h-[80px] rounded-2xl border-slate-200 text-xs focus:ring-emerald-500"
                                    value={new_standalone_note}
                                    onChange={(e) => set_new_standalone_note(e.target.value)}
                                />
                                <Button
                                    className="w-full h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black uppercase tracking-widest text-[10px]"
                                    onClick={handleAddNote}
                                    disabled={is_adding_note || !new_standalone_note.trim()}
                                >
                                    {is_adding_note ? <Loader2 className="w-4 h-4 animate-spin" /> : "Post Note"}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Documents Column */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Use of Proceeds & Open Positions Section */}
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 gap-6">
                            {/* Use of Proceeds */}
                            <Card className="rounded-[2rem] border-emerald-100 bg-emerald-50/10 overflow-hidden">
                                <CardHeader className="bg-emerald-50/30 pb-3">
                                    <CardTitle className="text-[10px] font-black uppercase tracking-widest text-emerald-800/40">Use of Proceeds</CardTitle>
                                </CardHeader>
                                <CardContent className="p-6">
                                    <p className="text-sm font-bold text-slate-700 leading-relaxed italic">
                                        "{client_profile.loan_purpose || "No use of proceeds specified."}"
                                    </p>
                                </CardContent>
                            </Card>

                            {/* Lender Matching Results */}
                            {render_lender_assignments()}

                            {/* Open Positions Table */}
                            <Card className="rounded-[2.5rem] border-slate-200 overflow-hidden">
                                <CardHeader className="pb-4 border-b border-slate-100">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Open Positions (Previous Debt)</CardTitle>
                                        <Badge variant="outline" className="text-emerald-500 font-black">{open_positions.length}</Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    {open_positions.length === 0 ? (
                                        <div className="p-10 text-center">
                                            <CheckCircle2 className="w-8 h-8 text-emerald-200 mx-auto mb-2" />
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">No open positions reported</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50/50">
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 italic">Lender</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Type</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Balance</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Payment</th>
                                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Term</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {open_positions.map((pos, i) => (
                                                        <tr key={pos.id} className="hover:bg-slate-50/30 transition-colors group">
                                                            <td className="px-6 py-4 border-b border-slate-50">
                                                                <p className="text-sm font-black text-slate-900">{pos.lender_name}</p>
                                                            </td>
                                                            <td className="px-6 py-4 border-b border-slate-50">
                                                                <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none text-[9px] font-black uppercase whitespace-nowrap">
                                                                    {pos.loan_type}
                                                                </Badge>
                                                            </td>
                                                            <td className="px-6 py-4 border-b border-slate-50 font-black text-xs text-slate-700">
                                                                {pos.current_balance ? pos.current_balance.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : "-"}
                                                            </td>
                                                            <td className="px-6 py-4 border-b border-slate-50 font-black text-xs text-emerald-600">
                                                                {pos.payment_amount ? pos.payment_amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : "-"}
                                                            </td>
                                                            <td className="px-6 py-4 border-b border-slate-50">
                                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{pos.payment_term || "-"}</p>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>

                    {/* Required Documents Section */}
                    <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3 ml-2">
                            <FileText className="w-4 h-4" /> Required Review Packet
                        </h3>
                        <div className="space-y-4">
                            {required_docs.map((docType) => render_document_category(docType))}
                        </div>
                    </div>

                    {/* Uncategorized Documents Section */}
                    {documents.filter(d => !required_docs.some(r => r.code === d.category)).length > 0 && (
                        <div className="space-y-4 pt-8 border-t border-slate-100">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3 ml-2">
                                <Plus className="w-4 h-4" /> Miscellaneous Files
                            </h3>
                            <div className="grid grid-cols-1 gap-4">
                                {documents.filter(d => !required_docs.some(r => r.code === d.category)).map(doc => render_document_card(doc))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Document Preview Modal */}
            <DocumentPreviewModal 
                isOpen={preview_modal.isOpen}
                onClose={() => set_preview_modal({ isOpen: false, doc: null })}
                docName={preview_modal.doc?.custom_label || preview_modal.doc?.name || ""}
                storagePath={preview_modal.doc?.storage_path || ""}
                fileType={preview_modal.doc?.type}
            />
        </div>
    );
}
