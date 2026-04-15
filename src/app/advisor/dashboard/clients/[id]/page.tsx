// src/app/advisor/dashboard/clients/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    ArrowLeft,
    AlertCircle,
    Loader2,
    Plus,
    UploadCloud,
    ShieldCheck,
    Trash2,
    X,
    FileSignature,
    Pencil,
    XCircle,
    Download,
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
    requestDocuments,
    deleteClientFile,
    deleteClientVault,
    removeRequestedDocument,
    addManualFundingApplication,
    approveDocumentCategory,
    rejectDocumentCategory,
    renameClientFile,
    generateMagicLink
} from "./actions";
import { fetchInternalNotes, addInternalNote } from "@/app/actions/internal-notes";
import { toast } from "sonner";
import clsx from "clsx";
import { format } from "date-fns";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { EditProfileModal } from "./edit-profile-modal";
import { PIPELINE_STEPS } from "@/components/loan-pipeline-status";
import { getClientPipelineHistory, updateLoanStatus, type LoanStatus, type PipelineStatusEntry } from "@/app/actions/pipeline";
import DocumentPreviewModal from "@/components/pdf/pdf-viewer";

// ── New UI components ─────────────────────────────────────────────────────────
import { ClientProfileHeader } from "./_components/client-profile-header";
import { FundingPipelineCard } from "./_components/funding-pipeline-card";
import { DocumentUploadStatus } from "./_components/document-upload-status";
import { InternalCommunication } from "./_components/internal-communication";
import { SubmitUnderwritingCTA } from "./_components/submit-underwriting-cta";

/**
 * ============================================================================
 * ADVISOR CLIENT DETAILS PAGE
 * ============================================================================
 * 
 * This page allows advisors to:
 * 1. View detailed client profile information
 * 2. See all documents uploaded by the client
 * 3. Download individual documents
 * 4. Track document completion status
 * 
 * DATABASE FLOW:
 * 1. Get client_id from URL params
 * 2. Fetch client_data_vault record for this client
 * 3. Verify the advisor owns this client (advisor_id check)
 * 4. Fetch all user_documents for this client
 * 
 * ARCHITECTURE:
 * - Protected route - only shows if advisor created this client
 * - Real-time document view with download capability
 * - Organized by document category
 * - Shows both required and additional documents
 * ============================================================================
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

/**
 * component-state-enum: Enum for different component states
 */
enum ComponentState {
    LOADING = "LOADING",
    ERROR = "ERROR",
    SUCCESS = "SUCCESS",
    ACCESS_DENIED = "ACCESS_DENIED",
}

/**
 * client-profile: Structure for client profile data
 */
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
    data_vault_submitted_at: string | null;
    contract_completed: boolean;
    contract_completed_at: string | null;
    company_zip_code?: string;
    avg_annual_revenue?: number;
    loan_purpose?: string;
    proposed_loan_type?: string;
    funding_eta?: string;
    employees_count?: number;
    is_home_based?: boolean | null;
}

