// src/app/underwriting/dashboard/clients/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams, usePathname } from "next/navigation";
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
    ChevronLeft,
    ChevronRight,
    Eye,
    Star,
    Trash2,
    Pencil,
    UploadCloud,
    BarChart3,
    Slack,
    Send,
    Search
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
import { toast } from "@/lib/toast";
import clsx from "clsx";
import { format } from "date-fns";
import { LoanFundedDialog } from "@/components/loan-funded-dialog";
import { ShareWithLenderButton } from "@/components/share/share-with-lender-button";
import { LenderResponsePanel } from "@/components/lender/lender-response-panel";
import { UwAddLenderButton } from "@/components/lender/uw-add-lender-button";
import { requestDocuments } from "@/app/advisor/dashboard/clients/[id]/actions";
import { getClientPipelineHistory, updateLoanStatus, type LoanStatus, type PipelineStatusEntry } from "@/app/actions/pipeline";
import { LoanPipelineFull, LoanPipelineBadge, PIPELINE_STEPS } from "@/components/loan-pipeline-status";
import { getBulkClientActivity } from "@/app/actions/advisor";
import { ActivityAgeBadge } from "@/components/advisor/activity-age-badge";
import { differenceInDays } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameClientFile } from "../../actions";
import { EditProfileModal } from "@/app/advisor/dashboard/clients/[id]/edit-profile-modal";
import { ClientFollowersCard } from "@/app/advisor/dashboard/clients/[id]/_components/client-followers-card";
import {
    addManualFundingApplication,
    deleteClientVault,
} from "@/app/advisor/dashboard/clients/[id]/actions";
import { BankAnalysisViewer } from "@/components/admin/bank-analysis-viewer";
import { BusinessTabStrip, type BusinessTab } from "@/app/advisor/dashboard/clients/[id]/_components/business-tab-strip";
import { CollapsibleSection, broadcast_toggle_all } from "@/app/advisor/dashboard/clients/[id]/_components/collapsible-section";
import { isClientScopedDoc, matchesActiveBusiness, normalizeSupabaseJoin, formatRequirementLabel } from "@/lib/document-scope";

// Slack deal-channel integration is built but not yet tested end-to-end.
// Flip to `true` to re-enable the "Create / Open Slack Channel" button.
const SLACK_FEATURE_ENABLED = true;

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
    company_zip_code?: string;
    capital_requested: number;
    legal_entity_type: string;
    business_start_date: string;
    avg_monthly_deposits: number;
    avg_annual_revenue?: number;
    credit_score: string;
    created_at: string;
    reassigned_to_catch_all_at?: string | null;
    proposed_loan_type: string;
    loan_purpose: string;
    industry: string;
    funding_eta?: string;
    employees_count?: number;
    is_home_based?: boolean | null;
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
    admin_review: 'pending' | 'approved' | 'rejected';
    admin_review_notes: string | null;
    admin_reviewed_at: string | null;
    source: 'match_tool' | 'admin_manual';
    status: 'pending' | 'submitted' | 'approved_by_lender' | 'declined_by_lender' | 'funded';
}

// Effective UI states for a lender assignment. The matching engine proposes
// (decision), admin clears for outreach (admin_review), UW physically pushes
// the file out (status='submitted'), then records the lender's verdict
// (status='approved_by_lender' | 'declined_by_lender'). The label rendered to
// UW is the derived combination of those columns.
type LenderRowState =
    | 'rejected_by_matcher'   // decision = rejected
    | 'skipped_by_admin'       // decision = approved, admin_review = rejected
    | 'awaiting_admin'         // decision = approved, admin_review = pending
    | 'ready_to_submit'        // all approved, status = pending
    | 'submitted'              // status = submitted, awaiting lender
    | 'approved_by_lender'     // lender approved the submission
    | 'declined_by_lender'     // lender declined the submission
    | 'funded';                // deal funded

function derive_lender_row_state(a: LenderAssignment): LenderRowState {
    if (a.decision !== 'approved') return 'rejected_by_matcher';
    if (a.admin_review === 'rejected') return 'skipped_by_admin';
    if (a.admin_review !== 'approved') return 'awaiting_admin';
    if (a.status === 'funded') return 'funded';
    if (a.status === 'approved_by_lender') return 'approved_by_lender';
    if (a.status === 'declined_by_lender') return 'declined_by_lender';
    if (a.status === 'submitted') return 'submitted';
    return 'ready_to_submit';
}

interface UserDocument {
    id: string;
    name: string;
    size: number;
    type: string;
    category: string | null;
    doc_code?: string | null;
    custom_label: string | null;
    upload_date: string;
    storage_path: string;
    viewed_at: string | null;
    uploaded_by_role?: 'advisor' | 'client';
    business_profile_id?: string | null;
}

interface InternalNote {
    id: string;
    author_name: string;
    author_role: string;
    content: string;
    created_at: string;
}

// matchesActiveBusiness is shared with the advisor page + vault.tsx — see
// @/lib/document-scope. Don't re-declare it here.

