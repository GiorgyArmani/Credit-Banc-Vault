// src/app/advisor/dashboard/clients/[id]/page.tsx
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
    MessageSquare,
    MoreVertical,
    CheckCircle2,
    Eye,
    Star,
    Plus,
    RefreshCw,
    Send,
    UploadCloud,
    CheckCircle,
    ShieldCheck,
    UserCog
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { requestDocuments } from "./actions";
import { fetchInternalNotes, addInternalNote } from "@/app/actions/internal-notes";
import { toast } from "sonner";
import clsx from "clsx";
import { format } from "date-fns";
import { Textarea } from "@/components/ui/textarea";
import { EditProfileModal } from "./edit-profile-modal";

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

    // error-message-state: Stores specific error message
    const [error_message, set_error_message] = useState<string>("");

    // Internal Notes state
    const [notes, set_notes] = useState<InternalNote[]>([]);
    const [new_standalone_note, set_new_standalone_note] = useState("");
    const [is_adding_note, set_is_adding_note] = useState(false);

    // Edit Profile state
    const [is_edit_modal_open, set_is_edit_modal_open] = useState(false);

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
          data_vault_submitted_at
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
            // STEP 8: FETCH INTERNAL NOTES
            // ============================================
            const notes_res = await fetchInternalNotes(client_id);
            if (notes_res.success) {
                set_notes(notes_res.notes || []);
            }

            set_component_state(ComponentState.SUCCESS);

        } catch (err: any) {
            console.error("❌ Unexpected error:", err);
            set_error_message(err.message || "An unexpected error occurred.");
            set_component_state(ComponentState.ERROR);
        }
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
            alert("Error downloading document. Please try again.");
        }
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
     * render-document-card: Renders individual document card with download
     */
    function render_document_card(doc: UserDocument) {
        return (
            <Card
                key={doc.id}
                className="hover:shadow-md transition-shadow"
            >
                <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                                <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
                                <h4 className="font-medium text-gray-900 truncate">
                                    {doc.custom_label || doc.name}
                                </h4>
                                {doc.is_favorite && (
                                    <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                                )}
                            </div>

                            <div className="space-y-1 text-sm text-gray-600">
                                <p className="truncate">{doc.name}</p>
                                <div className="flex items-center gap-3 text-xs">
                                    <span>{format_file_size(doc.size)}</span>
                                    <span>•</span>
                                    <span>Uploaded {format_date(doc.upload_date)}</span>
                                </div>
                            </div>
                        </div>

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => download_document(doc)}
                            className="ml-4 flex-shrink-0"
                        >
                            <Download className="h-4 w-4" />
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    /**
     * render_document_category: Renders a category section with its documents
     */
    function render_document_category(doc_type: { code: string; label: string }) {
        const category_docs = get_documents_by_category(doc_type.code);
        const has_docs = category_docs.length > 0;

        return (
            <div
                key={doc_type.code}
                className={clsx(
                    "border rounded-xl p-6",
                    has_docs ? "bg-emerald-50 border-emerald-200" : "bg-gray-50 border-gray-200"
                )}
            >
                {/* Category Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        {has_docs ? (
                            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                        ) : (
                            <AlertCircle className="h-6 w-6 text-gray-400" />
                        )}
                        <div>
                            <h3 className="font-semibold text-gray-900">{doc_type.label}</h3>
                            <p className="text-sm text-gray-600">
                                {has_docs
                                    ? `${category_docs.length} document${category_docs.length > 1 ? 's' : ''} uploaded`
                                    : "Not uploaded yet"
                                }
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Upload button for advisor */}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                set_upload_doc_code(doc_type.code);
                                set_upload_doc_label(doc_type.label);
                                set_upload_files([]);
                                set_is_upload_modal_open(true);
                            }}
                            className="border-emerald-500 text-emerald-700 hover:bg-emerald-50 text-xs"
                        >
                            <UploadCloud className="h-3.5 w-3.5 mr-1" />
                            Upload
                        </Button>

                        <Badge
                            variant="outline"
                            className={clsx(
                                "font-semibold border",
                                has_docs
                                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                    : "bg-gray-100 text-gray-600 border-gray-300"
                            )}
                        >
                            {has_docs ? "Complete" : "Pending"}
                        </Badge>
                    </div>
                </div>

                {/* Document List */}
                {has_docs && (
                    <div className="space-y-3 mt-4">
                        {category_docs.map(doc => render_document_card(doc))}
                    </div>
                )}
            </div>
        );
    }

    /**
     * render-success-state: Shows complete client details and documents
     */
    function render_success_state() {
        if (!client_profile) return null;

        // Calculate document completion statistics
        const total_required = required_docs.length;
        const completed_categories = required_docs.filter(
            doc_type => get_documents_by_category(doc_type.code).length > 0
        ).length;
        const completion_percentage = total_required > 0
            ? Math.round((completed_categories / total_required) * 100)
            : 100;

        // Get additional documents (not in required categories)
        const additional_docs = documents.filter(
            doc => !required_docs.some(type => type.code === doc.category)
        );

        return (
            <div className="space-y-6">
                {/* Back Button */}
                <Button
                    variant="ghost"
                    onClick={() => router.push("/advisor/dashboard/clients")}
                    className="mb-4"
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Clients
                </Button>

                {/* Client Profile Header */}
                <Card>
                    <CardHeader>
                        <div className="flex items-start justify-between">
                            <div>
                                <CardTitle className="text-2xl">{client_profile.client_name}</CardTitle>
                                <CardDescription className="mt-2 text-base">
                                    {client_profile.company_name}
                                </CardDescription>
                            </div>

                            {/* Center-side actions: Edit Profile */}
                            <div className="flex-1 px-8">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => set_is_edit_modal_open(true)}
                                    className="border-blue-500 text-blue-600 hover:bg-blue-50"
                                >
                                    <UserCog className="h-4 w-4 mr-2" />
                                    Edit Profile
                                </Button>
                            </div>

                            {/* Right-side actions: completion badge + resend button */}
                            <div className="flex items-center gap-3 flex-shrink-0">
                                {/* Resend Login Credentials Button */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handle_resend_credentials}
                                    disabled={is_resending}
                                    className="border-blue-500 text-blue-600 hover:bg-blue-50 disabled:opacity-60"
                                >
                                    {is_resending ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Sending...
                                        </>
                                    ) : (
                                        <>
                                            <Send className="h-4 w-4 mr-2" />
                                            Resend Login Credentials
                                        </>
                                    )}
                                </Button>

                                {/* Document Completion Badge */}
                                <Badge
                                    variant="outline"
                                    className={clsx(
                                        "text-lg px-4 py-2 font-semibold border-2",
                                        completion_percentage >= 100
                                            ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                            : completion_percentage >= 50
                                                ? "bg-yellow-100 text-yellow-800 border-yellow-300"
                                                : "bg-red-100 text-red-800 border-red-300"
                                    )}
                                >
                                    {completion_percentage}% Complete
                                </Badge>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent>
                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                            {/* Contact Information */}
                            <div className="space-y-3">
                                <h4 className="font-semibold text-gray-900 mb-3">Contact Information</h4>
                                <div className="flex items-center text-sm text-gray-600">
                                    <Mail className="h-4 w-4 mr-2 text-gray-400" />
                                    <span className="truncate">{client_profile.client_email}</span>
                                </div>
                                <div className="flex items-center text-sm text-gray-600">
                                    <Phone className="h-4 w-4 mr-2 text-gray-400" />
                                    <span>{client_profile.client_phone}</span>
                                </div>
                                <div className="flex items-center text-sm text-gray-600">
                                    <Calendar className="h-4 w-4 mr-2 text-gray-400" />
                                    <span>Created {format_date(client_profile.created_at)}</span>
                                </div>
                            </div>

                            {/* Business Information */}
                            <div className="space-y-3">
                                <h4 className="font-semibold text-gray-900 mb-3">Business Information</h4>
                                <div className="flex items-center text-sm text-gray-600">
                                    <Building2 className="h-4 w-4 mr-2 text-gray-400" />
                                    <span>{client_profile.legal_entity_type}</span>
                                </div>
                                <div className="text-sm text-gray-600">
                                    <span className="text-gray-500">Location:</span>{" "}
                                    {client_profile.company_city}, {client_profile.company_state}
                                </div>
                                <div className="text-sm text-gray-600">
                                    <span className="text-gray-500">Started:</span>{" "}
                                    {format_date(client_profile.business_start_date)}
                                </div>
                            </div>

                            {/* Financial Information */}
                            <div className="space-y-3">
                                <h4 className="font-semibold text-gray-900 mb-3">Financial Information</h4>
                                <div className="bg-emerald-50 rounded-lg p-3">
                                    <p className="text-xs text-gray-600 mb-1">Capital Requested</p>
                                    <p className="text-lg font-bold text-emerald-700">
                                        {format_currency(client_profile.capital_requested)}
                                    </p>
                                </div>
                                <div className="text-sm text-gray-600">
                                    <span className="text-gray-500">Avg Monthly Revenue:</span>{" "}
                                    {format_currency(client_profile.avg_monthly_deposits)}
                                </div>
                                <div className="text-sm text-gray-600">
                                    <span className="text-gray-500">Credit Score:</span>{" "}
                                    {client_profile.credit_score}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Internal Communication Section */}
                <Card className="border-amber-200 bg-amber-50/30">
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="h-5 w-5 text-amber-600" />
                            <CardTitle className="text-lg text-amber-900">Internal Communication</CardTitle>
                        </div>
                        <CardDescription className="text-amber-700/80">
                            Shared notes between Advisor and Underwriting for this client.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* Notes Feed */}
                        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                            {notes.length === 0 ? (
                                <div className="text-center py-8 bg-white/50 rounded-lg border border-dashed border-amber-200">
                                    <p className="text-sm text-amber-600">No internal notes yet.</p>
                                </div>
                            ) : (
                                notes.map((note) => (
                                    <div key={note.id} className="bg-white p-3 rounded-lg border border-amber-100 shadow-sm">
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="font-semibold text-sm text-gray-900 uppercase tracking-tight">
                                                {note.author_name} ({note.author_role})
                                            </span>
                                            <span className="text-[10px] text-gray-400">
                                                {format(new Date(note.created_at), "MMM d, h:mm a")}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Add Note Input */}
                        <div className="space-y-2 pt-2 border-t border-amber-100">
                            <Textarea
                                placeholder="Add an internal note for underwriting..."
                                value={new_standalone_note}
                                onChange={(e) => set_new_standalone_note(e.target.value)}
                                className="bg-white border-amber-200 focus:ring-amber-500 min-h-[80px]"
                            />
                            <div className="flex justify-end">
                                <Button
                                    onClick={handle_add_note}
                                    disabled={is_adding_note || !new_standalone_note.trim()}
                                    className="bg-amber-600 hover:bg-amber-700 text-white"
                                    size="sm"
                                >
                                    {is_adding_note ? "Adding..." : "Post Note"}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Document Status Overview */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle>Document Upload Status</CardTitle>
                                <CardDescription>
                                    {completed_categories} of {total_required} required document categories completed
                                </CardDescription>
                            </div>

                            {/* Request New Document Button */}
                            <Button
                                onClick={() => set_is_request_modal_open(true)}
                                variant="outline"
                                className="border-emerald-600 text-emerald-600 hover:bg-emerald-50"
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Request New Document
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {/* Progress Bar */}
                        <div className="w-full bg-gray-200 rounded-full h-3 mb-6">
                            <div
                                className={clsx(
                                    "h-3 rounded-full transition-all",
                                    completion_percentage >= 100 ? "bg-emerald-600" :
                                        completion_percentage >= 50 ? "bg-yellow-500" :
                                            "bg-red-500"
                                )}
                                style={{ width: `${Math.min(completion_percentage, 100)}%` }}
                            />
                        </div>

                        {/* Required Documents */}
                        <div className="space-y-4">
                            <h4 className="font-semibold text-gray-900">Required Documents</h4>
                            {required_docs.map(doc_type => render_document_category(doc_type))}
                        </div>

                        {/* Additional Documents */}
                        {additional_docs.length > 0 && (
                            <div className="space-y-4 mt-6">
                                <h4 className="font-semibold text-gray-900">Additional Documents</h4>
                                <div className="space-y-3">
                                    {additional_docs.map(doc => render_document_card(doc))}
                                </div>
                            </div>
                        )}

                        {/* No Documents Message */}
                        {documents.length === 0 && (
                            <div className="text-center py-8 text-gray-600">
                                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <p>No documents uploaded yet</p>
                                <p className="text-sm text-gray-500 mt-2">
                                    Client will receive instructions to upload required documents
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Submit to Underwriting Section */}
                <Card className={clsx(
                    "border-2",
                    vault_submitted
                        ? "bg-emerald-50 border-emerald-300"
                        : "bg-white border-slate-200"
                )}>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
                                    <ShieldCheck className={clsx("h-5 w-5", vault_submitted ? "text-emerald-600" : "text-slate-400")} />
                                    Submit to Underwriting
                                </h3>
                                <p className="text-sm text-gray-600 mt-1">
                                    {vault_submitted
                                        ? `Vault was submitted to underwriting${client_profile.data_vault_submitted_at ? ` on ${format_date(client_profile.data_vault_submitted_at)}` : ""}.`
                                        : "Once all documents are ready, submit this vault to the underwriting team for review."
                                    }
                                </p>
                            </div>

                            {vault_submitted ? (
                                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 border text-sm px-4 py-2">
                                    <CheckCircle className="h-4 w-4 mr-2" />
                                    Submitted
                                </Badge>
                            ) : (
                                <Button
                                    onClick={() => set_is_submit_confirm_open(true)}
                                    className="bg-slate-800 hover:bg-slate-900 text-white"
                                >
                                    <ShieldCheck className="h-4 w-4 mr-2" />
                                    Submit to Underwriting
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Upload Document Modal */}
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
            </div>
        );
    }

    // ============================================
    // MAIN RENDER WITH STATE SWITCH
    // ============================================
    return (
        <div>
            {/* Page Header */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                    Client Details
                </h1>
                <p className="text-muted-foreground mt-2">
                    View client profile and document submissions
                </p>
            </div>

            {/* State-Based Rendering */}
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