/**
 * user-document: Structure for uploaded document
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
}

interface InternalNote {
    id: string;
    author_name: string;
    author_role: string;
    content: string;
    created_at: string;
}

// Note: REQUIRED_DOC_TYPES is now fetched dynamically from the database
// for each client to match the specific requests made during signup.

export default function AdvisorClientDetailsPage() {
    // ============================================
    // STATE MANAGEMENT
    // ============================================

    const supabase = createClient();
    const router = useRouter();
    const params = useParams();
    const client_id = params.id as string;

    // component-state: Single source of truth for component state
    const [component_state, set_component_state] = useState<ComponentState>(
        ComponentState.LOADING
    );

    // client-profile-state: Stores client profile information
    const [client_profile, set_client_profile] = useState<ClientProfile | null>(null);

    // documents-state: Stores all client documents
    const [documents, set_documents] = useState<UserDocument[]>([]);

    // required-docs-state: Stores dynamic document requirements for this client
    const [required_docs, set_required_docs] = useState<{ code: string; label: string }[]>([]);

    // all-available-docs-state: Stores all possible document types for request
    const [all_doc_types, set_all_doc_types] = useState<{ id: string; code: string; label: string }[]>([]);

    // request-modal-state: UI controls for the request dialog
    const [is_request_modal_open, set_is_request_modal_open] = useState(false);
    const [selected_doc_ids, set_selected_doc_ids] = useState<string[]>([]);
    const [request_search_query, set_request_search_query] = useState("");
    const [is_requesting, set_is_requesting] = useState(false);

    // resend-credentials-state: Tracks loading state for credential resend
    const [is_resending, set_is_resending] = useState(false);
    const [is_generating_magic_link, set_is_generating_magic_link] = useState(false);

    // upload-for-client-state: Controls for advisor document upload modal
    const [is_upload_modal_open, set_is_upload_modal_open] = useState(false);
    const [upload_doc_code, set_upload_doc_code] = useState<string>("");
    const [upload_doc_label, set_upload_doc_label] = useState<string>("");
    const [upload_files, set_upload_files] = useState<File[]>([]);
    const [is_uploading, set_is_uploading] = useState(false);

    // vault-submit-state: Controls for advisor vault submission
    const [is_submit_confirm_open, set_is_submit_confirm_open] = useState(false);
    const [is_submitting_vault, set_is_submitting_vault] = useState(false);
    const [vault_submitted, set_vault_submitted] = useState(false);
    const [submission_status, set_submission_status] = useState<string | null>(null);

    // error-message-state: Stores specific error message
    const [error_message, set_error_message] = useState<string>("");

    // Manual Funding Application state
    const [is_manual_funding_modal_open, set_is_manual_funding_modal_open] = useState(false);
    const [funding_file, set_funding_file] = useState<File | null>(null);
    const [is_uploading_funding, set_is_uploading_funding] = useState(false);

    // Internal Notes state
    const [notes, set_notes] = useState<InternalNote[]>([]);
    const [new_standalone_note, set_new_standalone_note] = useState("");
    const [is_adding_note, set_is_adding_note] = useState(false);

    // Edit Profile state
    const [is_edit_modal_open, set_is_edit_modal_open] = useState(false);

    // Delete File state
    const [is_delete_file_modal_open, set_is_delete_file_modal_open] = useState(false);
    const [file_to_delete, set_file_to_delete] = useState<UserDocument | null>(null);
    const [is_deleting_file, set_is_deleting_file] = useState(false);

    // Delete Vault state
    const [is_delete_vault_modal_open, set_is_delete_vault_modal_open] = useState(false);
    const [is_deleting_vault, set_is_deleting_vault] = useState(false);

    // Remove Request state
    const [is_remove_request_modal_open, set_is_remove_request_modal_open] = useState(false);
    const [doc_to_remove_request, set_doc_to_remove_request] = useState<{ code: string; label: string } | null>(null);
    const [is_removing_request, set_is_removing_request] = useState(false);

    // Pipeline state
    const [pipeline_history, set_pipeline_history] = useState<PipelineStatusEntry[]>([]);
    const [current_pipeline_status, set_current_pipeline_status] = useState<LoanStatus>("created");

    // Rejection state
    const [is_reject_modal_open, set_is_reject_modal_open] = useState(false);
    const [reject_doc_type, set_reject_doc_type] = useState<{ code: string; label: string } | null>(null);
    const [reject_reason, set_reject_reason] = useState("");
    const [is_rejecting, set_is_rejecting] = useState(false);

    // Approval state
    const [is_approving_modal_open, setIs_approving_modal_open] = useState(false);
    const [category_to_approve, set_category_to_approve] = useState<{ code: string; label: string } | null>(null);
    const [is_approving, set_is_approving] = useState(false);

    // NEW: Document Management UX State
    const [approvals, set_approvals] = useState<Set<string>>(new Set());
    const [expanded_categories, set_expanded_categories] = useState<Set<string>>(new Set());
    const [preview_modal, set_preview_modal] = useState<{ isOpen: boolean; doc: UserDocument | null }>({
        isOpen: false,
        doc: null
    });
    const [renaming_file, set_renaming_file] = useState<{ id: string; label: string } | null>(null);
    const [is_renaming_loading, setIs_renaming_loading] = useState(false);
    const [is_approving_loading, setIs_approving_loading] = useState(false);

    // ============================================
    // FETCH CLIENT DATA ON MOUNT
    // ============================================
    useEffect(() => {
        if (client_id) {
            fetch_client_details();
        }
    }, [client_id]);

    /**
     * fetch-client-details: Main function to retrieve client profile and documents
     * 
     * SECURITY: Verifies that the current advisor created this client
     * Only advisors who created the client can view their details
     * 
     * QUERY FLOW:
     * 1. Authenticate and get current user
     * 2. Get advisor profile ID from advisors table (links users → advisors)
     * 3. Fetch client profile from client_data_vault
     * 4. Verify advisor ownership (client.advisor_id === advisor.id)
     * 5. Fetch all documents for this client
     */
    async function fetch_client_details() {
        try {
            set_component_state(ComponentState.LOADING);

            // ============================================
            // STEP 1: AUTHENTICATE AND GET ADVISOR ID
            // ============================================
            const { data: { user }, error: auth_error } = await supabase.auth.getUser();

            if (auth_error || !user) {
                console.error("❌ Authentication error:", auth_error);
                set_error_message("Authentication failed. Please log in again.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            console.log("✅ User authenticated:", user.id);

            // ============================================
            // STEP 2: GET ADVISOR PROFILE ID
            // The advisors table is separate from users table
            // We need to find the advisor record that matches this user
            // ============================================

            // First verify user is an advisor
            const { data: user_data, error: user_error } = await supabase
                .from("users")
                .select("id, role, email")
                .eq("id", user.id)
                .maybeSingle();

            if (user_error || !user_data || user_data.role !== "advisor") {
                console.error("❌ User is not an advisor");
                set_error_message("Access denied. You must be an advisor to view this page.");
                set_component_state(ComponentState.ACCESS_DENIED);
                return;
            }

            // Try Option 1: Link via user_id (if column exists)
            let advisor_query = supabase
                .from("advisors")
                .select("id, first_name, last_name, email")
                .eq("user_id", user.id)
                .maybeSingle();

            let { data: advisor_data, error: advisor_error } = await advisor_query;

            // If user_id column doesn't exist or no match, try Option 2: Link via email
            if (!advisor_data && !advisor_error) {
                console.log("⚠️ No advisor found by user_id, trying email match...");
                const email_query = await supabase
                    .from("advisors")
                    .select("id, first_name, last_name, email")
                    .eq("email", user_data.email)
                    .maybeSingle();

                advisor_data = email_query.data;
                advisor_error = email_query.error;
            }

            if (advisor_error) {
                console.error("❌ Error fetching advisor profile:", advisor_error);
                set_error_message("Could not load advisor profile. Please contact support.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            if (!advisor_data) {
                console.error("❌ No advisor profile found for this user");
                set_error_message(
                    "No advisor profile found. Please contact support to set up your advisor account."
                );
                set_component_state(ComponentState.ERROR);
                return;
            }

            console.log("✅ Advisor profile found:", advisor_data.id);

            // ============================================
            // STEP 3: FETCH CLIENT PROFILE
            // Query client_data_vault for this specific client
            // ============================================
            const { data: client_data, error: client_error } = await supabase
                .from("client_data_vault")
                .select(`
          id,
          user_id,
          advisor_id,
          client_name,
          client_email,
          client_phone,
          company_name,
          company_city,
          company_state,
          capital_requested,
          legal_entity_type,
          business_start_date,
          avg_monthly_deposits,
          credit_score,
          created_at,
          data_vault_submitted_at,
          contract_completed,
          contract_completed_at,
          company_zip_code,
          avg_annual_revenue,
          loan_purpose,
          proposed_loan_type,
          funding_eta,
          employees_count,
          is_home_based
        `)
                .eq("id", client_id)
                .maybeSingle();

            if (client_error) {
                console.error("❌ Error fetching client:", client_error);
                set_error_message("Error loading client information.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            if (!client_data) {
                console.error("❌ Client not found");
                set_error_message("Client not found.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            // ============================================
            // STEP 4: VERIFY ADVISOR OWNERSHIP
            // Security check: Only the advisor who created this client can view
            // Compare advisor_id in client record with advisor profile ID
            // ============================================
            if (client_data.advisor_id !== advisor_data.id) {
                console.error("❌ Access denied: Advisor does not own this client");
                console.error(`   Client advisor_id: ${client_data.advisor_id}`);
                console.error(`   Current advisor_id: ${advisor_data.id}`);
                set_error_message("You do not have permission to view this client.");
                set_component_state(ComponentState.ACCESS_DENIED);
                return;
            }

            console.log("✅ Client profile loaded:", client_data.client_name);
            set_client_profile(client_data as ClientProfile);
            // Reflect any existing submission state
            set_vault_submitted(!!client_data.data_vault_submitted_at);

            // ============================================
            // STEP 5: FETCH CLIENT'S DOCUMENTS
            // Query user_documents table for all uploads by this client
            // ============================================
            const { data: docs_data, error: docs_error } = await supabase
                .from("user_documents")
                .select("*")
                .eq("user_id", client_data.user_id)
                .order("upload_date", { ascending: false });

            if (docs_error) {
                console.error("❌ Error fetching documents:", docs_error);
                // Don't fail the entire page if docs fail to load
                set_documents([]);
            } else {
                console.log(`✅ Loaded ${docs_data?.length || 0} documents`);
                set_documents(docs_data || []);
            }

            // ============================================
            // STEP 6: FETCH DYNAMIC REQUIREMENTS
            // Query client_dynamic_documents to see what was actually requested
            // ============================================
            const { data: dynamic_requirements, error: req_error } = await supabase
                .from("client_dynamic_documents")
                .select(`
                    required_documents!inner (
                        code,
                        label
                    )
                `)
                .eq("user_id", client_data.user_id)
                .eq("is_active", true);

            if (req_error) {
                console.error("❌ Error fetching requirements:", req_error);
                // Fallback to basic documents if query fails
                set_required_docs([
                    { code: "business_bank_statements", label: "Bank Statements" },
                    { code: "drivers_license", label: "Driver's License" },
                    { code: "voided_check", label: "Voided Check" }
                ]);
            } else {
                const formatted_reqs = (dynamic_requirements || [])
                    .map((item: any) => item.required_documents)
                    .filter((doc: any) => doc.code !== 'funding_application'); // Skip auto-generated app

                console.log(`✅ Loaded ${formatted_reqs.length} dynamic requirements`);
                set_required_docs(formatted_reqs);

                // ============================================
                // STEP 7: FETCH ALL AVAILABLE DOC TYPES
                // Used for the "Request New Document" selection modal
                // ============================================
                const { data: all_docs, error: all_docs_error } = await supabase
                    .from("required_documents")
                    .select("id, code, label")
                    .order("label", { ascending: true });

                if (all_docs_error) {
                    console.error("❌ Error fetching doc types:", all_docs_error);
                } else {
                    set_all_doc_types(all_docs || []);
                }
            }

            // ============================================
            // STEP 8: FETCH SUBMISSION STATUS
            // ============================================
            const { data: sub_data } = await supabase
                .from("submissions")
                .select("status")
                .eq("user_id", client_data.user_id)
                .maybeSingle();

            set_submission_status(sub_data?.status || null);
            // Updated vault_submitted to be more reflective of the active status
            set_vault_submitted(sub_data?.status === 'locked');

            // ============================================
            // STEP 8: FETCH INTERNAL NOTES
            // ============================================
            const notes_res = await fetchInternalNotes(client_id);
            if (notes_res.success) {
                set_notes(notes_res.notes || []);
            }

            // ============================================
            // STEP 10: FETCH PIPELINE HISTORY
            // ============================================
            const history = await getClientPipelineHistory(client_id);
            if (history) {
                set_pipeline_history(history);
                if (history.length > 0) {
                    // Sort by date to get the latest status
                    const sortedHistory = [...history].sort((a, b) =>
                        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                    );
                    set_current_pipeline_status(sortedHistory[0].status as LoanStatus);
                }
            }

            // ============================================
            // STEP 8: FETCH DOCUMENT CATEGORY APPROVALS
            // ============================================
            const { data: approvals_data, error: approvals_error } = await supabase
                .from("document_category_approvals")
                .select("doc_code")
                .eq("client_vault_id", client_id);

            if (approvals_error) {
                console.error("❌ Error fetching approvals:", approvals_error);
            } else {
                set_approvals(new Set(approvals_data.map(a => a.doc_code)));
            }

            set_component_state(ComponentState.SUCCESS);
        } catch (error: any) {
            console.error("❌ Unexpected error:", error);
            set_error_message(error.message || "An unexpected error occurred.");
            set_component_state(ComponentState.ERROR);
        }
    }

    // ============================================
        // NEW: HELPER FUNCTIONS FOR DOCUMENT UX
        // ============================================

        /**
         * toggle_category_expansion: Expands/collapses a doc category
         */
        const toggle_category_expansion = (code: string) => {
            const new_expanded = new Set(expanded_categories);
            if (new_expanded.has(code)) {
                new_expanded.delete(code);
            } else {
                new_expanded.add(code);
            }
            set_expanded_categories(new_expanded);
        };

        /**
         * handle_approve_category: Records advisor approval for a category
         */
        async function handle_approve_category() {
            if (!category_to_approve) return;

            setIs_approving_loading(true);
            try {
                const result = await approveDocumentCategory(client_id, category_to_approve.code);
                if (result.success) {
                    toast.success(`Category "${category_to_approve.label}" approved!`);
                    const new_approvals = new Set(approvals);
                    new_approvals.add(category_to_approve.code);
                    set_approvals(new_approvals);
                    setIs_approving_modal_open(false);
                    set_category_to_approve(null);
                } else {
                    toast.error(result.error || "Failed to approve category.");
                }
            } catch (error) {
                toast.error("An unexpected error occurred.");
            } finally {
                setIs_approving_loading(false);
            }
        }

        /**
         * handle_rename_submit: Inline rename of a file
         */
        async function handle_rename_submit(newLabel: string) {
            if (!renaming_file || !newLabel.trim()) return;

            setIs_renaming_loading(true);
            try {
                const result = await renameClientFile(client_id, renaming_file.id, newLabel.trim());
                if (result.success) {
                    toast.success("File renamed successfully");
                    set_documents(prev => prev.map(d =>
                        d.id === renaming_file.id ? { ...d, custom_label: newLabel.trim() } : d
                    ));
                    set_renaming_file(null);
                } else {
                    toast.error(result.error || "Failed to rename file.");
                }
            } catch (error) {
                toast.error("An unexpected error occurred.");
            } finally {
                setIs_renaming_loading(false);
            }
        }

        /**
         * handle_copy_magic_link: Generates and copies a magic login link
         */
        async function handle_copy_magic_link() {
            set_is_generating_magic_link(true);
            try {
                const result = await generateMagicLink(client_id);
                if (result.success && result.link) {
                    await navigator.clipboard.writeText(result.link);
                    toast.success("Magic link copied to clipboard!");
                } else {
                    toast.error(result.error || "Failed to generate magic link.");
                }
            } catch (err: any) {
                console.error("❌ Magic link error:", err);
                toast.error("An unexpected error occurred");
            } finally {
                set_is_generating_magic_link(false);
            }
        }

        /**
         * OutstandingDocumentsBanner: UI component for the top alert
         */
        function render_outstanding_banner(required_docs: { code: string; label: string }[]) {
            const outstanding = required_docs.filter(
                doc_type => !approvals.has(doc_type.code) || get_documents_by_category(doc_type.code).length === 0
            );

            const missing_uploads = required_docs.filter(
                doc_type => get_documents_by_category(doc_type.code).length === 0
            );

            if (outstanding.length === 0) return null;

            return (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 shadow-sm">
                    <div className="flex items-start gap-4">
                        <div className="bg-amber-100 p-2 rounded-lg">
                            <AlertCircle className="h-6 w-6 text-amber-600" />
                        </div>
                        <div className="flex-1">
                            <h4 className="text-amber-900 font-bold text-sm uppercase tracking-wider mb-1">
                                Action Required: {outstanding.length} Outstanding Items
                            </h4>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {outstanding.map(doc => {
                                    const is_pending_upload = get_documents_by_category(doc.code).length === 0;
                                    return (
                                        <Badge
                                            key={doc.code}
                                            variant="outline"
                                            className={clsx(
                                                "cursor-pointer hover:shadow-md transition-all px-3 py-1 border-2",
                                                is_pending_upload
                                                    ? "bg-red-50 text-red-700 border-red-200"
                                                    : "bg-yellow-50 text-yellow-700 border-yellow-200"
                                            )}
                                            onClick={() => {
                                                // Expand and scroll to category
                                                if (!expanded_categories.has(doc.code)) {
                                                    toggle_category_expansion(doc.code);
                                                }
                                                const el = document.getElementById(`category-${doc.code}`);
                                                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                            }}
                                        >
                                            {doc.label} {is_pending_upload ? "(Missing)" : "(Pending Approval)"}
                                        </Badge>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        /**
         * download-document: Downloads a document from Supabase storage
         * Creates a temporary download link and triggers browser download
         */
        async function download_document(doc: UserDocument) {
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
                console.error("❌ Download error:", err);
                toast.error(`Error downloading ${doc.name}. Please try again.`);
            }
        }

        /**
         * download_all_documents: Downloads all documents in a category sequentially
         */
        async function download_all_documents(docs: UserDocument[]) {
            if (docs.length === 0) return;

            toast.info(`Preparing to download ${docs.length} files...`);

            // Use a for...of loop for sequential downloads with delays
            for (let i = 0; i < docs.length; i++) {
                const doc = docs[i];
                await download_document(doc);

                // Add a small delay between downloads to ensure browser captures all of them
                if (i < docs.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
            }

            toast.success("All downloads initiated!");
        }

        /**
         * get-documents-by-category: Groups documents by their category
         */
        function get_documents_by_category(category_code: string): UserDocument[] {
            return documents.filter(doc => doc.category === category_code);
        }

        /**
         * format-date: Formats ISO date string to readable format
         */
        function format_date(iso_string: string): string {
            const date = new Date(iso_string);
            return date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric"
            });
        }

        /**
         * format-currency: Formats number as USD currency
         */
        function format_currency(amount: number): string {
            return new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(amount);
        }

        /**
         * format-file-size: Formats bytes to readable file size
         */
        function format_file_size(bytes: number): string {
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
            return (bytes / (1024 * 1024)).toFixed(1) + " MB";
        }

        /**
         * handle-advisor-upload: Uploads selected files on behalf of the client
         * Sends multipart/form-data to the new advisor-specific upload endpoint
         */
        async function handle_advisor_upload() {
            if (upload_files.length === 0 || !upload_doc_code) return;

            set_is_uploading(true);
            try {
                const form = new FormData();
                form.append('client_id', client_id);
                form.append('doc_code', upload_doc_code);
                upload_files.forEach(f => form.append('file', f));

                const res = await fetch('/api/advisor/clients/upload', {
                    method: 'POST',
                    body: form,
                });
                const result = await res.json();

                if (result.success) {
                    toast.success(`${result.uploaded} file(s) uploaded successfully!`);
                    set_is_upload_modal_open(false);
                    set_upload_files([]);
                    set_upload_doc_code("");
                    fetch_client_details(); // Refresh to show new docs
                } else {
                    toast.error(result.error || 'Upload failed');
                }
            } catch (err: any) {
                console.error('❌ Upload error:', err);
                toast.error('An unexpected error occurred during upload');
            } finally {
                set_is_uploading(false);
            }
        }

        /**
         * handle_status_change: Updates the client's loan pipeline status
         */
        async function handle_status_change(newStatus: LoanStatus, note: string = "Updated by advisor") {
            try {
                const res = await updateLoanStatus(client_id, newStatus, note);
                if (res.success) {
                    // Refresh state
                    const history = await getClientPipelineHistory(client_id);
                    set_pipeline_history(history);
                    set_current_pipeline_status(newStatus);
                    toast.success(`Pipeline updated to ${newStatus}`);
                } else {
                    toast.error("Failed to update pipeline");
                }
            } catch (err) {
                console.error('❌ Pipeline update error:', err);
                toast.error("Error updating pipeline");
            }
        }

        /**
         * handle-submit-vault: Submits the client's vault to underwriting via advisor endpoint
         */
        async function handle_submit_vault() {
            set_is_submitting_vault(true);
            try {
                const res = await fetch('/api/advisor/clients/submit-vault', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client_id }),
                });
                const result = await res.json();

                if (result.success) {
                    toast.success('Vault submitted to underwriting successfully!');
                    set_vault_submitted(true);
                    set_is_submit_confirm_open(false);
                    fetch_client_details(); // Refresh pipeline status
                } else {
                    toast.error(result.error || 'Submission failed');
                }
            } catch (err: any) {
                console.error('❌ Submit vault error:', err);
                toast.error('An unexpected error occurred');
            } finally {
                set_is_submitting_vault(false);
            }
        }

        /**
         * handle-resend-credentials: Calls the API to reset the client's password
         * and resend their login credentials via email
         */
        async function handle_resend_credentials() {
            set_is_resending(true);
            try {
                const response = await fetch('/api/clients/resend-credentials', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client_id }),
                });

                const result = await response.json();

                if (result.success) {
                    toast.success('Login credentials sent! Check the client\'s inbox.');
                } else {
                    toast.error(result.error || 'Failed to resend credentials');
                }
            } catch (err: any) {
                console.error('❌ Resend error:', err);
                toast.error('An unexpected error occurred');
            } finally {
                set_is_resending(false);
            }
        }

        /**
         * handle_reject_category: Processes a document category rejection
         */
        async function handle_reject_category() {
            if (!reject_doc_type) return;
            if (!reject_reason.trim()) {
                toast.error("Please provide a reason for rejection");
                return;
            }

            set_is_rejecting(true);
            try {
                const result = await rejectDocumentCategory(
                    client_id, 
                    reject_doc_type.code, 
                    reject_doc_type.label, 
                    reject_reason
                );

                if (result.success) {
                    toast.success(`${reject_doc_type.label} rejected. Client has been notified.`);
                    set_is_reject_modal_open(false);
                    set_reject_reason("");
                    
                    // Refresh data
                    await fetch_client_details();
                } else {
                    toast.error(result.error || "Failed to reject category");
                }
            } catch (err: any) {
                console.error("❌ Rejection error:", err);
                toast.error("An unexpected error occurred during rejection");
            } finally {
                set_is_rejecting(false);
            }
        }

        /**
         * handle_manual_funding_upload: Uploads a manually signed funding application
         */
        async function handle_manual_funding_upload() {
            if (!funding_file) {
                toast.error("Please select a file to upload");
                return;
            }

            set_is_uploading_funding(true);
            try {
                const formData = new FormData();
                formData.append("file", funding_file);

                const result = await addManualFundingApplication(client_id, formData);

                if (result.success) {
                    toast.success("Funding application uploaded and synced successfully!");
                    set_is_manual_funding_modal_open(false);
                    set_funding_file(null);
                    fetch_client_details(); // Refresh page data
                } else {
                    toast.error(result.error || "Failed to upload funding application");
                }
            } catch (error: any) {
                console.error("Manual upload error:", error);
                toast.error("An unexpected error occurred during upload");
            } finally {
                set_is_uploading_funding(false);
            }
        }

        /**
         * handle-request-document: Triggers the server action to request multiple new documents
         */
        async function handle_request_document() {
            if (selected_doc_ids.length === 0) {
                toast.error("Please select at least one document");
                return;
            }

            set_is_requesting(true);
            try {
                const result = await requestDocuments(client_id, selected_doc_ids);

                if (result.success) {
                    toast.success(`${selected_doc_ids.length} document(s) requested successfully!`);
                    set_is_request_modal_open(false);
                    set_selected_doc_ids([]);
                    set_request_search_query("");
                    // Refresh data to show new requirements
                    fetch_client_details();
                } else {
                    toast.error(result.error || "Failed to request documents");
                }
            } catch (err: any) {
                console.error("❌ Request error:", err);
                toast.error("An unexpected error occurred");
            } finally {
                set_is_requesting(false);
            }
        }

        async function handle_add_note() {
            if (!new_standalone_note.trim()) return;

            set_is_adding_note(true);
            try {
                const result = await addInternalNote(client_id, new_standalone_note, "advisor");
                if (result.success) {
                    toast.success("Note added!");
                    set_new_standalone_note("");
                    // Refresh notes
                    const notes_res = await fetchInternalNotes(client_id);
                    if (notes_res.success && notes_res.notes) set_notes(notes_res.notes);
                } else {
                    toast.error(result.error || "Failed to add note");
                }
            } catch (err: any) {
                console.error("❌ Add note error:", err);
                toast.error("An unexpected error occurred");
            } finally {
                set_is_adding_note(false);
            }
        }

        async function handle_delete_file() {
            if (!file_to_delete) return;

            set_is_deleting_file(true);
            try {
                const result = await deleteClientFile(client_id, file_to_delete.id);
                if (result.success) {
                    toast.success("File deleted successfully");
                    set_is_delete_file_modal_open(false);
                    set_file_to_delete(null);
                    fetch_client_details(); // Refresh documents
                } else {
                    toast.error(result.error || "Failed to delete file");
                }
            } catch (err: any) {
                console.error("❌ Delete file error:", err);
                toast.error("An unexpected error occurred");
            } finally {
                set_is_deleting_file(false);
            }
        }

        async function handle_delete_vault() {
            set_is_deleting_vault(true);
            try {
                const result = await deleteClientVault(client_id);
                if (result.success) {
                    toast.success("Client vault deleted successfully");
                    router.push("/advisor/dashboard/clients");
                } else {
                    toast.error(result.error || "Failed to delete vault");
                }
            } catch (err: any) {
                console.error("❌ Delete vault error:", err);
                toast.error("An unexpected error occurred");
            } finally {
                set_is_deleting_vault(false);
            }
        }

        async function handle_remove_request() {
            if (!doc_to_remove_request) return;

            set_is_removing_request(true);
            try {
                const result = await removeRequestedDocument(client_id, doc_to_remove_request.code);
                if (result.success) {
                    toast.success(`Request for ${doc_to_remove_request.label} removed`);
                    set_is_remove_request_modal_open(false);
                    set_doc_to_remove_request(null);
                    fetch_client_details(); // Refresh requirements
                } else {
                    toast.error(result.error || "Failed to remove request");
                }
            } catch (err: any) {
                console.error("❌ Remove request error:", err);
                toast.error("An unexpected error occurred");
            } finally {
                set_is_removing_request(false);
            }
        }

        // ============================================
        // RENDER FUNCTIONS FOR DIFFERENT STATES
        // ============================================

        /**
         * render-loading-state: Shows loading spinner
         */
        function render_loading_state() {
            return (
                <div className="flex flex-col items-center justify-center min-h-[400px]">
                    <Loader2 className="h-12 w-12 text-emerald-600 animate-spin mb-4" />
                    <p className="text-gray-600">Loading client details...</p>
                </div>
            );
        }

        /**
         * render-error-state: Shows error message
         */
        function render_error_state() {
            return (
                <div className="flex flex-col items-center justify-center min-h-[400px]">
                    <div className="bg-red-50 border border-red-200 rounded-xl p-8 max-w-md text-center">
                        <AlertCircle className="h-12 w-12 text-red-600 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            Error Loading Client
                        </h3>
                        <p className="text-gray-600 mb-4">{error_message}</p>
                        <Button
                            onClick={() => router.push("/advisor/dashboard/clients")}
                            variant="outline"
                        >
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Clients
                        </Button>
                    </div>
                </div>
            );
        }

        /**
         * render-access-denied-state: Shows access denied message
         */
        function render_access_denied_state() {
            return (
                <div className="flex flex-col items-center justify-center min-h-[400px]">
                    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-8 max-w-md text-center">
                        <AlertCircle className="h-12 w-12 text-yellow-600 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            Access Denied
                        </h3>
                        <p className="text-gray-600 mb-4">
                            You do not have permission to view this client's information.
                        </p>
                        <Button
                            onClick={() => router.push("/advisor/dashboard/clients")}
                            variant="outline"
                        >
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Clients
                        </Button>
                    </div>
                </div>
            );
        }


        /**
         * render-success-state: Orchestrates the new component-based UI
         */
        function render_success_state() {
            if (!client_profile) return null;

            const total_required = required_docs.length;
            const completed_categories = required_docs.filter(
                doc_type => approvals.has(doc_type.code)
            ).length;
            const completion_percentage = total_required > 0
                ? Math.round((completed_categories / total_required) * 100)
                : 100;

            return (
                <div className="space-y-6">
                    {/* Back button */}
                    <Button
                        variant="ghost"
                        onClick={() => router.push("/advisor/dashboard/clients")}
                        className="-ml-2 text-slate-500 hover:text-slate-900"
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Clients
                    </Button>

                    {/* Outstanding actions banner */}
                    {render_outstanding_banner(required_docs)}

                    {/* ── Profile Header ────────────────────────────────── */}
                    <ClientProfileHeader
                        client_profile={client_profile}
                        completion_percentage={completion_percentage}
                        is_resending={is_resending}
                        is_generating_magic_link={is_generating_magic_link}
                        on_edit={() => set_is_edit_modal_open(true)}
                        on_delete_vault={() => set_is_delete_vault_modal_open(true)}
                        on_resend={handle_resend_credentials}
                        on_copy_magic_link={handle_copy_magic_link}
                        on_add_funding_app={() => set_is_manual_funding_modal_open(true)}
                    />

                    {/* ── Funding Pipeline ──────────────────────────────── */}
                    <FundingPipelineCard
                        current_pipeline_status={current_pipeline_status}
                        pipeline_history={pipeline_history}
                        on_status_change={(status) => handle_status_change(status, "Set by advisor")}
                    />

                    {/* ── Docs + Communication 2-col grid ───────────────── */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Left: document accordion */}
                        <div className="lg:col-span-2">
                            <DocumentUploadStatus
                                required_docs={required_docs}
                                documents={documents}
                                approvals={approvals}
                                expanded_categories={expanded_categories}
                                completion_percentage={completion_percentage}
                                on_toggle_expand={toggle_category_expansion}
                                on_request_docs={() => set_is_request_modal_open(true)}
                                on_upload={(code, label) => {
                                    set_upload_doc_code(code);
                                    set_upload_doc_label(label);
                                    set_upload_files([]);
                                    set_is_upload_modal_open(true);
                                }}
                                on_approve={(doc) => {
                                    set_category_to_approve(doc);
                                    setIs_approving_modal_open(true);
                                }}
                                on_reject={(doc) => {
                                    set_reject_doc_type(doc);
                                    set_is_reject_modal_open(true);
                                }}
                                on_remove_request={(doc) => {
                                    set_doc_to_remove_request(doc);
                                    set_is_remove_request_modal_open(true);
                                }}
                                on_preview={(doc) => set_preview_modal({ isOpen: true, doc })}
                                on_download={download_document}
                                on_download_all={download_all_documents}
                                on_delete_file={(doc) => {
                                    set_file_to_delete(doc);
                                    set_is_delete_file_modal_open(true);
                                }}
                                on_rename={(doc) => set_renaming_file({ id: doc.id, label: doc.custom_label || doc.name })}
                            />
                        </div>

                        {/* Right: internal communication */}
                        <div>
                            <InternalCommunication
                                notes={notes}
                                new_note={new_standalone_note}
                                is_adding={is_adding_note}
                                on_note_change={set_new_standalone_note}
                                on_add_note={handle_add_note}
                            />
                        </div>
                    </div>

                    {/* ── Submit to Underwriting CTA ────────────────────── */}
                    <SubmitUnderwritingCTA
                        client_name={client_profile.client_name}
                        completion_percentage={completion_percentage}
                        submission_status={submission_status}
                        submitted_at={client_profile.data_vault_submitted_at}
                        is_submitting={is_submitting_vault}
                        on_submit={() => set_is_submit_confirm_open(true)}
                    />

                    {/* Document Preview Modal */}
                    <DocumentPreviewModal
                        isOpen={preview_modal.isOpen}
                        onClose={() => set_preview_modal({ isOpen: false, doc: null })}
                        docName={preview_modal.doc?.custom_label || preview_modal.doc?.name || ""}
                        storagePath={preview_modal.doc?.storage_path || ""}
                        fileType={preview_modal.doc?.type}
                    />

                    {/* Rename File Dialog */}
                    <Dialog open={!!renaming_file} onOpenChange={(open) => !open && set_renaming_file(null)}>
                        <DialogContent className="sm:max-w-md bg-white border-2 border-blue-100 rounded-3xl overflow-hidden p-0">
                            <div className="bg-blue-600 p-6 text-white">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="bg-white/20 p-2 rounded-xl">
                                        <Pencil className="h-5 w-5" />
                                    </div>
                                    <DialogTitle className="text-xl font-bold tracking-tight">Rename Document</DialogTitle>
                                </div>
                                <DialogDescription className="text-blue-100 font-medium">
                                    Give this file a descriptive name for better organization.
                                </DialogDescription>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="new-name" className="text-gray-900 font-black uppercase tracking-widest text-[10px]">New File Name</Label>
                                    <Input
                                        id="new-name"
                                        defaultValue={renaming_file?.label}
                                        placeholder="e.g., Bank Statement Jan 2024"
                                        className="h-12 border-2 border-gray-100 focus:border-blue-500 rounded-2xl font-medium"
                                        onBlur={(e) => set_renaming_file(prev => prev ? { ...prev, label: e.target.value } : null)}
                                    />
                                </div>
                                <DialogFooter className="flex sm:justify-between items-center bg-gray-50 -mx-6 -mb-6 p-6 mt-4 border-t border-gray-100">
                                    <Button
                                        variant="ghost"
                                        onClick={() => set_renaming_file(null)}
                                        className="font-bold text-gray-500 uppercase tracking-widest text-[10px] hover:bg-gray-200"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={() => handle_rename_submit(renaming_file?.label || "")}
                                        disabled={is_renaming_loading}
                                        className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-10 px-6 font-black uppercase tracking-widest text-[10px] shadow-lg shadow-blue-600/20"
                                    >
                                        {is_renaming_loading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                                        Save New Name
                                    </Button>
                                </DialogFooter>
                            </div>
                        </DialogContent>
                    </Dialog>

                    {/* Categories Approval Confirmation Dialog */}
                    <Dialog open={is_approving_modal_open} onOpenChange={(open) => !open && setIs_approving_modal_open(false)}>
                        <DialogContent className="sm:max-w-md bg-white border-2 border-emerald-100 rounded-3xl overflow-hidden p-0">
                            <div className="bg-emerald-600 p-8 text-white text-center">
                                <div className="bg-white/20 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
                                    <ShieldCheck className="h-8 w-8" />
                                </div>
                                <DialogTitle className="text-2xl font-black tracking-tight mb-2 uppercase">Review Completed?</DialogTitle>
                                <DialogDescription className="text-emerald-50 font-medium">
                                    Did you review all files on this category?
                                    <br />
                                    <span className="block mt-2 opacity-80 text-xs italic text-emerald-100">
                                        "{category_to_approve?.label}"
                                    </span>
                                </DialogDescription>
                            </div>
                            <div className="p-8">
                                <p className="text-gray-600 text-sm leading-relaxed text-center mb-6">
                                    Marking this as approved will update the client's progress and notify them that these documents are verified.
                                </p>
                                <div className="grid grid-cols-2 gap-4">
                                    <Button
                                        variant="outline"
                                        onClick={() => setIs_approving_modal_open(false)}
                                        className="border-2 border-gray-100 hover:bg-gray-50 text-gray-500 font-bold uppercase tracking-widest text-[10px] h-12 rounded-2xl"
                                    >
                                        No, Keep Reviewing
                                    </Button>
                                    <Button
                                        onClick={handle_approve_category}
                                        disabled={is_approving_loading}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-[10px] h-12 rounded-2xl shadow-xl shadow-emerald-600/20"
                                    >
                                        {is_approving_loading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                                        Yes, All Good!
                                    </Button>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>

                    {/* Advisor upload modal */}
                    <Dialog open={is_upload_modal_open} onOpenChange={(open) => {
                        if (!is_uploading) {
                            set_is_upload_modal_open(open);
                            if (!open) set_upload_files([]);
                        }
                    }}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Upload Document for Client</DialogTitle>
                                <DialogDescription>
                                    Upload <strong>{upload_doc_label || upload_doc_code}</strong> on behalf of {client_profile.client_name}.
                                    The file will appear in their vault.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="py-4 space-y-4">
                                {/* File picker */}
                                <div
                                    className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-colors"
                                    onClick={() => document.getElementById('advisor-file-input')?.click()}
                                >
                                    <UploadCloud className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                                    <p className="text-sm text-gray-600">
                                        {upload_files.length > 0
                                            ? `${upload_files.length} file(s) selected`
                                            : "Click to select files"
                                        }
                                    </p>
                                    {upload_files.length > 0 && (
                                        <ul className="mt-2 text-xs text-gray-500 space-y-1">
                                            {upload_files.map((f, i) => (
                                                <li key={i}>{f.name} ({(f.size / 1024).toFixed(1)} KB)</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                <input
                                    id="advisor-file-input"
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => {
                                        if (e.target.files) {
                                            set_upload_files(Array.from(e.target.files));
                                        }
                                    }}
                                />
                            </div>

                            <DialogFooter>
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        set_is_upload_modal_open(false);
                                        set_upload_files([]);
                                    }}
                                    disabled={is_uploading}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handle_advisor_upload}
                                    disabled={upload_files.length === 0 || is_uploading}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                    {is_uploading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <UploadCloud className="h-4 w-4 mr-2" />
                                            Upload {upload_files.length > 0 ? `(${upload_files.length})` : ""}
                                        </>
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Submit to Underwriting Confirmation Modal */}
                    <Dialog open={is_submit_confirm_open} onOpenChange={(open) => {
                        if (!is_submitting_vault) set_is_submit_confirm_open(open);
                    }}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Submit Vault to Underwriting?</DialogTitle>
                                <DialogDescription>
                                    You are about to submit <strong>{client_profile.client_name}</strong>'s vault to the underwriting team for review.
                                    This will notify underwriting and mark the vault as submitted.
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                                <Button
                                    variant="ghost"
                                    onClick={() => set_is_submit_confirm_open(false)}
                                    disabled={is_submitting_vault}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handle_submit_vault}
                                    disabled={is_submitting_vault}
                                    className="bg-slate-800 hover:bg-slate-900 text-white"
                                >
                                    {is_submitting_vault ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Submitting...
                                        </>
                                    ) : (
                                        <>
                                            <ShieldCheck className="h-4 w-4 mr-2" />
                                            Yes, Submit
                                        </>
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Request Document Modal */}
                    <Dialog open={is_request_modal_open} onOpenChange={set_is_request_modal_open}>
                        <DialogContent className="sm:max-w-md flex flex-col max-h-[90vh]">
                            <DialogHeader>
                                <DialogTitle>Request New Document</DialogTitle>
                                <DialogDescription>
                                    Select document types to request from {client_profile.client_name}.
                                    They will see these requirements in their vault.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="py-2 space-y-4 flex-1 overflow-hidden flex flex-col">
                                {/* Search Input */}
                                <div className="relative">
                                    <Input
                                        placeholder="Search document types..."
                                        value={request_search_query}
                                        onChange={(e) => set_request_search_query(e.target.value)}
                                        className="pl-9"
                                    />
                                    <Plus className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 rotate-45" />
                                </div>

                                {/* Checklist */}
                                <div className="border rounded-lg overflow-hidden flex flex-col flex-1">
                                    <div className="overflow-y-auto p-4 space-y-3 max-h-[300px]">
                                        {all_doc_types
                                            .filter(type => !required_docs.some(r => r.code === type.code))
                                            .filter(type =>
                                                type.label.toLowerCase().includes(request_search_query.toLowerCase()) ||
                                                type.code.toLowerCase().includes(request_search_query.toLowerCase())
                                            )
                                            .map((type) => (
                                                <div key={type.id} className="flex items-center space-x-3 group">
                                                    <Checkbox
                                                        id={`doc-${type.id}`}
                                                        checked={selected_doc_ids.includes(type.id)}
                                                        onCheckedChange={(checked) => {
                                                            if (checked) {
                                                                set_selected_doc_ids([...selected_doc_ids, type.id]);
                                                            } else {
                                                                set_selected_doc_ids(selected_doc_ids.filter(id => id !== type.id));
                                                            }
                                                        }}
                                                    />
                                                    <label
                                                        htmlFor={`doc-${type.id}`}
                                                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1 group-hover:text-emerald-600 transition-colors"
                                                    >
                                                        {type.label}
                                                    </label>
                                                </div>
                                            ))
                                        }

                                        {all_doc_types.filter(type => !required_docs.some(r => r.code === type.code)).length === 0 && (
                                            <div className="text-center py-8">
                                                <p className="text-sm text-gray-500">
                                                    All available document types have already been requested.
                                                </p>
                                            </div>
                                        )}

                                        {all_doc_types.filter(type => !required_docs.some(r => r.code === type.code)).length > 0 &&
                                            all_doc_types.filter(type =>
                                                !required_docs.some(r => r.code === type.code) &&
                                                (type.label.toLowerCase().includes(request_search_query.toLowerCase()) ||
                                                    type.code.toLowerCase().includes(request_search_query.toLowerCase()))
                                            ).length === 0 && (
                                                <div className="text-center py-8">
                                                    <p className="text-sm text-gray-500">
                                                        No document types match "{request_search_query}"
                                                    </p>
                                                </div>
                                            )}
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="pt-2">
                                <div className="flex items-center justify-between w-full">
                                    <p className="text-xs font-bold text-gray-400">
                                        {selected_doc_ids.length} selected
                                    </p>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="ghost"
                                            onClick={() => set_is_request_modal_open(false)}
                                            disabled={is_requesting}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            onClick={handle_request_document}
                                            disabled={selected_doc_ids.length === 0 || is_requesting}
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[140px]"
                                        >
                                            {is_requesting ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                    Requesting...
                                                </>
                                            ) : (
                                                `Request ${selected_doc_ids.length > 1 ? 'Documents' : 'Document'}`
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Edit Profile Modal */}
                    {client_profile && (
                        <EditProfileModal
                            isOpen={is_edit_modal_open}
                            onClose={() => set_is_edit_modal_open(false)}
                            onSuccess={fetch_client_details}
                            clientData={client_profile}
                        />
                    )}

                    {/* Delete File Confirmation Modal */}
                    <Dialog open={is_delete_file_modal_open} onOpenChange={set_is_delete_file_modal_open}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Delete Document?</DialogTitle>
                                <DialogDescription>
                                    Are you sure you want to delete <strong>{file_to_delete?.custom_label || file_to_delete?.name}</strong>?
                                    This action cannot be undone.
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        set_is_delete_file_modal_open(false);
                                        set_file_to_delete(null);
                                    }}
                                    disabled={is_deleting_file}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handle_delete_file}
                                    disabled={is_deleting_file}
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                >
                                    {is_deleting_file ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Deleting...
                                        </>
                                    ) : (
                                        <>
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Yes, Delete
                                        </>
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Manual Funding Application Upload Modal */}
                    <Dialog open={is_manual_funding_modal_open} onOpenChange={set_is_manual_funding_modal_open}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <FileSignature className="h-5 w-5 text-emerald-600" />
                                    Add Funding Application
                                </DialogTitle>
                                <DialogDescription>
                                    Upload a signed Funding Application (PDF) for <strong>{client_profile.client_name}</strong>.
                                    This will mark the contract as completed and sync the document with GHL.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label htmlFor="funding_file">Select Signed PDF *</Label>
                                    <Input
                                        id="funding_file"
                                        type="file"
                                        accept=".pdf"
                                        onChange={(e) => set_funding_file(e.target.files?.[0] || null)}
                                        className="cursor-pointer"
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        set_is_manual_funding_modal_open(false);
                                        set_funding_file(null);
                                    }}
                                    disabled={is_uploading_funding}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handle_manual_funding_upload}
                                    disabled={is_uploading_funding || !funding_file}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                    {is_uploading_funding ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <UploadCloud className="h-4 w-4 mr-2" />
                                            Upload & Complete
                                        </>
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Delete Vault Confirmation Modal */}
                    <Dialog open={is_delete_vault_modal_open} onOpenChange={set_is_delete_vault_modal_open}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle className="text-red-600">Permanently Delete Vault?</DialogTitle>
                                <DialogDescription>
                                    This will permanently delete <strong>{client_profile.client_name}</strong>'s data vault, including all uploaded documents and profile information.
                                    This action is <strong>irreversible</strong>.
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                                <Button
                                    variant="ghost"
                                    onClick={() => set_is_delete_vault_modal_open(false)}
                                    disabled={is_deleting_vault}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handle_delete_vault}
                                    disabled={is_deleting_vault}
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                >
                                    {is_deleting_vault ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Deleting Vault...
                                        </>
                                    ) : (
                                        <>
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Permanently Delete
                                        </>
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {/* Remove Request Confirmation Modal */}
                    <Dialog open={is_remove_request_modal_open} onOpenChange={set_is_remove_request_modal_open}>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Remove Document Request?</DialogTitle>
                                <DialogDescription>
                                    Are you sure you want to remove the request for <strong>{doc_to_remove_request?.label}</strong>?
                                    The client will no longer see this as a required document.
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        set_is_remove_request_modal_open(false);
                                        set_doc_to_remove_request(null);
                                    }}
                                    disabled={is_removing_request}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handle_remove_request}
                                    disabled={is_removing_request}
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                >
                                    {is_removing_request ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Removing...
                                        </>
                                    ) : (
                                        "Remove Request"
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                    
                    {/* Rejection Modal */}
                    <Dialog open={is_reject_modal_open} onOpenChange={set_is_reject_modal_open}>
                        <DialogContent className="sm:max-w-md bg-white border-2 border-red-100 rounded-3xl overflow-hidden p-0">
                            <div className="bg-red-600 p-8 text-white text-center">
                                <div className="bg-white/20 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
                                    <XCircle className="h-8 w-8" />
                                </div>
                                <DialogTitle className="text-2xl font-black tracking-tight mb-2 uppercase">Reject Document?</DialogTitle>
                                <DialogDescription className="text-red-50 font-medium">
                                    Please explain why this document category is incomplete or incorrect.
                                    The client will receive an email and in-app notification.
                                </DialogDescription>
                            </div>
                            <div className="p-8 space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="reject-reason" className="text-emerald-950 font-black uppercase tracking-widest text-[10px]">Reason for Rejection</Label>
                                    <Textarea
                                        id="reject-reason"
                                        placeholder="e.g. Needs to be the full 6 months, or file is unreadable."
                                        value={reject_reason}
                                        onChange={(e) => set_reject_reason(e.target.value)}
                                        className="min-h-[120px] border-2 border-gray-100 focus:border-red-500 rounded-2xl p-4 font-medium"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4 pt-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => set_is_reject_modal_open(false)}
                                        className="border-2 border-gray-100 hover:bg-gray-50 text-gray-500 font-bold uppercase tracking-widest text-[10px] h-12 rounded-2xl"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handle_reject_category}
                                        disabled={is_rejecting || !reject_reason.trim()}
                                        className="bg-red-600 hover:bg-red-700 text-white font-black uppercase tracking-widest text-[10px] h-12 rounded-2xl shadow-xl shadow-red-600/20"
                                    >
                                        {is_rejecting ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                                        Confirm Rejection
                                    </Button>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            );
        }



        // ============================================
        // MAIN RENDER WITH STATE SWITCH
        // ============================================
        return (
            <div>
                {(() => {
                    switch (component_state) {
                        case ComponentState.LOADING:
                            return render_loading_state();
                        case ComponentState.ERROR:
                            return render_error_state();
                        case ComponentState.ACCESS_DENIED:
                            return render_access_denied_state();
                        case ComponentState.SUCCESS:
                            return render_success_state();
                        default:
                            return null;
                    }
                })()}
            </div>
        );
    }