export default function UnderwritingClientDetailsPage() {
    const supabase = createClient();
    const router = useRouter();
    const params = useParams();
    const pathname = usePathname();
    const client_id = params.id as string;

    // This page now only mounts under /underwriting/dashboard/clients/[id].
    // Admin routes (/admin/uw/dashboard/clients/[id], /admin/advisor/clients/[id])
    // redirect to /admin/clients/[id], which renders the advisor page instead.
    // The is_admin_* flags below are kept as a safety net in case the route is
    // remounted under /admin/* in the future, but they currently never fire.
    const is_admin_uw_route = pathname?.startsWith("/admin/uw") ?? false;
    const is_admin_unified_route = pathname?.startsWith("/admin/clients") ?? false;
    const is_admin_route = is_admin_uw_route || is_admin_unified_route;
    const is_underwriting_route = pathname?.startsWith("/underwriting") ?? false;
    // Document upload is open to all staff surfaces of this page (admin already
    // exposes it via Admin Actions; UW gets its own trigger below).
    const can_upload = is_admin_route || is_underwriting_route;
    const queue_path = is_admin_unified_route
        ? "/admin/dashboard"
        : is_admin_uw_route
            ? "/admin/uw/dashboard"
            : "/underwriting/dashboard";
    const client_base_path = is_admin_unified_route
        ? "/admin/clients"
        : is_admin_uw_route
            ? "/admin/uw/dashboard/clients"
            : "/underwriting/dashboard/clients";

    const [component_state, set_component_state] = useState<ComponentState>(ComponentState.LOADING);
    const [client_profile, set_client_profile] = useState<ClientProfile | null>(null);
    const [documents, set_documents] = useState<UserDocument[]>([]);
    const [open_positions, set_open_positions] = useState<OpenPosition[]>([]);
    // required_docs carries business_profile_id so the UW view can rescope
    // per active tab without re-querying. Same shape as the advisor page.
    const [required_docs, set_required_docs] = useState<{ code: string; label: string; business_profile_id?: string | null }[]>([]);

    // Multi-business support. UW reviews per-business — each tab has its own
    // doc set + approval state. Client-scoped docs (DL/PFS/MyScoreIQ) surface
    // on every tab via the matcher (see scoped_* memos below).
    const [businesses, set_businesses] = useState<BusinessTab[]>([]);
    const [active_business_id, set_active_business_id] = useState<string | null>(null);
    // approvals_raw is the ungrouped fetch from document_category_approvals;
    // the `approvals` Set used by render code is derived per active tab.
    const [approvals_raw, set_approvals_raw] = useState<{ doc_code: string; business_profile_id: string | null }[]>([]);
    const [error_message, set_error_message] = useState<string>("");
    const [lender_assignments, set_lender_assignments] = useState<LenderAssignment[]>([]);
    const [is_loading_assignments, set_is_loading_assignments] = useState(false);
    const [submitting_assignment_id, set_submitting_assignment_id] = useState<string | null>(null);

    async function mark_assignment_submitted(assignment_id: string) {
        set_submitting_assignment_id(assignment_id);
        try {
            const res = await fetch(`/api/lender-assignments/${assignment_id}/submit`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
            });
            const result = await res.json();
            if (!res.ok || !result?.success) {
                toast.error(result?.error || 'Failed to mark as submitted');
                return;
            }
            toast.success('Marked as submitted to lender');
            await fetch_lender_assignments();
        } catch (err: any) {
            console.error('mark_assignment_submitted error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_submitting_assignment_id(null);
        }
    }

    // Move a submitted file around the lender lifecycle (the status dropdown).
    // Drives status to submitted / approved_by_lender / declined_by_lender and
    // notifies admins so the admin portal mirrors the outcome.
    type SubmittedLifecycleStatus = 'submitted' | 'approved_by_lender' | 'declined_by_lender';
    async function mark_assignment_status(assignment_id: string, status: SubmittedLifecycleStatus) {
        set_submitting_assignment_id(assignment_id);
        try {
            const res = await fetch(`/api/lender-assignments/${assignment_id}/response`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            const result = await res.json();
            if (!res.ok || !result?.success) {
                toast.error(result?.error || 'Failed to update lender status');
                return;
            }
            const label =
                status === 'approved_by_lender' ? 'Marked as approved by lender' :
                status === 'declined_by_lender' ? 'Marked as declined by lender' :
                'Marked as awaiting lender';
            toast.success(label);
            await fetch_lender_assignments();
        } catch (err: any) {
            console.error('mark_assignment_status error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_submitting_assignment_id(null);
        }
    }

    // Create (or reuse) the dedicated Slack channel for this deal. Gated in the
    // UI behind is_docs_approved; idempotent server-side.
    async function create_slack_channel() {
        set_is_creating_slack_channel(true);
        try {
            const res = await fetch('/api/slack/create-channel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id }),
            });
            const result = await res.json();
            if (!res.ok || !result?.success) {
                toast.error(result?.error || 'Failed to create Slack channel');
                return;
            }
            set_slack_channel({ id: result.channel_id, name: result.channel_name });
            toast.success(result.already_existed ? 'Slack channel already exists' : 'Slack channel created');
        } catch (err: any) {
            console.error('create_slack_channel error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_creating_slack_channel(false);
        }
    }

    // Pending per-row admin review changes (assignment_id -> { decision, notes }).
    // Buffered locally so the admin can mark several lenders before submitting in one batch.
    const [pending_admin_reviews, set_pending_admin_reviews] = useState<
        Record<string, { decision: 'approved' | 'rejected'; notes: string }>
    >({});
    const [is_submitting_review, set_is_submitting_review] = useState(false);

    // Admin-only: client profile edit modal
    const [is_edit_profile_open, set_is_edit_profile_open] = useState(false);

    // Admin-only: submit vault to underwriting
    const [is_submit_vault_open, set_is_submit_vault_open] = useState(false);
    const [is_submitting_vault, set_is_submitting_vault] = useState(false);
    const [submit_vault_fico, set_submit_vault_fico] = useState("");

    // Manual funding application upload
    const [is_funding_app_open, set_is_funding_app_open] = useState(false);
    const [funding_app_file, set_funding_app_file] = useState<File | null>(null);
    const [is_uploading_funding_app, set_is_uploading_funding_app] = useState(false);
    // Lender version: funding app with the agreement page removed. Uploaded as a
    // standalone shareable doc — does NOT mark the deal complete, sync GHL, or
    // touch the document-request flow.
    const [funding_app_for_lenders, set_funding_app_for_lenders] = useState(false);

    // Admin-only: upload documents on behalf of client (generic multi-type modal)
    const [is_doc_upload_open, set_is_doc_upload_open] = useState(false);
    const [doc_upload_code, set_doc_upload_code] = useState("");
    const [doc_upload_files, set_doc_upload_files] = useState<File[]>([]);
    const [is_uploading_docs, set_is_uploading_docs] = useState(false);

    // Per-category direct upload (advisor-style: pick files → upload, no menu)
    const category_upload_input_ref = useRef<HTMLInputElement>(null);
    const [inline_upload_code, set_inline_upload_code] = useState("");
    const [inline_uploading_code, set_inline_uploading_code] = useState<string | null>(null);

    // Staff: request documents from the client (mirrors the advisor flow)
    const [is_request_modal_open, set_is_request_modal_open] = useState(false);
    const [selected_request_ids, set_selected_request_ids] = useState<string[]>([]);
    const [request_search, set_request_search] = useState("");
    const [is_requesting_docs, set_is_requesting_docs] = useState(false);
    const [requesting_again_code, set_requesting_again_code] = useState<string | null>(null);

    // Admin-only: delete vault confirmation
    const [is_delete_vault_open, set_is_delete_vault_open] = useState(false);
    const [delete_confirm_text, set_delete_confirm_text] = useState("");
    const [is_deleting_vault, set_is_deleting_vault] = useState(false);

    // Inline bank analysis viewer modal
    const [is_bank_analysis_viewer_open, set_is_bank_analysis_viewer_open] = useState(false);

    const [is_notify_modal_open, set_is_notify_modal_open] = useState(false);
    const [selected_missing_docs, set_selected_missing_docs] = useState<string[]>([]);
    const [all_available_docs, set_all_available_docs] = useState<{ id: string; code: string; label: string }[]>([]);
    const [selected_extra_docs, set_selected_extra_docs] = useState<string[]>([]);
    const [custom_note, set_custom_note] = useState("");
    const [is_notifying, set_is_notifying] = useState(false);

    // Internal Notes state
    const [notes, set_notes] = useState<InternalNote[]>([]);
    const [new_standalone_note, set_new_standalone_note] = useState("");
    const [is_adding_note, set_is_adding_note] = useState(false);

    // Documents state enhancement. `approvals` is derived from approvals_raw
    // filtered by the active business tab, so switching tabs auto-recomputes
    // which categories show as approved + drives the completion percentage.
    const approvals = useMemo<Set<string>>(() => {
        return new Set(
            approvals_raw
                .filter((a) => matchesActiveBusiness(a.business_profile_id, active_business_id, a.doc_code))
                .map((a) => a.doc_code)
        );
    }, [approvals_raw, active_business_id]);

    // Scoped docs + required docs for the active business tab. Client-scoped
    // codes (driver's license / MyScoreIQ / PFS) surface on every tab. De-dupe
    // the requested-doc list by code so a client-scoped doc requested under
    // multiple businesses still renders as a single card.
    const scoped_documents = useMemo<UserDocument[]>(() => {
        const active_is_primary = businesses.find((b) => b.id === active_business_id)?.is_primary ?? false;
        return documents.filter((d) => {
            const code = (d as any).doc_code ?? (d as any).category ?? null;
            const bpid = (d as any).business_profile_id ?? null;
            if (matchesActiveBusiness(bpid, active_business_id, code)) return true;
            // Resilience: a legacy/unscoped upload (business_profile_id = null,
            // e.g. a funding application e-signed before per-business scoping)
            // surfaces on the PRIMARY tab so it's never silently lost.
            if (bpid === null && active_is_primary) return true;
            return false;
        });
    }, [documents, active_business_id, businesses]);

    const scoped_required_docs = useMemo(() => {
        const filtered = required_docs.filter((d) =>
            matchesActiveBusiness(d.business_profile_id ?? null, active_business_id, d.code)
        );
        const seen = new Set<string>();
        const out: typeof filtered = [];
        for (const d of filtered) {
            if (seen.has(d.code)) continue;
            seen.add(d.code);
            out.push(d);
        }
        return out;
    }, [required_docs, active_business_id]);

    // "Full documentation approved" for the active business tab: every required
    // doc has both an uploaded file and a category approval. Mirrors the
    // outstanding-banner logic and gates the "Create Slack Channel" button.
    const is_docs_approved = useMemo<boolean>(() => {
        if (scoped_required_docs.length === 0) return false;
        return scoped_required_docs.every(
            (r) => approvals.has(r.code) && scoped_documents.some((d) => (d as any).category === r.code)
        );
    }, [scoped_required_docs, approvals, scoped_documents]);

    const [expanded_categories, set_expanded_categories] = useState<Set<string>>(new Set());
    const [preview_modal, set_preview_modal] = useState<{ isOpen: boolean; doc: UserDocument | null }>({
        isOpen: false,
        doc: null,
    });

    // Pipeline State
    const [current_pipeline_status, set_current_pipeline_status] = useState<LoanStatus>("created");
    const [pipeline_history, set_pipeline_history] = useState<PipelineStatusEntry[]>([]);
    const [is_advancing_status, set_is_advancing_status] = useState(false);

    // Slack deal-channel state (created from the docs-approved gate).
    const [slack_channel, set_slack_channel] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
    const [is_creating_slack_channel, set_is_creating_slack_channel] = useState(false);

    // Renaming state
    const [renaming_file, set_renaming_file] = useState<{ id: string; label: string } | null>(null);
    const [is_renaming_loading, setIs_renaming_loading] = useState(false);

    // navigable-clients-state: Ordered list of client IDs for prev/next navigation in the UW header.
    const [navigable_client_ids, set_navigable_client_ids] = useState<string[]>([]);

    // Most recent meaningful interaction (status change, doc upload, internal note).
    const [last_activity_at, set_last_activity_at] = useState<string | null>(null);

    useEffect(() => {
        if (client_id) fetch_client_details();
    }, [client_id]);

    useEffect(() => {
        async function fetch_navigable_clients() {
            const { data } = await supabase
                .from("client_data_vault")
                .select("id")
                .order("created_at", { ascending: false });
            if (data) set_navigable_client_ids(data.map(r => r.id));
        }
        fetch_navigable_clients();
    }, []);

    useEffect(() => {
        if (!client_id) return;
        let cancelled = false;
        getBulkClientActivity([client_id]).then((map) => {
            if (cancelled) return;
            set_last_activity_at(map.get(client_id) ?? null);
        });
        return () => { cancelled = true; };
    }, [client_id]);

    const current_nav_index = navigable_client_ids.indexOf(client_id);
    const prev_client_id = current_nav_index > 0 ? navigable_client_ids[current_nav_index - 1] : null;
    const next_client_id = current_nav_index >= 0 && current_nav_index < navigable_client_ids.length - 1
        ? navigable_client_ids[current_nav_index + 1]
        : null;

    async function fetch_client_details() {
        try {
            set_component_state(ComponentState.LOADING);

            // 1. Fetch Client Profile with Advisor details
            const { data: client, error: client_error } = await supabase
                .from("client_data_vault")
                .select(`
                    id, user_id, client_name, client_email, client_phone,
                    company_name, company_city, company_state, company_zip_code, capital_requested,
                    legal_entity_type, business_start_date, avg_monthly_deposits, avg_annual_revenue,
                    credit_score, created_at, reassigned_to_catch_all_at,
                    proposed_loan_type, loan_purpose, industry, funding_eta, employees_count, is_home_based,
                    number_of_owners, owner_1_name, owner_1_ownership_pct,
                    owner_2_name, owner_2_ownership_pct, owner_3_name, owner_3_ownership_pct,
                    owner_4_name, owner_4_ownership_pct, owner_5_name, owner_5_ownership_pct,
                    slack_channel_id, slack_channel_name,
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
            set_slack_channel({
                id: (client as any).slack_channel_id ?? null,
                name: (client as any).slack_channel_name ?? null,
            });

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

            // 3. Fetch current requirements (dynamic — every active doc request
            //    for this user across all of their businesses, with the
            //    business linkage so the UI can rescope per active tab).
            const { data: dynamicDocs } = await supabase
                .from("client_dynamic_documents")
                .select("business_profile_id, statement_months, required_documents(code, label)")
                .eq("user_id", client.user_id)
                .eq("is_active", true);

            // normalizeSupabaseJoin handles SDK array-vs-object variance on
            // the embedded required_documents row. See document-scope.ts.
            const dynamicReqs = (dynamicDocs || [])
                .map((d: any) => {
                    const def = normalizeSupabaseJoin(d.required_documents) || {};
                    return {
                        ...def,
                        // Reflect the precise bank-statement period in the label.
                        label: formatRequirementLabel((def as any).code, (def as any).label, d.statement_months),
                        business_profile_id: d.business_profile_id ?? null,
                    };
                })
                .filter((d: any) => d.code);
            set_required_docs(dynamicReqs);

            // 4. Fetch all available document types FOR THE CATALOG
            const { data: allDocs } = await supabase
                .from("required_documents")
                .select("id, code, label")
                .order("label", { ascending: true });
            set_all_available_docs(allDocs || []);

            // 5. Fetch internal notes
            const notesRes = await fetchInternalNotes(client_id);
            if (notesRes.success) {
                set_notes(notesRes.notes || []);
            }

            // 6. Fetch pipeline history
            const history = await getClientPipelineHistory(client_id);
            set_pipeline_history(history);
            if (history.length > 0) {
                set_current_pipeline_status(history[history.length - 1].status);
            }

            // 7. Fetch approvals for this client — carry business_profile_id so
            //    the approvals memo can rescope per active tab.
            const { data: categoryApprovals } = await supabase
                .from("document_category_approvals")
                .select("doc_code, business_profile_id")
                .eq("client_vault_id", client_id);
            set_approvals_raw(
                (categoryApprovals || []).map((a: any) => ({
                    doc_code: a.doc_code,
                    business_profile_id: a.business_profile_id ?? null,
                }))
            );

            // 8. Businesses for the tab strip — order primary first, then by
            //    display_order, then creation. Default the active tab to the
            //    primary so single-business clients see identical UI.
            const { data: businessRows } = await supabase
                .from("business_profiles")
                .select("id, company_name, is_primary, display_order, legal_entity_type, business_start_date, company_city, company_state, company_zip_code, avg_monthly_deposits, avg_annual_revenue, employees_count, is_home_based, industry, funding_deals (capital_requested, proposed_loan_type, loan_purpose, funding_eta, display_order)")
                .eq("client_vault_id", client_id)
                .order("is_primary", { ascending: false })
                .order("display_order", { ascending: true })
                .order("created_at", { ascending: true });
            // Flatten each business's funding ask (lives on funding_deals) onto
            // the tab row so the header amount rescopes per active business.
            const rows = (businessRows || []).map((b: any): BusinessTab => {
                const deals = Array.isArray(b.funding_deals) ? b.funding_deals : [];
                const deal = deals
                    .slice()
                    .sort((x: any, y: any) => (x.display_order ?? 0) - (y.display_order ?? 0))[0] ?? null;
                const { funding_deals: _drop, ...rest } = b;
                return {
                    ...rest,
                    capital_requested: deal?.capital_requested ?? null,
                    proposed_loan_type: deal?.proposed_loan_type ?? null,
                    loan_purpose: deal?.loan_purpose ?? null,
                    funding_eta: deal?.funding_eta ?? null,
                };
            });
            set_businesses(rows);
            const primary = rows.find((b) => b.is_primary) || rows[0];
            if (primary && !active_business_id) {
                set_active_business_id(primary.id);
            }

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
            // Pass missing + additional docs as separate categories; the action
            // builds the audit-trail internal note and the email from them.
            const res = await notifyAdvisor(client_id, selected_missing_docs, selected_extra_docs, custom_note.trim());
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
     * get_documents_by_category: Groups documents by their category for the
     * active business tab. Reads from scoped_documents so client-scoped docs
     * (driver's license / MyScoreIQ / PFS) carry across every tab while
     * business-scoped docs stay pinned.
     */
    function get_documents_by_category(category_code: string): UserDocument[] {
        return scoped_documents.filter(doc => doc.category === category_code);
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

    // Request a batch of document types from the client (modal "Request" button).
    async function handle_request_documents() {
        if (selected_request_ids.length === 0) return;
        set_is_requesting_docs(true);
        try {
            const result = await requestDocuments(client_id, selected_request_ids, active_business_id);
            if (result?.success) {
                toast.success("Documents requested from client");
                set_is_request_modal_open(false);
                set_selected_request_ids([]);
                set_request_search("");
                fetch_client_details();
            } else {
                toast.error((result as any)?.error || "Failed to request documents");
            }
        } catch (err: any) {
            console.error("uw request documents error:", err);
            toast.error("An unexpected error occurred");
        } finally {
            set_is_requesting_docs(false);
        }
    }

    // Re-request a single document type from the client (per-category button).
    async function handle_request_again(doc_type: { code: string; label: string }) {
        const def = all_available_docs.find(d => d.code === doc_type.code);
        if (!def) {
            toast.error("Document type not found in catalog");
            return;
        }
        set_requesting_again_code(doc_type.code);
        try {
            const result = await requestDocuments(client_id, [def.id], active_business_id);
            if (result?.success) {
                toast.success(`Re-requested ${doc_type.label}`);
                fetch_client_details();
            } else {
                toast.error((result as any)?.error || "Failed to request document");
            }
        } catch (err: any) {
            console.error("uw request again error:", err);
            toast.error("An unexpected error occurred");
        } finally {
            set_requesting_again_code(null);
        }
    }

    function format_file_size(bytes: number): string {
        if (!bytes) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    // ============================================
    // ADMIN-ONLY ACTION HANDLERS (advisor-side duties)
    // Available only when is_admin_route is true.
    // ============================================

    async function handle_admin_submit_vault() {
        if (!submit_vault_fico) return;
        set_is_submitting_vault(true);
        try {
            const res = await fetch('/api/advisor/clients/submit-vault', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id, credit_score: submit_vault_fico }),
            });
            const result = await res.json();
            if (result.success) {
                toast.success('Vault submitted to underwriting');
                set_is_submit_vault_open(false);
                set_submit_vault_fico("");
                fetch_client_details();
            } else {
                toast.error(result.error || 'Submission failed');
            }
        } catch (err: any) {
            console.error('admin submit vault error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_submitting_vault(false);
        }
    }

    async function handle_admin_funding_app_upload() {
        if (!funding_app_file) return;
        set_is_uploading_funding_app(true);
        try {
            if (funding_app_for_lenders) {
                // Lender version: just a shareable document under its own code.
                // Goes through the plain upload path, so none of the funding-app
                // side effects (deal-complete flag, GHL sync, request-doc flow)
                // fire — it's only a file to hand lenders.
                const ok = await run_doc_upload('funding_application_lenders', [funding_app_file]);
                if (ok) {
                    set_is_funding_app_open(false);
                    set_funding_app_file(null);
                    set_funding_app_for_lenders(false);
                }
                return;
            }
            const fd = new FormData();
            fd.append('file', funding_app_file);
            const result = await addManualFundingApplication(client_id, fd, active_business_id);
            if (result.success) {
                toast.success('Funding application uploaded');
                set_is_funding_app_open(false);
                set_funding_app_file(null);
                fetch_client_details();
            } else {
                toast.error(result.error || 'Upload failed');
            }
        } catch (err: any) {
            console.error('funding app upload error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_uploading_funding_app(false);
        }
    }

    // Core upload: sign → push to storage → register. Caller owns the spinner
    // and any modal/reset. Returns true when at least one file registered.
    async function run_doc_upload(doc_code: string, files: File[]): Promise<boolean> {
        if (files.length === 0 || !doc_code) return false;
        try {
            const supabase = createClient();

            const upload_results = await Promise.all(
                files.map(async (file) => {
                    try {
                        const sign_res = await fetch('/api/advisor/clients/upload/sign', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                client_id,
                                doc_code,
                                file_name: file.name,
                                file_type: file.type,
                            }),
                        });

                        if (!sign_res.ok) {
                            const text = await sign_res.text();
                            return { ok: false as const, file_name: file.name, error: text || `Sign failed (${sign_res.status})` };
                        }

                        const sign_result = await sign_res.json();
                        if (!sign_result.success) {
                            return { ok: false as const, file_name: file.name, error: sign_result.error || 'Sign failed' };
                        }

                        const { error: upload_error } = await supabase.storage
                            .from('user-documents')
                            .uploadToSignedUrl(sign_result.file_path, sign_result.token, file, {
                                contentType: file.type || 'application/octet-stream',
                                upsert: true,
                            });

                        if (upload_error) {
                            return { ok: false as const, file_name: file.name, error: upload_error.message };
                        }

                        return {
                            ok: true as const,
                            storage_path: sign_result.file_path as string,
                            file_name: file.name,
                            file_size: file.size,
                            file_type: file.type,
                        };
                    } catch (e: any) {
                        return { ok: false as const, file_name: file.name, error: e?.message || 'Upload failed' };
                    }
                })
            );

            const successful = upload_results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
            const failed = upload_results.filter((r) => !r.ok);

            failed.forEach((f) => {
                console.error(`doc upload failed for ${f.file_name}:`, f.error);
                toast.error(`Failed to upload ${f.file_name}: ${f.error}`);
            });

            if (successful.length === 0) return false;

            const res = await fetch('/api/advisor/clients/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id,
                    doc_code,
                    // Scope to the active business tab, else the doc is hidden
                    // from every per-business tab (client-scoped codes surface
                    // correctly regardless).
                    business_profile_id: active_business_id ?? null,
                    files: successful.map((s) => ({
                        storage_path: s.storage_path,
                        file_name: s.file_name,
                        file_size: s.file_size,
                        file_type: s.file_type,
                    })),
                }),
            });

            if (!res.ok) {
                const text = await res.text();
                toast.error(`Upload registration failed: ${text || res.status}`);
                return false;
            }

            const result = await res.json();
            if (result.success) {
                toast.success(`${result.uploaded} file(s) uploaded`);
                fetch_client_details();
                return true;
            }
            toast.error(result.error || 'Upload failed');
            return false;
        } catch (err: any) {
            console.error('doc upload error:', err);
            toast.error('An unexpected error occurred');
            return false;
        }
    }

    // Per-category Upload button → open the OS file picker straight away, then
    // upload to that category (no document-type menu — same feel as advisor).
    function trigger_category_upload(code: string) {
        set_inline_upload_code(code);
        if (category_upload_input_ref.current) {
            category_upload_input_ref.current.value = "";
            category_upload_input_ref.current.click();
        }
    }

    async function on_category_files_selected(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        const code = inline_upload_code;
        if (files.length === 0 || !code) return;
        set_inline_uploading_code(code);
        try {
            await run_doc_upload(code, files);
        } finally {
            set_inline_uploading_code(null);
        }
    }

    async function handle_admin_doc_upload() {
        if (doc_upload_files.length === 0 || !doc_upload_code) return;
        set_is_uploading_docs(true);
        try {
            const ok = await run_doc_upload(doc_upload_code, doc_upload_files);
            if (ok) {
                set_is_doc_upload_open(false);
                set_doc_upload_files([]);
                set_doc_upload_code("");
            }
        } finally {
            set_is_uploading_docs(false);
        }
    }

    async function handle_admin_delete_vault() {
        if (delete_confirm_text !== client_profile?.client_name) return;
        set_is_deleting_vault(true);
        try {
            const result = await deleteClientVault(client_id);
            if (result.success) {
                toast.success('Client vault deleted');
                router.push(queue_path);
            } else {
                toast.error(result.error || 'Failed to delete vault');
            }
        } catch (err: any) {
            console.error('admin delete vault error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_deleting_vault(false);
        }
    }

    /**
     * handle_rename: Updates a document's custom label
     */
    async function handle_rename() {
        if (!renaming_file || !renaming_file.label.trim()) return;

        setIs_renaming_loading(true);
        try {
            const res = await renameClientFile(renaming_file.id, renaming_file.label);
            if (res.success) {
                toast.success("Document renamed successfully.");
                // Update local state
                set_documents(prev => prev.map(d => 
                    d.id === renaming_file.id ? { ...d, custom_label: renaming_file.label } : d
                ));
                set_renaming_file(null);
            } else {
                toast.error(res.error || "Failed to rename document.");
            }
        } catch (err: any) {
            toast.error("An unexpected error occurred.");
        } finally {
            setIs_renaming_loading(false);
        }
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
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => set_renaming_file({ id: doc.id, label: doc.custom_label || doc.name })}
                                className="h-8 w-8 p-0 text-slate-400 hover:text-slate-900"
                                title="Rename Document"
                            >
                                <Pencil className="h-3.5 w-3.5" />
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
        const category_docs = scoped_documents.filter(d => d.category === doc_type.code);
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
                        {/* Request this doc from the client + upload it (admin + UW),
                            mirroring the advisor view */}
                        {can_upload && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={requesting_again_code === doc_type.code}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handle_request_again(doc_type);
                                }}
                                className="border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl h-8 px-3 font-black text-[9px] uppercase tracking-widest"
                            >
                                {requesting_again_code === doc_type.code ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : (
                                    <Send className="h-3.5 w-3.5 mr-1" />
                                )}
                                Request
                            </Button>
                        )}
                        {can_upload && (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={inline_uploading_code === doc_type.code}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    trigger_category_upload(doc_type.code);
                                }}
                                className="border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl h-8 px-3 font-black text-[9px] uppercase tracking-widest"
                            >
                                {inline_uploading_code === doc_type.code ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : (
                                    <UploadCloud className="h-3.5 w-3.5 mr-1" />
                                )}
                                Upload
                            </Button>
                        )}

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

        const ready_count = lender_assignments.filter(a => derive_lender_row_state(a) === 'ready_to_submit').length;
        const submitted_count = lender_assignments.filter(a => derive_lender_row_state(a) === 'submitted').length;

        const STATE_BADGE: Record<LenderRowState, { label: string; classes: string }> = {
            rejected_by_matcher: { label: 'Rejected (matcher)', classes: 'bg-rose-100 text-rose-700 hover:bg-rose-100' },
            skipped_by_admin:    { label: 'Skipped (admin)',     classes: 'bg-orange-100 text-orange-700 hover:bg-orange-100' },
            awaiting_admin:      { label: 'Awaiting admin',      classes: 'bg-amber-100 text-amber-700 hover:bg-amber-100' },
            ready_to_submit:     { label: 'Ready to submit',     classes: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' },
            submitted:           { label: 'Submitted · awaiting lender', classes: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
            approved_by_lender:  { label: 'Approved by lender',  classes: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' },
            declined_by_lender:  { label: 'Declined by lender',  classes: 'bg-rose-100 text-rose-700 hover:bg-rose-100' },
            funded:              { label: 'Funded',              classes: 'bg-violet-100 text-violet-700 hover:bg-violet-100' },
        };

        return (
            <div>
                <div className="px-5 py-4 border-b border-slate-100 flex flex-row items-center justify-between bg-slate-50/30 flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                        <div className="bg-emerald-500/10 p-2 rounded-xl">
                            <Star className="h-4 w-4 text-emerald-600" />
                        </div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            {ready_count} Ready · {submitted_count} Submitted · {lender_assignments.length} Total
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => set_is_bank_analysis_viewer_open(true)}
                            className="h-8 rounded-xl text-[9px] font-black uppercase tracking-widest border-slate-200 hover:bg-slate-50"
                        >
                            <BarChart3 className="w-3 h-3 mr-1.5" />
                            View Bank Analysis
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push(
                                is_admin_route
                                    ? `/admin/uw/lender-match?client=${client_id}`
                                    : `/underwriting/lender-match?client=${client_id}`
                            )}
                            className="h-8 rounded-xl text-[9px] font-black uppercase tracking-widest border-slate-200 hover:bg-slate-50"
                        >
                            <ExternalLink className="w-3 h-3 mr-1.5" />
                            Match Tool
                        </Button>
                        <UwAddLenderButton
                            clientId={client_id}
                            businessProfileId={active_business_id}
                            assignedLenderNames={lender_assignments.map((a) => a.lender_name)}
                            onAdded={fetch_lender_assignments}
                        />
                        <ShareWithLenderButton
                            clientId={client_id}
                            businessProfileId={active_business_id}
                            triggerLabel="Share"
                            lenderOptions={lender_assignments.map((a) => a.lender_name)}
                            className="h-8 rounded-xl text-[9px] font-black uppercase tracking-widest border border-slate-200 hover:bg-slate-50 text-slate-700 px-3"
                        />
                    </div>
                </div>
                <div>
                    <div className="divide-y divide-slate-100">
                        {lender_assignments.map((assign) => {
                            const row_state = derive_lender_row_state(assign);
                            const badge = STATE_BADGE[row_state];
                            const is_submitting_this = submitting_assignment_id === assign.id;
                            // Rows that are out the door (and not yet funded) get the inline
                            // status dropdown instead of a static badge.
                            const is_lifecycle_row =
                                row_state === 'submitted' ||
                                row_state === 'approved_by_lender' ||
                                row_state === 'declined_by_lender';
                            const tile_classes =
                                row_state === 'submitted'           ? 'bg-blue-500 text-white' :
                                row_state === 'approved_by_lender'  ? 'bg-emerald-500 text-white' :
                                row_state === 'ready_to_submit'     ? 'bg-emerald-500 text-white' :
                                row_state === 'funded'              ? 'bg-violet-500 text-white' :
                                row_state === 'awaiting_admin'      ? 'bg-amber-500 text-white' :
                                row_state === 'skipped_by_admin'    ? 'bg-orange-500 text-white' :
                                                                       'bg-rose-500 text-white';
                            const tile_glyph =
                                row_state === 'submitted'           ? '→' :
                                row_state === 'approved_by_lender'  ? '✓' :
                                row_state === 'ready_to_submit'     ? '✓' :
                                row_state === 'funded'              ? '★' :
                                row_state === 'awaiting_admin'      ? '…' :
                                                                       '✕';

                            return (
                                <div key={assign.id} className="p-4 hover:bg-slate-50/50 transition-all group">
                                  <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className={clsx(
                                            "w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shadow-sm shrink-0",
                                            tile_classes
                                        )}>
                                            {tile_glyph}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-black text-slate-900 group-hover:text-emerald-600 transition-colors uppercase tracking-tight truncate">
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
                                    <div className="flex items-center gap-3 shrink-0">
                                        {row_state === 'ready_to_submit' && (
                                            <Button
                                                size="sm"
                                                disabled={is_submitting_this}
                                                onClick={() => mark_assignment_submitted(assign.id)}
                                                className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm"
                                            >
                                                {is_submitting_this ? (
                                                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Submitting</>
                                                ) : (
                                                    'Mark as Submitted'
                                                )}
                                            </Button>
                                        )}
                                        <div className="text-right flex flex-col items-end">
                                            {is_lifecycle_row ? (
                                                // Submitted-lifecycle rows: the status pill is a dropdown so
                                                // UW can record the lender's verdict (or correct it) inline.
                                                <div className="relative inline-flex items-center">
                                                    <select
                                                        value={assign.status}
                                                        disabled={is_submitting_this}
                                                        onChange={(e) => mark_assignment_status(assign.id, e.target.value as 'submitted' | 'approved_by_lender' | 'declined_by_lender')}
                                                        className={clsx(
                                                            "appearance-none font-black text-[9px] uppercase tracking-widest pl-3 pr-7 py-1.5 rounded-md border-0 cursor-pointer outline-none disabled:opacity-60",
                                                            badge.classes
                                                        )}
                                                    >
                                                        <option value="submitted">Submitted · Awaiting Lender</option>
                                                        <option value="approved_by_lender">Lender Approved</option>
                                                        <option value="declined_by_lender">Lender Declined</option>
                                                    </select>
                                                    {is_submitting_this ? (
                                                        <Loader2 className="h-3 w-3 animate-spin absolute right-2 pointer-events-none" />
                                                    ) : (
                                                        <ChevronDown className="h-3 w-3 absolute right-2 pointer-events-none opacity-70" />
                                                    )}
                                                </div>
                                            ) : (
                                                <Badge className={clsx(
                                                    "font-black text-[9px] uppercase tracking-widest px-3 py-1",
                                                    badge.classes
                                                )}>
                                                    {badge.label}
                                                </Badge>
                                            )}
                                            <p className="text-[8px] font-bold text-slate-300 mt-1 uppercase tracking-tighter">
                                                Assigned {format(new Date(assign.assigned_at), 'MMM d')}
                                            </p>
                                        </div>
                                    </div>
                                  </div>
                                  {is_lifecycle_row && (
                                    <LenderResponsePanel assignmentId={assign.id} status={assign.status} />
                                  )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
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

    // Doc completion is computed against the active business tab. Client-scoped
    // docs surface on every tab via the scoped_* memos, so the completion
    // percentage is consistent across tabs for those rows.
    const completed_count = scoped_required_docs.filter(r => scoped_documents.some(d => d.category === r.code)).length;
    const total_count = scoped_required_docs.length;
    const completion_pct = Math.round((completed_count / (total_count || 1)) * 100);

    return (
        <div className="space-y-8">
            {/* Header / Actions */}
            <div className="flex items-center justify-between">
                <div className="inline-flex items-center bg-white rounded-2xl border border-slate-200 shadow-sm p-1.5 gap-1">
                    <button
                        onClick={() => prev_client_id && router.push(`${client_base_path}/${prev_client_id}`)}
                        disabled={!prev_client_id}
                        title="Previous client"
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Prev
                    </button>
                    <div className="w-px h-5 bg-slate-200" />
                    <button
                        onClick={() => router.push(queue_path)}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Queue
                        {current_nav_index >= 0 && navigable_client_ids.length > 0 && (
                            <span className="text-[10px] font-black tracking-wide bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md">
                                {current_nav_index + 1} / {navigable_client_ids.length}
                            </span>
                        )}
                    </button>
                    <div className="w-px h-5 bg-slate-200" />
                    <button
                        onClick={() => next_client_id && router.push(`${client_base_path}/${next_client_id}`)}
                        disabled={!next_client_id}
                        title="Next client"
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                        Next
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>


                <Dialog open={is_notify_modal_open} onOpenChange={set_is_notify_modal_open}>
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
                                    {scoped_required_docs.map((doc) => {
                                        const is_done = scoped_documents.some(d => d.category === doc.code);
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
                                        .filter(doc => !scoped_required_docs.some(r => r.code === doc.code))
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
            </div>

            {/* Section folding controls — same pattern as the advisor page so
                UW + admin can blow open or collapse everything in one click. */}
            <div className="flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={() => broadcast_toggle_all(true)}
                    className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-emerald-600 transition-colors px-3 py-1.5 rounded-lg border border-slate-200 bg-white shadow-sm"
                >
                    Expand all
                </button>
                <button
                    type="button"
                    onClick={() => broadcast_toggle_all(false)}
                    className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-emerald-600 transition-colors px-3 py-1.5 rounded-lg border border-slate-200 bg-white shadow-sm"
                >
                    Collapse all
                </button>
            </div>

            {/* Admin Quick Actions — only when an admin is viewing this page.
                Surfaces advisor-side duties (edit profile, manage followers,
                submit vault, upload docs, delete) that aren't part of the UW
                workflow but admins need on the same screen so they don't have
                to switch portals. */}
            {is_admin_route && (
                <CollapsibleSection
                    clientId={client_id}
                    slug="uw-admin-actions"
                    title="Admin Actions"
                    defaultOpen
                >
                <div className="p-6 space-y-4">
                        <div className="flex flex-wrap gap-2">
                            <Button
                                onClick={() => set_is_edit_profile_open(true)}
                                size="sm"
                                className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm"
                            >
                                <Pencil className="w-3.5 h-3.5 mr-1.5" />
                                Edit Profile
                            </Button>
                            <Button
                                onClick={() => set_is_submit_vault_open(true)}
                                size="sm"
                                variant="outline"
                                className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest"
                            >
                                <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                                Submit to UW
                            </Button>
                            <Button
                                onClick={() => set_is_doc_upload_open(true)}
                                size="sm"
                                variant="outline"
                                className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest"
                            >
                                <Plus className="w-3.5 h-3.5 mr-1.5" />
                                Upload Doc
                            </Button>
                            <Button
                                onClick={() => set_is_funding_app_open(true)}
                                size="sm"
                                variant="outline"
                                className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest"
                            >
                                <FileText className="w-3.5 h-3.5 mr-1.5" />
                                Funding App
                            </Button>
                            <Button
                                onClick={() => set_is_delete_vault_open(true)}
                                size="sm"
                                variant="outline"
                                className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                            >
                                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                Delete Vault
                            </Button>
                        </div>
                        <ClientFollowersCard clientId={client_id} canManage={true} />
                </div>
                </CollapsibleSection>
            )}

            {/* Edit profile modal (admin-only — but harmless to mount when closed) */}
            {is_admin_route && client_profile && (
                <EditProfileModal
                    isOpen={is_edit_profile_open}
                    onClose={() => set_is_edit_profile_open(false)}
                    onSuccess={fetch_client_details}
                    clientData={client_profile as any}
                />
            )}

            {/* Inline bank analysis viewer (UW + admin both) */}
            <BankAnalysisViewer
                clientId={client_id}
                isOpen={is_bank_analysis_viewer_open}
                onClose={() => set_is_bank_analysis_viewer_open(false)}
            />

            {/* Submit to Underwriting confirmation (admin-only) */}
            {is_admin_route && (
                <Dialog
                    open={is_submit_vault_open}
                    onOpenChange={(open) => { if (!is_submitting_vault) set_is_submit_vault_open(open); }}
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Submit Vault to Underwriting?</DialogTitle>
                            <DialogDescription>
                                Submit <strong>{client_profile?.client_name}</strong>'s vault to the underwriting queue. UW will be notified.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 border-y border-slate-100 my-2 space-y-2">
                            <Label htmlFor="submit_vault_fico" className="text-xs font-black uppercase tracking-widest text-slate-400">
                                Client FICO Score
                            </Label>
                            <Input
                                id="submit_vault_fico"
                                type="number"
                                placeholder="e.g. 720"
                                value={submit_vault_fico}
                                onChange={(e) => set_submit_vault_fico(e.target.value)}
                                className="h-12 rounded-xl"
                            />
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => set_is_submit_vault_open(false)} disabled={is_submitting_vault}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handle_admin_submit_vault}
                                disabled={is_submitting_vault || !submit_vault_fico}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                            >
                                {is_submitting_vault ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Submitting...</> : <><ShieldCheck className="h-4 w-4 mr-2" />Submit</>}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {/* Manual Funding Application Upload (admin + UW) */}
            {can_upload && (
                <Dialog
                    open={is_funding_app_open}
                    onOpenChange={(open) => { if (!is_uploading_funding_app) { set_is_funding_app_open(open); if (!open) set_funding_app_for_lenders(false); } }}
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Upload Funding Application</DialogTitle>
                            <DialogDescription>
                                {funding_app_for_lenders
                                    ? "Lender version (agreement page removed). Stored as a shareable document only — it won't mark the deal complete, sync to GHL, or request anything from the client."
                                    : "Signed application for clients who signed outside the vault. Marks the vault application as completed and syncs to GHL."}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
                                <Checkbox
                                    checked={funding_app_for_lenders}
                                    onCheckedChange={(c) => set_funding_app_for_lenders(c === true)}
                                    className="mt-0.5"
                                />
                                <span className="text-xs text-slate-600">
                                    <span className="font-black uppercase tracking-widest text-slate-500">For lenders (omit agreement page)</span>
                                    <br />
                                    Upload the lender-facing copy without the agreement page — no deal-complete, GHL, or document-request triggers.
                                </span>
                            </label>
                            <div className="space-y-2">
                                <Label htmlFor="funding_app_file" className="text-xs font-black uppercase tracking-widest text-slate-400">
                                    Application (PDF)
                                </Label>
                                <Input
                                    id="funding_app_file"
                                    type="file"
                                    accept=".pdf"
                                    onChange={(e) => set_funding_app_file(e.target.files?.[0] ?? null)}
                                    className="h-12 rounded-xl"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => set_is_funding_app_open(false)} disabled={is_uploading_funding_app}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handle_admin_funding_app_upload}
                                disabled={is_uploading_funding_app || !funding_app_file}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                            >
                                {is_uploading_funding_app ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</> : <><UploadCloud className="h-4 w-4 mr-2" />Upload</>}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {/* Upload documents on behalf of client (admin-only) */}
            {/* Hidden input backing the per-category direct upload */}
            <input
                ref={category_upload_input_ref}
                type="file"
                multiple
                className="hidden"
                onChange={on_category_files_selected}
            />

            {/* Request documents from the client (admin + UW) */}
            {can_upload && (
                <Dialog
                    open={is_request_modal_open}
                    onOpenChange={(open) => { if (!is_requesting_docs) set_is_request_modal_open(open); }}
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Request Documents from Client</DialogTitle>
                            <DialogDescription>
                                Select the document types to request. The client is notified and the items appear in their vault.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-2 space-y-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input
                                    value={request_search}
                                    onChange={(e) => set_request_search(e.target.value)}
                                    placeholder="Search document types…"
                                    className="h-10 rounded-xl pl-9"
                                />
                            </div>
                            <div className="max-h-[320px] overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                                {all_available_docs
                                    .filter(d => !scoped_required_docs.some(r => r.code === d.code))
                                    .filter(d => d.label.toLowerCase().includes(request_search.toLowerCase()))
                                    .map(d => {
                                        const checked = selected_request_ids.includes(d.id);
                                        return (
                                            <label
                                                key={d.id}
                                                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => set_selected_request_ids(prev =>
                                                        prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id]
                                                    )}
                                                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                />
                                                <span className="text-sm text-slate-700 flex-1">{d.label}</span>
                                            </label>
                                        );
                                    })}
                                {all_available_docs.filter(d => !scoped_required_docs.some(r => r.code === d.code)).length === 0 && (
                                    <p className="text-xs text-slate-400 py-4 text-center">All document types are already requested.</p>
                                )}
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => set_is_request_modal_open(false)} disabled={is_requesting_docs}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handle_request_documents}
                                disabled={is_requesting_docs || selected_request_ids.length === 0}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                            >
                                {is_requesting_docs ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Requesting…</> : <><Send className="h-4 w-4 mr-2" />Request {selected_request_ids.length > 0 ? `(${selected_request_ids.length})` : ""}</>}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {can_upload && (
                <Dialog
                    open={is_doc_upload_open}
                    onOpenChange={(open) => { if (!is_uploading_docs) set_is_doc_upload_open(open); }}
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Upload Document on Behalf of Client</DialogTitle>
                            <DialogDescription>
                                Choose the document type and attach the file(s). The upload is recorded as advisor-uploaded.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            <div className="space-y-2">
                                <Label className="text-xs font-black uppercase tracking-widest text-slate-400">Document type</Label>
                                <select
                                    value={doc_upload_code}
                                    onChange={(e) => set_doc_upload_code(e.target.value)}
                                    className="w-full h-12 rounded-xl border border-slate-200 px-3 text-sm font-medium bg-white"
                                >
                                    <option value="">Select a document type…</option>
                                    {all_available_docs.map(d => (
                                        <option key={d.code} value={d.code}>{d.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="doc_upload_files" className="text-xs font-black uppercase tracking-widest text-slate-400">File(s)</Label>
                                <Input
                                    id="doc_upload_files"
                                    type="file"
                                    multiple
                                    onChange={(e) => set_doc_upload_files(Array.from(e.target.files ?? []))}
                                    className="h-12 rounded-xl"
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => set_is_doc_upload_open(false)} disabled={is_uploading_docs}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handle_admin_doc_upload}
                                disabled={is_uploading_docs || !doc_upload_code || doc_upload_files.length === 0}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                            >
                                {is_uploading_docs ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</> : <><UploadCloud className="h-4 w-4 mr-2" />Upload {doc_upload_files.length > 0 ? `(${doc_upload_files.length})` : ""}</>}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {/* Delete vault confirmation (admin-only, destructive) */}
            {is_admin_route && (
                <Dialog
                    open={is_delete_vault_open}
                    onOpenChange={(open) => {
                        if (!is_deleting_vault) {
                            set_is_delete_vault_open(open);
                            if (!open) set_delete_confirm_text("");
                        }
                    }}
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle className="text-red-600">Delete Client Vault?</DialogTitle>
                            <DialogDescription>
                                This permanently deletes <strong>{client_profile?.client_name}</strong>'s vault, all documents, notes, lender assignments, bank analyses, and pipeline history. This cannot be undone.
                                <br /><br />
                                Type the client's name <strong>{client_profile?.client_name}</strong> to confirm.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <Input
                                value={delete_confirm_text}
                                onChange={(e) => set_delete_confirm_text(e.target.value)}
                                placeholder={client_profile?.client_name ?? ""}
                                className="h-12 rounded-xl"
                            />
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => set_is_delete_vault_open(false)} disabled={is_deleting_vault}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handle_admin_delete_vault}
                                disabled={is_deleting_vault || delete_confirm_text !== client_profile?.client_name}
                                className="bg-red-600 hover:bg-red-700 text-white"
                            >
                                {is_deleting_vault ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</> : <><Trash2 className="h-4 w-4 mr-2" />Delete Permanently</>}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {/* Status row — pipeline + activity at a glance */}
            {(() => {
                const last_upload = documents.length > 0
                    ? documents.reduce((a, b) => new Date(a.upload_date) > new Date(b.upload_date) ? a : b).upload_date
                    : null;
                const upload_baseline = last_upload ?? client_profile.created_at;
                const days_since_last_upload = differenceInDays(new Date(), new Date(upload_baseline));
                const has_missing_docs = completion_pct < 100;
                const show_upload_alert = days_since_last_upload >= 5 && has_missing_docs;
                return (
                    <div className="flex items-center gap-2 flex-wrap">
                        <LoanPipelineBadge currentStatus={current_pipeline_status} />
                        <ActivityAgeBadge
                            created_at={client_profile.created_at}
                            last_activity_at={last_activity_at}
                            reassigned_to_catch_all_at={client_profile.reassigned_to_catch_all_at}
                        />
                        {show_upload_alert && (
                            <span
                                className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700"
                                title={last_upload
                                    ? `Last upload was ${days_since_last_upload} day${days_since_last_upload === 1 ? "" : "s"} ago`
                                    : `No client uploads since vault was created ${days_since_last_upload} day${days_since_last_upload === 1 ? "" : "s"} ago`}
                            >
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                                {last_upload ? `No uploads · ${days_since_last_upload}d` : `No uploads yet · ${days_since_last_upload}d`}
                            </span>
                        )}
                    </div>
                );
            })()}

            {/* Business tab strip — surface per-business doc reviews. The
                "+ Add Business" CTA is intentionally omitted on the UW side;
                creating new businesses lives with advisors. Delete is also
                hidden here. Single-business clients render no tabs since
                show_when_single defaults to true but the strip is a no-op
                visually when there's only one business and no actions. */}
            <BusinessTabStrip
                businesses={businesses}
                active_business_id={active_business_id}
                on_select={set_active_business_id}
            />

            {/* Outstanding Documents Banner */}
            {render_outstanding_banner(scoped_required_docs)}

            {/* Pipeline Status Card */}
            <CollapsibleSection
                clientId={client_id}
                slug="uw-pipeline"
                title="Funding Pipeline"
                summary={current_pipeline_status.replace(/_/g, " ")}
                accessory={
                    <div className="flex flex-wrap gap-2">
                        {(() => {
                            const currentIdx = PIPELINE_STEPS.findIndex((s: { status: LoanStatus }) => s.status === current_pipeline_status);
                            const nextStep = currentIdx >= 0 && currentIdx < PIPELINE_STEPS.length - 1 ? PIPELINE_STEPS[currentIdx + 1] : null;
                            return nextStep ? (
                                <Button
                                    size="sm"
                                    className="h-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-black uppercase tracking-widest text-[9px] shadow-lg shadow-emerald-500/20"
                                    onClick={() => handleAdvanceStatus(nextStep.status)}
                                    disabled={is_advancing_status}
                                >
                                    {is_advancing_status ? <Loader2 className="w-4 h-4 animate-spin" /> : `→ ${nextStep.shortLabel}`}
                                </Button>
                            ) : null;
                        })()}
                        {current_pipeline_status !== "declined" && current_pipeline_status !== "funded" && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-8 border-red-200 text-red-500 hover:bg-red-50 rounded-lg font-black uppercase tracking-widest text-[9px]"
                                onClick={() => handleAdvanceStatus("declined")}
                                disabled={is_advancing_status}
                            >
                                Decline
                            </Button>
                        )}
                    </div>
                }
                defaultOpen
            >
            <div className="px-8 py-6">
                <LoanPipelineFull
                    currentStatus={current_pipeline_status}
                    history={pipeline_history}
                    onStatusChange={handleAdvanceStatus}
                />
            </div>
            </CollapsibleSection>

            {/* Profile Hero */}
            <Card className="bg-slate-900 text-white border-slate-800 rounded-[3rem] shadow-2xl overflow-hidden relative">
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-[100px] -mr-32 -mt-32" />
                <CardContent className="p-10 relative z-10 flex flex-col md:flex-row justify-between items-center gap-8">
                    <div className="space-y-4 text-center md:text-left">
                        <Badge className="bg-white/10 text-emerald-400 hover:bg-white/10 border-white/20 uppercase tracking-widest font-black text-[10px] px-3 py-1">
                            {completion_pct}% Documentation Verified
                        </Badge>
                        {/* Company name leads — UW identifies the file by
                            business. When a non-primary tab is active we
                            display that business's name; primary falls back
                            to client_profile.company_name. */}
                        <h2 className="text-4xl md:text-5xl font-black uppercase tracking-tighter leading-none">
                            {(() => {
                                const active = businesses.find((b) => b.id === active_business_id);
                                const useBiz = active && !active.is_primary;
                                return useBiz ? active!.company_name : client_profile.company_name;
                            })()}
                        </h2>
                        {(() => {
                            // Rescope the funding figures to the active business.
                            // Non-primary businesses carry their ask on funding_deals
                            // (flattened onto the tab); primary falls back to the
                            // client_data_vault row.
                            const active = businesses.find((b) => b.id === active_business_id);
                            const useBiz = active && !active.is_primary;
                            const amount = useBiz ? (active!.capital_requested ?? 0) : client_profile.capital_requested;
                            const loanType = useBiz ? active!.proposed_loan_type : client_profile.proposed_loan_type;
                            return (
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-6 text-slate-400 font-bold">
                            <span className="flex items-center gap-2"><Building2 className="w-4 h-4" /> {client_profile.client_name}</span>
                            <span className="flex items-center gap-2 text-emerald-400"><DollarSign className="w-4 h-4" /> {(amount ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span>
                            {loanType && <span className="flex items-center gap-2">{loanType}</span>}
                        </div>
                            );
                        })()}
                    </div>

                    {/* Deal actions — notify advisor, mark funded, and (once docs
                        are approved) the Slack channel — grouped in the card so
                        they read like the advisor/admin profile header. */}
                    <div className="flex flex-col items-center md:items-end gap-2 shrink-0">
                        <div className="flex flex-wrap items-center justify-center md:justify-end gap-2">
                            <Button
                                onClick={() => set_is_notify_modal_open(true)}
                                className="h-11 px-5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/20 text-white font-black uppercase tracking-widest text-[10px] transition-all"
                            >
                                <Bell className="w-4 h-4 mr-2" />
                                Notify Advisor
                            </Button>
                            {(() => {
                                // Rescope the funded modal to the active business: the
                                // requested amount, the lenders that actually reached
                                // submission, and the deal row that receives the funded
                                // figures all key off the business currently in view.
                                const active = businesses.find((b) => b.id === active_business_id);
                                const useBiz = active && !active.is_primary;
                                const requested = useBiz ? (active!.capital_requested ?? null) : (client_profile.capital_requested ?? null);
                                const FUNDED_LABEL: Record<string, string> = {
                                    submitted: 'Submitted',
                                    approved_by_lender: 'Approved by lender',
                                    funded: 'Funded',
                                };
                                const lenderOptions = lender_assignments
                                    .filter((a) => ['submitted', 'approved_by_lender', 'funded'].includes(a.status))
                                    .map((a) => ({
                                        assignmentId: a.id,
                                        lenderName: a.lender_name,
                                        stateLabel: FUNDED_LABEL[a.status] ?? a.status,
                                    }));
                                return (
                            <LoanFundedDialog
                                clientId={client_id}
                                clientName={client_profile.client_name}
                                businessProfileId={active_business_id}
                                amountRequested={requested}
                                lenderOptions={lenderOptions}
                                defaultSalesRep={`${client_profile.advisor?.first_name ?? ''} ${client_profile.advisor?.last_name ?? ''}`.trim()}
                                defaultSlackChannel={slack_channel.name ?? ''}
                                onSuccess={() => { fetch_client_details(); fetch_lender_assignments(); }}
                                triggerClassName="h-11 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-500/20"
                            />
                                );
                            })()}
                        </div>
                        {SLACK_FEATURE_ENABLED && (
                            slack_channel.id ? (
                                <a
                                    href={`https://slack.com/app_redirect?channel=${slack_channel.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 h-11 px-5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/20 text-white font-black uppercase tracking-widest text-[10px] transition-all"
                                >
                                    <Slack className="w-4 h-4 text-emerald-400" />
                                    Open Slack Channel
                                    <ExternalLink className="w-3 h-3 opacity-60" />
                                </a>
                            ) : (
                                <>
                                    <Button
                                        onClick={create_slack_channel}
                                        disabled={!is_docs_approved || is_creating_slack_channel}
                                        className="h-11 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {is_creating_slack_channel ? (
                                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</>
                                        ) : (
                                            <><Slack className="w-4 h-4 mr-2" /> Create Slack Channel</>
                                        )}
                                    </Button>
                                    {!is_docs_approved && (
                                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest max-w-[12rem] text-center md:text-right">
                                            Available once all documents are approved
                                        </p>
                                    )}
                                </>
                            )
                        )}
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-20">
                {/* Information Column */}
                <div className="lg:col-span-1 space-y-6">
                    <CollapsibleSection
                        clientId={client_id}
                        slug="uw-company-integrity"
                        title="Company Integrity"
                        defaultOpen
                    >
                    <div className="p-6 space-y-4">
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
                    </div>
                    </CollapsibleSection>

                    <CollapsibleSection
                        clientId={client_id}
                        slug="uw-ownership"
                        title="Ownership & Structure"
                        summary={`${client_profile.number_of_owners} owner${String(client_profile.number_of_owners) === "1" ? "" : "s"}`}
                        defaultOpen={false}
                    >
                    <div className="p-6 space-y-4">
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
                    </div>
                    </CollapsibleSection>

                    <CollapsibleSection
                        clientId={client_id}
                        slug="uw-contact"
                        title="Client Direct Contact"
                        summary={client_profile.client_email}
                        defaultOpen={false}
                    >
                    <div className="p-6 space-y-3">
                            <div className="flex items-center gap-3 p-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-colors">
                                <Mail className="w-5 h-5 text-emerald-500" />
                                <span className="truncate text-sm">{client_profile.client_email}</span>
                            </div>
                            <div className="flex items-center gap-3 p-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-colors">
                                <Phone className="w-5 h-5 text-emerald-500" />
                                <span className="text-sm">{client_profile.client_phone}</span>
                            </div>
                    </div>
                    </CollapsibleSection>

                    {/* Internal Notes Feed */}
                    <CollapsibleSection
                        clientId={client_id}
                        slug="uw-internal-comm"
                        title="Internal Communication"
                        summary={notes.length === 0 ? "No notes yet" : `${notes.length} note${notes.length === 1 ? "" : "s"}`}
                        accessory={<Badge variant="outline" className="text-[9px]">{notes.length}</Badge>}
                        defaultOpen
                    >
                    <div className="flex flex-col h-[500px] p-6">
                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
                        </div>
                    </div>
                    </CollapsibleSection>
                </div>

                {/* Documents Column */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Use of Proceeds & Open Positions Section */}
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 gap-6">
                            {/* Use of Proceeds */}
                            <CollapsibleSection
                                clientId={client_id}
                                slug="uw-use-of-proceeds"
                                title="Use of Proceeds"
                                summary={client_profile.loan_purpose ? client_profile.loan_purpose.slice(0, 60) : "Not specified"}
                                defaultOpen
                            >
                            <div className="p-6">
                                    <p className="text-sm font-bold text-slate-700 leading-relaxed italic">
                                        "{client_profile.loan_purpose || "No use of proceeds specified."}"
                                    </p>
                            </div>
                            </CollapsibleSection>

                            {/* Lender Matching Results */}
                            <CollapsibleSection
                                clientId={client_id}
                                slug="uw-lender-matches"
                                title="Lender Matching Results"
                                defaultOpen
                            >
                                {render_lender_assignments()}
                            </CollapsibleSection>

                            {/* Open Positions Table */}
                            <CollapsibleSection
                                clientId={client_id}
                                slug="uw-open-positions"
                                title="Open Positions (Previous Debt)"
                                summary={open_positions.length === 0 ? "None reported" : `${open_positions.length} position${open_positions.length === 1 ? "" : "s"}`}
                                accessory={<Badge variant="outline" className="text-emerald-500 font-black">{open_positions.length}</Badge>}
                                defaultOpen
                            >
                            <div className="overflow-hidden">
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
                                </div>
                            </CollapsibleSection>
                        </div>
                    </div>

                    {/* Required Documents Section */}
                    <CollapsibleSection
                        clientId={client_id}
                        slug="uw-required-docs"
                        title="Required Review Packet"
                        summary={`${completion_pct}% complete · ${completed_count}/${total_count} docs`}
                        accessory={
                            can_upload ? (
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            set_funding_app_for_lenders(true);
                                            set_funding_app_file(null);
                                            set_is_funding_app_open(true);
                                        }}
                                        className="h-8 rounded-lg text-[9px] font-black uppercase tracking-widest border-slate-200 hover:bg-slate-50"
                                    >
                                        <FileText className="w-3.5 h-3.5 mr-1.5" />
                                        Funding App (Lenders)
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            set_selected_request_ids([]);
                                            set_request_search("");
                                            set_is_request_modal_open(true);
                                        }}
                                        className="h-8 rounded-lg text-[9px] font-black uppercase tracking-widest border-slate-200 hover:bg-slate-50"
                                    >
                                        <Send className="w-3.5 h-3.5 mr-1.5" />
                                        Request Doc
                                    </Button>
                                </div>
                            ) : undefined
                        }
                        defaultOpen
                    >
                    <div className="space-y-4 p-6">
                        {scoped_required_docs.map((docType) => render_document_category(docType))}
                    </div>
                    </CollapsibleSection>

                    {/* Uncategorized Documents Section */}
                    {scoped_documents.filter(d => !scoped_required_docs.some(r => r.code === d.category)).length > 0 && (
                        <CollapsibleSection
                            clientId={client_id}
                            slug="uw-misc-files"
                            title="Miscellaneous Files"
                            summary={`${scoped_documents.filter(d => !scoped_required_docs.some(r => r.code === d.category)).length} file(s)`}
                            defaultOpen={false}
                        >
                        <div className="p-6">
                            <div className="grid grid-cols-1 gap-4">
                                {scoped_documents.filter(d => !scoped_required_docs.some(r => r.code === d.category)).map(doc => render_document_card(doc))}
                            </div>
                        </div>
                        </CollapsibleSection>
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
                onRename={preview_modal.doc ? () => set_renaming_file({
                    id: preview_modal.doc!.id,
                    label: preview_modal.doc!.custom_label || preview_modal.doc!.name,
                }) : undefined}
            />

            {/* Rename Document Dialog */}
            <Dialog open={!!renaming_file} onOpenChange={(open) => !open && set_renaming_file(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Rename Document</DialogTitle>
                        <DialogDescription>
                            Enter a new display name for this document. This will be visible to the advisor and client as well.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="new-name">Display Name</Label>
                            <Input
                                id="new-name"
                                value={renaming_file?.label || ""}
                                onChange={(e) => set_renaming_file(prev => prev ? { ...prev, label: e.target.value } : null)}
                                placeholder="e.g. 12 Months Bank Statements"
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handle_rename();
                                }}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => set_renaming_file(null)}
                            disabled={is_renaming_loading}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handle_rename}
                            disabled={!renaming_file?.label.trim() || is_renaming_loading}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                            {is_renaming_loading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Renaming...
                                </>
                            ) : (
                                "Save Changes"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
