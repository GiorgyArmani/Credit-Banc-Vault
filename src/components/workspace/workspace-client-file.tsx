// src/components/workspace/workspace-client-file.tsx
//
// The client file. Rendered by three portals, differing only in `basePath`:
//   /advisor/dashboard   staff advisors
//   /admin               admins (adds reassign-advisor and lender-match review)
//   /partner             external partner advisors working their own deals
//
// Reads go through the browser client under RLS, and that is exactly what makes
// this safe to hand to an external partner_advisor: every advisor-scoped policy
// is `is_advisor_user() AND is_assigned_advisor_for(<vault>)`, so the database
// bounds them to files they own or follow no matter what this component asks
// for. The owner/follower check below produces a better error message; it is not
// the fence.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import { canUseAdvisorWorkspace, isScopedAdvisorRole } from "@/lib/auth/roles";
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
    UserCog,
    BarChart3,
    XCircle,
    Download,
    ChevronLeft,
    ChevronRight,
    ArrowBigUp,
    ArrowUp,
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
    generateMagicLink,
    updateClientSignupNotes,
    setReferralPartner,
    reassignClientAdvisor
} from "@/app/advisor/dashboard/clients/[id]/actions";
import { fetchInternalNotes, addInternalNote } from "@/app/actions/internal-notes";
import { fetchFileNotes, addFileNote } from "@/app/actions/client-file-notes";
import { toast } from "@/lib/toast";
import { copy_to_clipboard } from "@/lib/clipboard";
import clsx from "clsx";
import { format, differenceInDays } from "date-fns";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EditProfileModal } from "@/app/advisor/dashboard/clients/[id]/edit-profile-modal";
import { getClientPipelineHistory, updateLoanStatus, type LoanStatus, type PipelineStatusEntry } from "@/app/actions/pipeline";
import { getBulkClientActivity } from "@/app/actions/advisor";
import { ActivityAgeBadge } from "@/components/advisor/activity-age-badge";
import DocumentPreviewModal from "@/components/pdf/pdf-viewer";

// ── New UI components ─────────────────────────────────────────────────────────
import { ClientProfileHeader } from "@/app/advisor/dashboard/clients/[id]/_components/client-profile-header";
import { BusinessTabStrip, type BusinessTab } from "@/app/advisor/dashboard/clients/[id]/_components/business-tab-strip";
import { AddBusinessModal } from "@/app/advisor/dashboard/clients/[id]/_components/add-business-modal";
import { ClientCommandBar } from "@/components/workspace/client-command-bar";
import { DocumentUploadStatus } from "@/app/advisor/dashboard/clients/[id]/_components/document-upload-status";
import { InternalCommunication } from "@/app/advisor/dashboard/clients/[id]/_components/internal-communication";
import { SubmitUnderwritingCTA } from "@/app/advisor/dashboard/clients/[id]/_components/submit-underwriting-cta";
import { ClientFollowersCard } from "@/app/advisor/dashboard/clients/[id]/_components/client-followers-card";
import { FundingRoundsCard } from "@/components/funding/funding-rounds-card";
import { listClientFollowers, type FollowerRow } from "@/app/advisor/dashboard/clients/[id]/follower-actions";
import { ClientNotesCard, type FileNote } from "@/app/advisor/dashboard/clients/[id]/_components/client-notes-card";
// M2 / Communications Hub — hidden until the outbound-email identity question is
// settled (advisors sit on creditbanc.io, Mailgun sends from creditbanc.net, and
// creditbanc.io is at DMARC p=quarantine, so "from the advisor" would be
// spam-foldered until creditbanc.io is added as a Mailgun sending domain).
// Everything behind this — table, adapters, webhooks — is built and inert; only
// the entry point is withdrawn. Restore both this import and the section below.
// import { CommunicationsTimeline } from "@/app/advisor/dashboard/clients/[id]/_components/communications-timeline";
import { AdminLenderReviewCard } from "@/components/admin/admin-lender-review-card";
import { CollapsibleSection, broadcast_toggle_all } from "@/app/advisor/dashboard/clients/[id]/_components/collapsible-section";
import { isClientScopedDoc, matchesActiveBusiness, matchesActiveDeal, normalizeSupabaseJoin } from "@/lib/document-scope";
import { offersGrouping, groupsForDocCode } from "@/lib/document-groups";
import { zipDocuments, downloadDocument } from "@/lib/document-download";
import { DocumentGroupPicker } from "@/components/document-group-picker";
import { useDocumentGroups } from "@/hooks/use-document-groups";

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
// MODULE-LEVEL CACHES
// ============================================
// These caches survive client-side navigations within the same tab session
// (they reset on full page reload). They eliminate repeated round-trips for
// data that is stable across navigations: the advisor's identity, the list
// of clients they can see, and the global required_documents lookup table.

type CachedIdentity = {
    user_id: string;
    email: string;
    role: string;
    advisor: { id: string; first_name: string; last_name: string; email: string } | null;
    expires_at: number;
};

type CachedNavigable = { user_id: string; ids: string[]; expires_at: number };

type CachedDocTypes = { items: { id: string; code: string; label: string }[]; expires_at: number };

const IDENTITY_TTL_MS = 5 * 60 * 1000;
const NAVIGABLE_TTL_MS = 60 * 1000;
const DOC_TYPES_TTL_MS = 10 * 60 * 1000;

let identity_cache: CachedIdentity | null = null;
let identity_inflight: Promise<CachedIdentity | null> | null = null;
let navigable_cache: CachedNavigable | null = null;
let doc_types_cache: CachedDocTypes | null = null;

/**
 * Resolves the current advisor identity (user → users → advisors) with caching
 * and in-flight de-duplication. Returns null if any step fails — callers handle
 * the UI fallout based on what's missing on the cached object (role, advisor).
 */
async function resolve_identity_cached(supabase: ReturnType<typeof createClient>): Promise<CachedIdentity | null> {
    if (identity_cache && Date.now() < identity_cache.expires_at) {
        return identity_cache;
    }
    if (identity_inflight) return identity_inflight;

    identity_inflight = (async () => {
        try {
            const { data: { user }, error: auth_error } = await supabase.auth.getUser();
            if (auth_error || !user) return null;

            const { data: user_data } = await supabase
                .from("users")
                .select("id, role, email")
                .eq("id", user.id)
                .maybeSingle();
            if (!user_data) return null;

            let advisor: CachedIdentity["advisor"] = null;
            // Advisor-shaped roles have a row in the advisors table; admins skip
            // this step. partner_advisor MUST be included — without the advisors
            // row `identity.advisor` stays null and the access gate below denies
            // them their own client.
            if (isScopedAdvisorRole(user_data.role)) {
                const { data: by_uid } = await supabase
                    .from("advisors")
                    .select("id, first_name, last_name, email")
                    .eq("user_id", user.id)
                    .maybeSingle();
                if (by_uid) {
                    advisor = by_uid;
                } else {
                    const { data: by_email } = await supabase
                        .from("advisors")
                        .select("id, first_name, last_name, email")
                        .eq("email", user_data.email)
                        .maybeSingle();
                    advisor = by_email ?? null;
                }
            }

            const result: CachedIdentity = {
                user_id: user.id,
                email: user_data.email,
                role: user_data.role,
                advisor,
                expires_at: Date.now() + IDENTITY_TTL_MS,
            };
            identity_cache = result;
            return result;
        } finally {
            identity_inflight = null;
        }
    })();

    return identity_inflight;
}

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
    additional_notes?: string;
    proposed_loan_type?: string;
    funding_eta?: string;
    employees_count?: number;
    is_home_based?: boolean | null;
    referral_partner?: string | null;
    advisor_id?: string | null;
    advisor_name?: string | null;
    reassignment_paused_until?: string | null;
    reassigned_to_catch_all_at?: string | null;
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
    business_profile_id?: string | null;
    /** Set on files filed into a group within their own field. */
    document_group_id?: string | null;
    /** Carries metadata.original_file_name, which dates a periodic file. */
    metadata?: any;
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

// matchesActiveBusiness now lives in @/lib/document-scope alongside
// isClientScopedDoc — same shared implementation used by the UW page,
// vault.tsx, and any future surface. Don't re-define it here.

export function WorkspaceClientFile({ basePath }: { basePath: string }) {
    // ============================================
    // STATE MANAGEMENT
    // ============================================

    const supabase = createClient();
    const router = useRouter();
    const params = useParams();
    const client_id = params.id as string;

    // Keep navigation inside whichever portal the user entered from. Every
    // back/prev/next link is built off basePath, so an admin isn't bounced into
    // the advisor layout and a partner isn't bounced into either.
    //
    // is_admin_path additionally gates the two ADMIN-ONLY sections below
    // (reassign advisor, lender-match review). It is a portal test, not a
    // permission test — the underlying actions re-check the role server-side.
    const is_admin_path = basePath.startsWith("/admin");
    const client_detail_path = (id: string) => {
        const base = `${basePath}/clients/${id}`;
        // Preserve the pipeline context across prev/next so the filtered set + counter persist.
        return came_from_pipeline ? `${base}?from=pipeline` : base;
    };

    // When the user drilled in from the funding pipeline (?from=pipeline), the
    // back button should return to the pipeline rather than the prospects/clients
    // list. Read from the URL on mount instead of useSearchParams() to avoid the
    // Suspense-boundary requirement on this large client component.
    const [came_from_pipeline, set_came_from_pipeline] = useState(false);
    useEffect(() => {
        set_came_from_pipeline(new URLSearchParams(window.location.search).get("from") === "pipeline");
    }, []);

    // component-state: Single source of truth for component state
    const [component_state, set_component_state] = useState<ComponentState>(
        ComponentState.LOADING
    );

    // client-profile-state: Stores client profile information
    const [client_profile, set_client_profile] = useState<ClientProfile | null>(null);

    // is-owner-state: Whether current advisor owns this client (vs. being a follower).
    // Drives the "Manage Followers" permission (owner + admin can manage; followers cannot).
    const [is_owner, set_is_owner] = useState(false);

    // followers-list-state: page-level mirror of the Followers card's data. The
    // card self-fetches, but the collapse unmounts it when closed — so the page
    // fetches once here to populate the collapsed section header (follower
    // names), and the card keeps this in sync via onFollowersChange after loads
    // and add/remove.
    const [followers_list, set_followers_list] = useState<FollowerRow[]>([]);

    useEffect(() => {
        if (!client_profile?.id) return;
        let cancelled = false;
        listClientFollowers(client_profile.id).then((res) => {
            if (!cancelled && res.success && res.followers) set_followers_list(res.followers);
        });
        return () => {
            cancelled = true;
        };
    }, [client_profile?.id]);

    // navigable-clients-state: Ordered list of client IDs the current advisor can access
    // (owned + followed for advisors, all for admins). Powers the prev/next buttons in the header.
    const [navigable_client_ids, set_navigable_client_ids] = useState<string[]>([]);

    // last-activity-state: Most recent meaningful interaction across status/docs/notes.
    // Drives the activity-age badge in the detail header.
    const [last_activity_at, set_last_activity_at] = useState<string | null>(null);

    // businesses-state: All business_profiles rows for this client. Powers the
    // BusinessTabStrip. Primary is auto-created by syncUnifiedClientData on signup;
    // additional businesses come from the "Add Business" CTA.
    const [businesses, set_businesses] = useState<BusinessTab[]>([]);
    const [active_business_id, set_active_business_id] = useState<string | null>(null);
    const [is_add_business_open, set_is_add_business_open] = useState(false);
    // Pending-deletion business: { id, company_name } when the user clicks the
    // × on a non-primary tab. Null when no confirmation dialog is open.
    const [business_pending_delete, set_business_pending_delete] = useState<BusinessTab | null>(null);
    const [is_deleting_business, set_is_deleting_business] = useState(false);

    // documents-state: Stores all client documents
    const [documents, set_documents] = useState<UserDocument[]>([]);

    // required-docs-state: Stores dynamic document requirements for this client.
    // business_profile_id is carried through so the UI can scope to active tab.
    const [required_docs, set_required_docs] = useState<{ code: string; label: string; business_profile_id?: string | null }[]>([]);
    // approvals-raw: each approval carries its business_profile_id so the
    // approvals Set can be derived per active tab.
    const [approvals_raw, set_approvals_raw] = useState<{ doc_code: string; business_profile_id: string | null; funding_deal_id: string | null }[]>([]);

    // all-available-docs-state: Stores all possible document types for request
    const [all_doc_types, set_all_doc_types] = useState<{ id: string; code: string; label: string }[]>([]);

    // request-modal-state: UI controls for the request dialog
    const [is_request_modal_open, set_is_request_modal_open] = useState(false);
    const [selected_doc_ids, set_selected_doc_ids] = useState<string[]>([]);
    const [request_search_query, set_request_search_query] = useState("");
    const [is_requesting, set_is_requesting] = useState(false);
    // Bank statements only: how many months to request (others ignore it).
    const [request_statement_months, set_request_statement_months] = useState(12);
    // doc_code currently being re-requested via the per-field "Request Again"
    // button (drives that row's spinner). null when idle.
    const [requesting_again_code, set_requesting_again_code] = useState<string | null>(null);

    // resend-credentials-state: Tracks loading state for credential resend
    const [is_resending, set_is_resending] = useState(false);
    const [is_generating_magic_link, set_is_generating_magic_link] = useState(false);
    const [is_sending_password_reset, set_is_sending_password_reset] = useState(false);
    const [is_saving_referral_partner, set_is_saving_referral_partner] = useState(false);

    // upload-for-client-state: Controls for advisor document upload modal
    const [is_upload_modal_open, set_is_upload_modal_open] = useState(false);
    const [upload_doc_code, set_upload_doc_code] = useState<string>("");
    const [upload_doc_label, set_upload_doc_label] = useState<string>("");
    const [upload_files, set_upload_files] = useState<File[]>([]);
    const [is_uploading, set_is_uploading] = useState(false);
    // Which group this upload is filed under. Cleared whenever the modal opens
    // on a different category — groups are per-field, so a bank account is
    // meaningless once the modal switches to tax returns.
    const [upload_document_group_id, set_upload_document_group_id] = useState<string | null>(null);
    // Bulk-download progress. Non-null while an archive is being built.
    const [is_zipping, set_is_zipping] = useState<{ completed: number; total: number } | null>(null);
    // Filing groups for the business tab on screen, across every field. Feeds
    // both the upload picker and the per-group sections in the document list.
    const { groups: document_groups, addGroup: add_document_group } = useDocumentGroups(active_business_id);

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

    // Client File Notes state (separate timeline under the Client Notes card)
    const [file_notes, set_file_notes] = useState<FileNote[]>([]);
    const [new_file_note, set_new_file_note] = useState("");
    const [is_adding_file_note, set_is_adding_file_note] = useState(false);

    // Edit Profile state
    const [is_edit_modal_open, set_is_edit_modal_open] = useState(false);

    // Admin-only: reassign advisor state
    const [is_reassign_modal_open, set_is_reassign_modal_open] = useState(false);
    const [reassign_advisor_options, set_reassign_advisor_options] = useState<
        { id: string; first_name: string; last_name: string; email: string }[]
    >([]);
    const [reassign_target_id, set_reassign_target_id] = useState("");
    const [is_reassigning, set_is_reassigning] = useState(false);

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

    // Route the back-to-list button. If the user came from the funding pipeline,
    // send them back there. Otherwise route by the file's status: funded files go
    // to the Clients book, everything else to the Prospects pipeline.
    const clients_list_path = came_from_pipeline
        ? `${basePath}/pipeline`
        : current_pipeline_status === "funded"
            ? `${basePath}/clients`
            : `${basePath}/prospects`;

    // Rejection state
    const [is_reject_modal_open, set_is_reject_modal_open] = useState(false);
    const [reject_doc_type, set_reject_doc_type] = useState<{ code: string; label: string } | null>(null);
    const [reject_reason, set_reject_reason] = useState("");
    const [is_rejecting, set_is_rejecting] = useState(false);
    const [fico_score, set_fico_score] = useState<string>("");

    // Approval state
    const [is_approving_modal_open, setIs_approving_modal_open] = useState(false);
    const [category_to_approve, set_category_to_approve] = useState<{ code: string; label: string } | null>(null);
    const [is_approving, set_is_approving] = useState(false);

    // NEW: Document Management UX State.
    // `approvals` is derived from approvals_raw filtered by the active tab,
    // so switching businesses automatically recomputes which categories are
    // shown as approved + drives the completion percentage.
    // The funding round on screen — the business's newest funding_deals row.
    // Rows stamped with an older round belong to a financing that already
    // closed and drop out of the active view. See [[funding_deals_refactor]].
    const active_deal_id = useMemo<string | null>(
        () => businesses.find((b) => b.id === active_business_id)?.active_deal_id ?? null,
        [businesses, active_business_id]
    );

    const approvals = useMemo<Set<string>>(() => {
        return new Set(
            approvals_raw
                .filter((a) => matchesActiveBusiness(a.business_profile_id, active_business_id, a.doc_code))
                .filter((a) => matchesActiveDeal((a as any).funding_deal_id ?? null, active_deal_id))
                .map((a) => a.doc_code)
        );
    }, [approvals_raw, active_business_id, active_deal_id]);

    // Scoped versions of the dynamic doc requests + uploaded files for the
    // active business tab. The matchesActiveBusiness predicate also lets
    // client-scoped docs (driver's license, MyScoreIQ, PFS) through for any
    // tab, since they describe the person and shouldn't be re-collected per
    // business.
    const scoped_documents = useMemo(() => {
        const active_is_primary = businesses.find((b) => b.id === active_business_id)?.is_primary ?? false;
        return documents.filter((d) => {
            const code = (d as any).doc_code ?? (d as any).category ?? null;
            const bpid = (d as any).business_profile_id ?? null;
            // Files stamped with a previous round stay in the vault as that
            // round's record but leave the current packet.
            if (!matchesActiveDeal((d as any).funding_deal_id ?? null, active_deal_id)) return false;
            if (matchesActiveBusiness(bpid, active_business_id, code)) return true;
            // Resilience: a legacy/unscoped upload (business_profile_id = null,
            // e.g. a funding application e-signed before per-business scoping)
            // matches no tab and would silently vanish. Surface it on the PRIMARY
            // tab — the client's main business — so it's never lost. New uploads
            // always carry a business_profile_id, so only legacy nulls are caught.
            if (bpid === null && active_is_primary) return true;
            return false;
        });
    }, [documents, active_business_id, businesses, active_deal_id]);

    // Categories to render in the doc-status accordion = (active dynamic
    // requests for the business, deduped by code) ∪ (categories of uploaded
    // files in scope whose code exists in the global doc catalog). The union
    // matters: a file with a known code must group under its category section,
    // never fall into "Additional Documents" — even if its dynamic request row
    // was later deactivated (e.g. GHL tag removed, file already uploaded).
    const scoped_required_docs = useMemo(() => {
        const seen = new Set<string>();
        const out: { code: string; label: string }[] = [];
        for (const d of required_docs) {
            if (!matchesActiveBusiness(d.business_profile_id ?? null, active_business_id, d.code)) continue;
            if (seen.has(d.code)) continue;
            seen.add(d.code);
            out.push({ code: d.code, label: d.label });
        }
        const types_by_code = new Map(all_doc_types.map(t => [t.code, t]));
        for (const doc of scoped_documents) {
            const code = (doc as any).doc_code ?? doc.category;
            if (!code || seen.has(code)) continue;
            const type = types_by_code.get(code);
            if (!type) continue;
            seen.add(code);
            out.push({ code: type.code, label: type.label });
        }
        return out;
    }, [required_docs, scoped_documents, all_doc_types, active_business_id]);

    // Profile rescoped to the active business tab. For the primary tab we show
    // the client_data_vault row as-is. For a non-primary business we override
    // every per-business field — including the funding ask (capital_requested,
    // proposed_loan_type, loan_purpose, funding_eta) which lives on that
    // business's funding_deals row, flattened onto the tab earlier. Without
    // this, a non-primary tab silently shows the PRIMARY business's figures.
    const displayed_profile = useMemo(() => {
        if (!client_profile) return client_profile;
        const active_business = businesses.find((b) => b.id === active_business_id);
        if (!active_business || active_business.is_primary) return client_profile;
        return {
            ...client_profile,
            company_name: active_business.company_name || "—",
            company_city: active_business.company_city || "",
            company_state: active_business.company_state || "",
            company_zip_code: active_business.company_zip_code ?? client_profile.company_zip_code,
            legal_entity_type: active_business.legal_entity_type || "—",
            business_start_date: active_business.business_start_date || "",
            industry: active_business.industry ?? undefined,
            is_home_based: active_business.is_home_based ?? null,
            employees_count: active_business.employees_count ?? undefined,
            avg_monthly_deposits: active_business.avg_monthly_deposits ?? 0,
            avg_annual_revenue: active_business.avg_annual_revenue ?? undefined,
            // Funding ask — from this business's funding_deals row.
            capital_requested: active_business.capital_requested ?? 0,
            proposed_loan_type: active_business.proposed_loan_type ?? undefined,
            loan_purpose: active_business.loan_purpose ?? undefined,
            funding_eta: active_business.funding_eta ?? undefined,
        } as ClientProfile;
    }, [client_profile, businesses, active_business_id]);

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
    // First load blanks the page; refetches after an action (status change, doc
    // request, new round) run in place. Reset per client so navigating to a
    // different file still gets its own loading state.
    const has_loaded_once = useRef(false);

    useEffect(() => {
        has_loaded_once.current = false;
        if (client_id) {
            fetch_client_details();
        }
    }, [client_id]);

    // Fetch the ordered list of clients accessible to this advisor (owned + followed; all for admins).
    // Used to drive prev/next navigation between client detail pages. Cached at the module level
    // so navigations within the same tab session don't re-issue these queries.
    useEffect(() => {
        // If the user drilled in from the pipeline, prev/next + the counter should
        // walk exactly the filtered set they were viewing (e.g. "My Deals"), not
        // every accessible client. The pipeline stashes that ordered list on open.
        if (new URLSearchParams(window.location.search).get("from") === "pipeline") {
            try {
                const raw = sessionStorage.getItem("pipeline-nav-ids");
                if (raw) {
                    const ids = JSON.parse(raw);
                    if (Array.isArray(ids) && ids.includes(client_id)) {
                        set_navigable_client_ids(ids);
                        return;
                    }
                }
            } catch { /* fall through to the default accessible-clients list */ }
        }

        async function fetch_navigable_clients() {
            const identity = await resolve_identity_cached(supabase);
            if (!identity) return;

            // Serve from cache if fresh and matched to the current user.
            if (
                navigable_cache &&
                navigable_cache.user_id === identity.user_id &&
                Date.now() < navigable_cache.expires_at
            ) {
                set_navigable_client_ids(navigable_cache.ids);
                return;
            }

            let accessible_ids: string[] | null = null;

            if (identity.role !== "admin") {
                if (!identity.advisor) return;
                const advisor_id = identity.advisor.id;

                const [{ data: owned }, { data: followed }] = await Promise.all([
                    supabase.from("client_data_vault").select("id").eq("advisor_id", advisor_id),
                    supabase.from("client_followers").select("client_vault_id").eq("advisor_id", advisor_id),
                ]);

                const id_set = new Set<string>();
                owned?.forEach(r => id_set.add(r.id));
                followed?.forEach((r: any) => id_set.add(r.client_vault_id));
                accessible_ids = Array.from(id_set);
                if (accessible_ids.length === 0) return;
            }

            let q = supabase
                .from("client_data_vault")
                .select("id")
                .order("created_at", { ascending: false });
            if (accessible_ids !== null) q = q.in("id", accessible_ids);

            const { data } = await q;
            if (data) {
                const ids = data.map(r => r.id);
                navigable_cache = {
                    user_id: identity.user_id,
                    ids,
                    expires_at: Date.now() + NAVIGABLE_TTL_MS,
                };
                set_navigable_client_ids(ids);
            }
        }
        fetch_navigable_clients();
    }, []);

    const current_nav_index = navigable_client_ids.indexOf(client_id);
    const prev_client_id = current_nav_index > 0 ? navigable_client_ids[current_nav_index - 1] : null;
    const next_client_id = current_nav_index >= 0 && current_nav_index < navigable_client_ids.length - 1
        ? navigable_client_ids[current_nav_index + 1]
        : null;

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
            // Only the first load blanks the page — a refetch triggered by an
            // action must not unmount everything and lose the user's place.
            if (!has_loaded_once.current) {
                set_component_state(ComponentState.LOADING);
            }

            // Failure handling differs by phase: on first load there's nothing
            // to show but the error; on a background refresh the page already
            // holds good data, so a transient failure is a toast, not a wipe.
            const fail = (message: string) => {
                if (!has_loaded_once.current) {
                    set_error_message(message);
                    set_component_state(ComponentState.ERROR);
                } else {
                    toast.error(message);
                }
            };

            // ============================================
            // STEP 1+2: RESOLVE IDENTITY (cached across navigations)
            // ============================================
            const identity = await resolve_identity_cached(supabase);
            if (!identity) {
                fail("Authentication failed. Please log in again.");
                return;
            }
            // Admins can view any client; advisors must have an advisor profile.
            const is_admin_user = identity.role === "admin";
            if (!canUseAdvisorWorkspace(identity.role)) {
                set_error_message("Access denied. You must be an advisor or admin to view this page.");
                set_component_state(ComponentState.ACCESS_DENIED);
                return;
            }
            if (!is_admin_user && !identity.advisor) {
                fail("No advisor profile found. Please contact support to set up your advisor account.");
                return;
            }
            const advisor_data = identity.advisor;

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
          additional_notes,
          proposed_loan_type,
          funding_eta,
          employees_count,
          is_home_based,
          referral_partner,
          advisor_name,
          reassignment_paused_until,
          reassigned_to_catch_all_at
        `)
                .eq("id", client_id)
                .maybeSingle();

            if (client_error) {
                console.error("❌ Error fetching client:", client_error);
                fail("Error loading client information.");
                return;
            }

            if (!client_data) {
                console.error("❌ Client not found");
                fail("Client not found.");
                return;
            }

            // ============================================
            // STEP 4: VERIFY ACCESS (owner OR follower)
            // ============================================
            const owns_client = !is_admin_user && advisor_data
                ? client_data.advisor_id === advisor_data.id
                : false;
            let is_follower = false;
            if (!is_admin_user && !owns_client && advisor_data) {
                const { data: follower_row, error: follower_err } = await supabase
                    .from("client_followers")
                    .select("id")
                    .eq("client_vault_id", client_data.id)
                    .eq("advisor_id", advisor_data.id)
                    .maybeSingle();
                is_follower = !!follower_row;
                if (follower_err) {
                    console.error("client_followers read error:", follower_err);
                }
                console.log("Follower check:", {
                    client_vault_id: client_data.id,
                    advisor_id: advisor_data.id,
                    is_follower,
                    follower_row,
                });
            }

            // Admins bypass the owner/follower gate entirely.
            if (!is_admin_user && !owns_client && !is_follower) {
                console.error("❌ Access denied: advisor is neither owner nor follower");
                set_error_message("You do not have permission to view this client.");
                set_component_state(ComponentState.ACCESS_DENIED);
                return;
            }

            // Admins get owner-equivalent management rights (matches assertCanManageFollowers in client-access.ts).
            set_is_owner(owns_client || is_admin_user);
            console.log("✅ Client profile loaded:", client_data.client_name);
            set_client_profile(client_data as ClientProfile);
            // Reflect any existing submission state
            set_vault_submitted(!!client_data.data_vault_submitted_at);

            // ============================================
            // STEP 5: PARALLEL FETCH OF ALL CLIENT-DEPENDENT DATA
            // Once the access check has passed, every remaining query is
            // independent. Running them concurrently collapses ~9 sequential
            // round-trips into a single one (the slowest query). The global
            // required_documents lookup is served from cache when available.
            // ============================================
            const all_doc_types_promise = doc_types_cache && Date.now() < doc_types_cache.expires_at
                ? Promise.resolve({ data: doc_types_cache.items, error: null as any })
                : supabase
                    .from("required_documents")
                    .select("id, code, label")
                    .order("label", { ascending: true });

            const [
                docs_result,
                dynamic_reqs_result,
                all_docs_result,
                submission_result,
                notes_result,
                file_notes_result,
                history_result,
                approvals_result,
                activity_result,
                businesses_result,
            ] = await Promise.all([
                supabase
                    .from("user_documents")
                    .select("*, business_profile_id")
                    .eq("user_id", client_data.user_id)
                    .order("upload_date", { ascending: false }),
                supabase
                    .from("client_dynamic_documents")
                    .select(`business_profile_id, required_documents!inner (code, label)`)
                    .eq("user_id", client_data.user_id)
                    .eq("is_active", true),
                all_doc_types_promise,
                supabase
                    .from("submissions")
                    .select("status")
                    .eq("user_id", client_data.user_id)
                    .maybeSingle(),
                fetchInternalNotes(client_id),
                fetchFileNotes(client_id),
                getClientPipelineHistory(client_id),
                supabase
                    .from("document_category_approvals")
                    .select("doc_code, business_profile_id, funding_deal_id")
                    .eq("client_vault_id", client_id),
                getBulkClientActivity([client_id]),
                supabase
                    .from("business_profiles")
                    .select("id, company_name, is_primary, display_order, legal_entity_type, business_start_date, company_city, company_state, company_zip_code, avg_monthly_deposits, avg_annual_revenue, employees_count, is_home_based, industry, funding_deals (id, capital_requested, proposed_loan_type, loan_purpose, funding_eta, display_order, funded_at)")
                    .eq("client_vault_id", client_id)
                    .order("is_primary", { ascending: false })
                    .order("display_order", { ascending: true })
                    .order("created_at", { ascending: true }),
            ]);

            // Documents
            if (docs_result.error) {
                console.error("❌ Error fetching documents:", docs_result.error);
                set_documents([]);
            } else {
                set_documents(docs_result.data || []);
            }

            // Dynamic requirements
            if (dynamic_reqs_result.error) {
                console.error("❌ Error fetching requirements:", dynamic_reqs_result.error);
                set_required_docs([
                    { code: "business_bank_statements", label: "Bank Statements" },
                    { code: "drivers_license", label: "Driver's License" },
                    { code: "voided_check", label: "Voided Check" },
                ]);
            } else {
                // normalizeSupabaseJoin handles SDK array-vs-object variance
                // for the embedded required_documents row. See document-scope.ts.
                const formatted_reqs = (dynamic_reqs_result.data || [])
                    .map((item: any) => ({
                        ...(normalizeSupabaseJoin(item.required_documents) || {}),
                        business_profile_id: item.business_profile_id ?? null,
                    }))
                    .filter((doc: any) => doc.code && doc.code !== "funding_application");
                set_required_docs(formatted_reqs);
            }

            // All available doc types (for the request-new modal). Populate the
            // module-level cache on first fetch so subsequent navigations skip it.
            if (all_docs_result.error) {
                console.error("❌ Error fetching doc types:", all_docs_result.error);
            } else {
                const items = all_docs_result.data || [];
                set_all_doc_types(items);
                if (!doc_types_cache || Date.now() >= doc_types_cache.expires_at) {
                    doc_types_cache = { items, expires_at: Date.now() + DOC_TYPES_TTL_MS };
                }
            }

            // Submission status
            set_submission_status(submission_result.data?.status || null);
            set_vault_submitted(submission_result.data?.status === "locked");

            // Internal notes
            if (notes_result.success) set_notes(notes_result.notes || []);

            // File notes
            if (file_notes_result.success) set_file_notes((file_notes_result.notes as FileNote[]) || []);

            // Pipeline history
            if (history_result) {
                set_pipeline_history(history_result);
                if (history_result.length > 0) {
                    const sorted = [...history_result].sort(
                        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                    );
                    set_current_pipeline_status(sorted[0].status as LoanStatus);
                }
            }

            // Document category approvals — store with business_profile_id
            // so we can scope to the active tab. set_approvals stays in sync
            // via the derived scoped_approvals memo below.
            if (approvals_result.error) {
                console.error("❌ Error fetching approvals:", approvals_result.error);
            } else {
                set_approvals_raw((approvals_result.data || []).map((a: any) => ({
                    doc_code: a.doc_code,
                    business_profile_id: a.business_profile_id ?? null,
                    funding_deal_id: a.funding_deal_id ?? null,
                })));
            }

            // Last activity (drives the activity-age badge)
            set_last_activity_at(activity_result.get(client_id) ?? null);

            // Businesses for the tab strip
            if (businesses_result.error) {
                console.error("❌ Error fetching businesses:", businesses_result.error);
            } else {
                // Flatten each business's funding ask (lives on funding_deals,
                // not business_profiles) onto the tab row so switching tabs can
                // rescope the funding figures. The ask shown is the CURRENT
                // round's — the highest-display_order deal — so a repeat client
                // doesn't have last year's closed ask in their header.
                const rows = (businesses_result.data || []).map((b: any): BusinessTab => {
                    const deals = Array.isArray(b.funding_deals) ? b.funding_deals : [];
                    const deal = deals
                        .slice()
                        .sort((x: any, y: any) => (y.display_order ?? 0) - (x.display_order ?? 0))[0] ?? null;
                    const { funding_deals: _drop, ...rest } = b;
                    return {
                        ...rest,
                        capital_requested: deal?.capital_requested ?? null,
                        proposed_loan_type: deal?.proposed_loan_type ?? null,
                        loan_purpose: deal?.loan_purpose ?? null,
                        funding_eta: deal?.funding_eta ?? null,
                        active_deal_id: deal?.id ?? null,
                        active_deal_funded_at: deal?.funded_at ?? null,
                        deal_count: deals.length,
                    };
                });
                set_businesses(rows);
                // Default the active tab to the primary business (or the first row if none flagged).
                const primary = rows.find((b) => b.is_primary) || rows[0];
                if (primary && !active_business_id) {
                    set_active_business_id(primary.id);
                }
            }

            has_loaded_once.current = true;
            set_component_state(ComponentState.SUCCESS);
        } catch (error: any) {
            console.error("❌ Unexpected error:", error);
            // A failed background refresh leaves the working page alone — what's
            // on screen is still the last good copy.
            if (!has_loaded_once.current) {
                set_error_message(error.message || "An unexpected error occurred.");
                set_component_state(ComponentState.ERROR);
            } else {
                toast.error(error.message || "Couldn't refresh this client's data.");
            }
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
            const result = await approveDocumentCategory(client_id, category_to_approve.code, active_business_id);
            if (result.success) {
                toast.success(`Category "${category_to_approve.label}" approved!`);
                // Push into approvals_raw scoped to the active business; the
                // `approvals` memo automatically picks this up.
                set_approvals_raw((prev) => {
                    const code = category_to_approve.code;
                    const business_profile_id = active_business_id;
                    // De-dupe: if a row for this (code, business) already exists, no change.
                    if (prev.some((a) => a.doc_code === code && a.business_profile_id === business_profile_id)) {
                        return prev;
                    }
                    // Optimistic row for the round being worked, so the freshly
                    // approved category doesn't blink back to unapproved.
                    return [...prev, { doc_code: code, business_profile_id, funding_deal_id: active_deal_id }];
                });
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
     * refresh_documents: Targeted re-fetch of just the user_documents list for
     * this client. Used after upload/delete instead of fetch_client_details(),
     * which sets component_state to LOADING and re-runs ~10 parallel queries
     * (profile, dynamic docs, submissions, notes, history, approvals, activity)
     * — that full reload is what the page-flash feels like.
     */
    async function refresh_documents() {
        if (!client_profile?.user_id) return;
        // Must explicitly include business_profile_id — without it the
        // scoped_documents matcher evaluates `undefined === active_business_id`
        // and drops every refreshed row from the active tab until the next
        // full fetch_client_details() pass repaints state.
        const { data, error } = await supabase
            .from("user_documents")
            .select("*, business_profile_id")
            .eq("user_id", client_profile.user_id)
            .order("upload_date", { ascending: false });
        if (error) {
            console.error("❌ refresh_documents error:", error);
            return;
        }
        set_documents(data || []);
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
                // Keep the preview modal title in sync when rename was invoked
                // from inside the preview itself.
                set_preview_modal(prev => prev.doc && prev.doc.id === renaming_file.id
                    ? { ...prev, doc: { ...prev.doc, custom_label: newLabel.trim() } }
                    : prev);
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
                // The link arrives after a server round-trip, so the window may
                // no longer be focused and a raw clipboard write would reject.
                const copied = await copy_to_clipboard(result.link);
                if (copied) {
                    toast.success("Magic link copied to clipboard!");
                } else {
                    toast.error("Link generated, but the copy was blocked — click this window and try again.");
                }
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
     * download-document: saves one document to disk.
     *
     * Goes through GET /api/documents/[id]/file?download=1, which authorises
     * the read and answers an attachment named by the server. The browser
     * streams it, so a large statement never has to be held in a blob first.
     */
    function download_document(doc: UserDocument) {
        downloadDocument(doc.id);
    }

    /**
     * download_all_documents: Downloads all documents in a category sequentially
     */
    /**
     * The whole packet as one archive, foldered by category.
     *
     * Mirrors the underwriting view — the per-category buttons each cover one
     * section, which on a full file means a dozen separate zips to merge by
     * hand. Folder names are the labels shown on screen, so the archive opens
     * looking like the page it came from.
     */
    async function download_entire_packet() {
        if (is_zipping) return;

        const docs = scoped_documents;
        if (docs.length === 0) return;

        const client_name = client_profile?.client_name || "Client";
        const label_by_code = new Map<string, string>(
            required_docs.map(r => [r.code, r.label])
        );

        set_is_zipping({ completed: 0, total: docs.length });
        try {
            const result = await zipDocuments(docs, `${client_name} - Documents`, {
                folderOf: (d) => {
                    const code = (d as any).doc_code ?? (d as any).category ?? "";
                    return label_by_code.get(code) || code || "Other";
                },
                onProgress: (p) => set_is_zipping({ completed: p.completed, total: p.total }),
            });

            if (!result.saved) return;
            if (result.failed.length > 0) {
                toast.error(`${result.written} file(s) zipped · ${result.failed.length} could not be read`);
            } else {
                toast.success(`Packet downloaded — ${result.written} file(s)`);
            }
        } catch (err: any) {
            console.error('packet zip error:', err);
            toast.error('Could not build the ZIP');
        } finally {
            set_is_zipping(null);
        }
    }

    /**
     * Bulk download as ONE ZIP.
     *
     * Replaces a loop that fired one browser download per file, 800ms apart.
     * On a real packet that is minutes of downloads, and browsers cut the
     * sequence off partway — leaving the advisor with some of the files and no
     * indication which were missing. See @/lib/document-download.
     */
    async function download_all_documents(docs: UserDocument[]) {
        if (docs.length === 0 || is_zipping) return;

        const client_name = client_profile?.client_name || "Documents";
        const first_code = (docs[0] as any)?.doc_code ?? docs[0]?.category ?? null;
        const label = required_docs.find(r => r.code === first_code)?.label ?? "Documents";

        set_is_zipping({ completed: 0, total: docs.length });
        try {
            const result = await zipDocuments(docs, `${client_name} - ${label}`, {
                onProgress: (p) => set_is_zipping({ completed: p.completed, total: p.total }),
            });

            if (!result.saved) return; // user dismissed the save dialog
            if (result.failed.length > 0) {
                toast.error(`${result.written} file(s) zipped · ${result.failed.length} could not be read`);
            } else {
                toast.success(`${result.written} file(s) downloaded as a ZIP`);
            }
        } catch (err: any) {
            console.error('zip download error:', err);
            toast.error('Could not build the ZIP');
        } finally {
            set_is_zipping(null);
        }
    }

    /**
     * get-documents-by-category: Groups documents by their category
     */
    function get_documents_by_category(category_code: string): UserDocument[] {
        // Must use scoped_documents — using the unscoped array meant the
        // outstanding-docs banner counted uploads from every business on
        // every tab, so a doc uploaded on Business A looked satisfied while
        // viewing Business B.
        return scoped_documents.filter(doc => doc.category === category_code);
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
     * handle-advisor-upload: Uploads selected files on behalf of the client.
     *
     * Files go browser → Supabase storage directly via signed upload URLs,
     * bypassing Vercel's 4.5 MB request body cap. Once uploaded, we POST the
     * metadata to /api/advisor/clients/upload to record the row and run GHL
     * sync.
     */
    async function handle_advisor_upload() {
        if (upload_files.length === 0 || !upload_doc_code) return;

        set_is_uploading(true);
        try {
            const supabase = createClient();

            const upload_results = await Promise.all(
                upload_files.map(async (file) => {
                    try {
                        const sign_res = await fetch('/api/advisor/clients/upload/sign', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                client_id,
                                doc_code: upload_doc_code,
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
                console.error(`❌ Upload failed for ${f.file_name}:`, f.error);
                toast.error(`Failed to upload ${f.file_name}: ${f.error}`);
            });

            if (successful.length === 0) {
                return;
            }

            const res = await fetch('/api/advisor/clients/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id,
                    doc_code: upload_doc_code,
                    // Scope this advisor-uploaded file to the currently active
                    // business tab. The API stamps business_profile_id on the
                    // resulting user_documents row.
                    business_profile_id: active_business_id ?? null,
                    // The API re-verifies the group belongs to this field and
                    // this business, and silently ignores it otherwise.
                    document_group_id: upload_document_group_id,
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
                return;
            }

            const result = await res.json();

            if (result.success) {
                toast.success(`${result.uploaded} file(s) uploaded successfully!`);
                set_is_upload_modal_open(false);
                set_upload_files([]);
                set_upload_doc_code("");
                set_upload_document_group_id(null);
                if (Array.isArray(result.documents) && result.documents.length > 0) {
                    set_documents(prev => [...result.documents, ...prev]);
                }
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
                // Carries the real reason — e.g. `funded` requires Underwriting's
                // Loan Funded dialog, which records lender/amount/term.
                toast.error(res.error || "Failed to update pipeline");
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
                body: JSON.stringify({
                    client_id,
                    credit_score: fico_score
                }),
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

    async function handle_referral_partner_change(partner: string | null) {
        set_is_saving_referral_partner(true);
        try {
            const result = await setReferralPartner(client_id, partner);
            if (result.success) {
                set_client_profile((prev) => (prev ? { ...prev, referral_partner: partner } : prev));
                toast.success(partner ? `Referral partner set to ${partner}` : "Referral partner cleared");
            } else {
                toast.error(result.error || "Failed to update referral partner");
            }
        } catch (err: any) {
            console.error("❌ Referral partner error:", err);
            toast.error("An unexpected error occurred");
        } finally {
            set_is_saving_referral_partner(false);
        }
    }

    /**
     * handle_send_password_reset: Triggers the GHL workflow that delivers
     * a password-reset link to the client (via custom field RESET_PW_LINK).
     */
    async function handle_send_password_reset() {
        set_is_sending_password_reset(true);
        try {
            const response = await fetch('/api/clients/send-password-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id }),
            });

            const result = await response.json();

            if (result.success) {
                toast.success('Password reset link sent to the client.');
            } else {
                toast.error(result.error || 'Failed to send reset link');
            }
        } catch (err: any) {
            console.error('❌ Send reset link error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_sending_password_reset(false);
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
                reject_reason,
                active_business_id
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

            const result = await addManualFundingApplication(client_id, formData, active_business_id);

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
            const bank_type = all_doc_types.find(t => t.code === 'business_bank_statements');
            const bank_selected = bank_type ? selected_doc_ids.includes(bank_type.id) : false;
            const result = await requestDocuments(
                client_id,
                selected_doc_ids,
                active_business_id,
                bank_selected ? request_statement_months : null,
            );

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

    // Re-request a document on an EXISTING field — used when more items are
    // needed on a category that's already been requested (e.g. additional tax
    // returns or extra months of bank statements), including after the file has
    // been submitted to UW. Reuses requestDocuments, which re-activates the
    // requirement, bumps statement_months, re-notifies the client, and reopens
    // the submission status.
    async function handle_request_again(doc: { code: string; label: string }, statement_months?: number) {
        const type = all_doc_types.find((t) => t.code === doc.code);
        if (!type) {
            toast.error("Document type not found");
            return;
        }
        set_requesting_again_code(doc.code);
        try {
            const result = await requestDocuments(
                client_id,
                [type.id],
                active_business_id,
                doc.code === "business_bank_statements" ? (statement_months ?? 12) : null,
            );
            if (result.success) {
                toast.success(`Re-requested ${doc.label} from the client`);
                fetch_client_details();
            } else {
                toast.error(result.error || "Failed to re-request document");
            }
        } catch (err: any) {
            console.error("❌ Request again error:", err);
            toast.error("An unexpected error occurred");
        } finally {
            set_requesting_again_code(null);
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

    async function handle_add_file_note() {
        if (!new_file_note.trim()) return;

        set_is_adding_file_note(true);
        try {
            const result = await addFileNote(client_id, new_file_note);
            if (result.success) {
                toast.success("File note added");
                set_new_file_note("");
                const res = await fetchFileNotes(client_id);
                if (res.success && res.notes) set_file_notes(res.notes as FileNote[]);
            } else {
                toast.error(result.error || "Failed to add file note");
            }
        } catch (err: any) {
            console.error("❌ Add file note error:", err);
            toast.error("An unexpected error occurred");
        } finally {
            set_is_adding_file_note(false);
        }
    }

    async function handle_save_signup_notes(patch: {
        loan_purpose?: string;
        additional_notes?: string;
    }): Promise<boolean> {
        try {
            const result = await updateClientSignupNotes(client_id, patch);
            if (result.success) {
                set_client_profile((prev) => (prev ? { ...prev, ...patch } : prev));
                toast.success("Notes updated");
                return true;
            }
            toast.error(result.error || "Failed to update notes");
            return false;
        } catch (err: any) {
            console.error("❌ Save signup notes error:", err);
            toast.error("An unexpected error occurred");
            return false;
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
                refresh_documents();
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
                router.push(clients_list_path);
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

    async function open_reassign_modal() {
        // Load active advisors for the picker. Admin-only — guarded by render gate.
        // Internal staff only: reassigning a file TO an external partner advisor
        // would move someone else's client onto an outside CPA's book.
        const { data, error } = await supabase
            .from("advisors")
            .select("id, first_name, last_name, email")
            .eq("is_active", true)
            .is("referral_partner_id", null)
            .order("first_name", { ascending: true });
        if (error) {
            toast.error("Failed to load advisor list");
            return;
        }
        set_reassign_advisor_options(data ?? []);
        set_reassign_target_id("");
        set_is_reassign_modal_open(true);
    }

    async function handle_reassign_advisor() {
        if (!reassign_target_id) return;
        if (client_profile?.advisor_id === reassign_target_id) {
            toast.info("That's already the assigned advisor");
            return;
        }
        set_is_reassigning(true);
        try {
            const result = await reassignClientAdvisor(client_id, reassign_target_id);
            if (result.success) {
                toast.success(`Reassigned to ${result.advisor_name}`);
                set_is_reassign_modal_open(false);
                fetch_client_details(); // refresh client_profile
            } else {
                toast.error(result.error || "Failed to reassign advisor");
            }
        } catch (err: any) {
            console.error("Reassign advisor error:", err);
            toast.error("An unexpected error occurred");
        } finally {
            set_is_reassigning(false);
        }
    }

    async function handle_remove_request() {
        if (!doc_to_remove_request) return;

        set_is_removing_request(true);
        try {
            const result = await removeRequestedDocument(client_id, doc_to_remove_request.code, active_business_id);
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
                        onClick={() => router.push(clients_list_path)}
                        variant="outline"
                    >
                        <ArrowBigUp className="h-4 w-4 mr-2" />
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
                        onClick={() => router.push(clients_list_path)}
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

        // Doc completion is scoped to the active business tab.
        const total_required = scoped_required_docs.length;
        const completed_categories = scoped_required_docs.filter(
            doc_type => approvals.has(doc_type.code)
        ).length;
        const completion_percentage = total_required > 0
            ? Math.round((completed_categories / total_required) * 100)
            : 100;

        return (
            <div className="space-y-6">
                {/* One bar: queue nav + pipeline + stage actions + fold
                    controls. Replaces the three stacked strips (nav, status
                    chips, full pipeline card) that used to open every file. */}
                {(() => {
                    const last_upload = documents.length > 0
                        ? documents.reduce((a, b) => new Date(a.upload_date) > new Date(b.upload_date) ? a : b).upload_date
                        : null;
                    const upload_baseline = last_upload ?? client_profile.created_at;
                    const days_since_last_upload = differenceInDays(new Date(), new Date(upload_baseline));
                    const show_upload_alert = days_since_last_upload >= 5 && completion_percentage < 100;
                    return (
                        <ClientCommandBar
                            back_label={came_from_pipeline ? "Back to Pipeline" : "Back to Clients"}
                            on_back={() => router.push(clients_list_path)}
                            on_prev={prev_client_id ? () => router.push(client_detail_path(prev_client_id)) : undefined}
                            on_next={next_client_id ? () => router.push(client_detail_path(next_client_id)) : undefined}
                            nav_index={current_nav_index >= 0 ? current_nav_index + 1 : undefined}
                            nav_total={navigable_client_ids.length}
                            current_status={current_pipeline_status}
                            pipeline_history={pipeline_history}
                            on_status_change={(status) => handle_status_change(status, "Set by advisor")}
                            // Advisors walk a file only as far as documents
                            // received (index 3); underwriting takes it from
                            // there. Same ceiling the old advance button had.
                            advance_limit_index={3}
                            on_expand_all={() => broadcast_toggle_all(true)}
                            on_collapse_all={() => broadcast_toggle_all(false)}
                            chips={
                                <>
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
                                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                                            {last_upload ? `No uploads · ${days_since_last_upload}d` : `No uploads yet · ${days_since_last_upload}d`}
                                        </span>
                                    )}
                                </>
                            }
                        />
                    );
                })()}

                {/* Outstanding actions banner */}
                {render_outstanding_banner(scoped_required_docs)}

                {/* ── Business tab strip ─────────────────────────────
                    Renders one tab per business. The "Add Business" CTA at the
                    end opens the modal for creating an additional business
                    under this client. Switching tabs updates active_business_id;
                    per-tab data scoping (docs / pipeline / etc.) lands in a
                    later pass. */}
                <BusinessTabStrip
                    businesses={businesses}
                    active_business_id={active_business_id}
                    on_select={set_active_business_id}
                    on_add={() => set_is_add_business_open(true)}
                    on_delete={(b) => set_business_pending_delete(b)}
                />

                <AddBusinessModal
                    client_vault_id={client_id}
                    open={is_add_business_open}
                    on_close={() => set_is_add_business_open(false)}
                    on_created={async (b) => {
                        // Refetch the whole client so the new business loads with
                        // its funding deal flattened in, its requested docs, and
                        // any other scoped state — then land on its tab. We can't
                        // just append the API's `business` object: it lacks the
                        // flattened funding ask (capital_requested, loan type, …)
                        // and the doc requests created server-side aren't in state
                        // yet. fetch_client_details only auto-selects a tab when
                        // none is set, so setting active afterward sticks.
                        await fetch_client_details();
                        set_active_business_id(b.id);
                    }}
                />

                {/* Confirm dialog for removing a non-primary business. Cascades
                    on the server: storage objects + dynamic doc requests + open
                    positions + approvals + uploads + pipeline rows scoped to
                    this business all go. */}
                {business_pending_delete && (
                    <Dialog open={true} onOpenChange={(open) => { if (!open && !is_deleting_business) set_business_pending_delete(null); }}>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Remove {business_pending_delete.company_name}?</DialogTitle>
                                <DialogDescription>
                                    This permanently deletes this business and everything tied to it:
                                    uploaded documents, doc requests, open positions, pipeline events,
                                    and any funding deals. The client's other businesses are unaffected.
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                                <Button
                                    variant="outline"
                                    onClick={() => set_business_pending_delete(null)}
                                    disabled={is_deleting_business}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="destructive"
                                    onClick={async () => {
                                        const target = business_pending_delete;
                                        if (!target) return;
                                        set_is_deleting_business(true);
                                        try {
                                            const res = await fetch(`/api/advisor/clients/${client_id}/businesses/${target.id}`, { method: "DELETE" });
                                            const json = await res.json();
                                            if (!res.ok) throw new Error(json.error || "Failed to remove business");
                                            toast.success(`${target.company_name} removed`);
                                            set_businesses((prev) => prev.filter((b) => b.id !== target.id));
                                            // Fall back to the primary tab so the docs view doesn't go blank.
                                            const primary = businesses.find((b) => b.is_primary && b.id !== target.id);
                                            if (primary) set_active_business_id(primary.id);
                                            set_business_pending_delete(null);
                                        } catch (e: any) {
                                            toast.error(e.message || "Could not remove business");
                                        } finally {
                                            set_is_deleting_business(false);
                                        }
                                    }}
                                    disabled={is_deleting_business}
                                >
                                    {is_deleting_business ? "Removing…" : "Remove Business"}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                )}

                {/* ── Profile Header ──────────────────────────────────
                    Client-level identity fields (name, email, phone, credit
                    score, referral, funding app status) stay constant across
                    tabs. The "Business" + "Financials" columns rescope to the
                    active tab.

                    For the PRIMARY tab we keep reading from client_data_vault
                    (legacy fat row — has every field populated from signup).
                    For NON-PRIMARY tabs we read STRICTLY from the business_profiles
                    row — no fallback to cdv. Missing fields render as "—" so
                    the advisor can see what's actually on each business
                    instead of accidentally showing primary's data. */}
                {(() => {
                    if (!displayed_profile) return null;
                    return (
                <ClientProfileHeader
                    client_profile={displayed_profile}
                    completion_percentage={completion_percentage}
                    active_business_profile_id={active_business_id}
                    is_resending={is_resending}
                    is_generating_magic_link={is_generating_magic_link}
                    is_sending_password_reset={is_sending_password_reset}
                    is_saving_referral_partner={is_saving_referral_partner}
                    on_edit={() => set_is_edit_modal_open(true)}
                    on_delete_vault={() => set_is_delete_vault_modal_open(true)}
                    on_resend={handle_resend_credentials}
                    on_copy_magic_link={handle_copy_magic_link}
                    on_add_funding_app={() => set_is_manual_funding_modal_open(true)}
                    on_send_password_reset={handle_send_password_reset}
                    on_referral_partner_change={handle_referral_partner_change}
                />
                    );
                })()}

                {/* ── Client Notes (signup context + file notes) ────── */}
                <CollapsibleSection
                    clientId={client_profile.id}
                    slug="notes"
                    title="Client Notes"
                    summary={
                        file_notes.length === 0
                            ? "Loan purpose + signup notes"
                            : `${file_notes.length} file note${file_notes.length === 1 ? "" : "s"}`
                    }
                    defaultOpen
                >
                    <ClientNotesCard
                        loan_purpose={displayed_profile?.loan_purpose || ""}
                        additional_notes={displayed_profile?.additional_notes || ""}
                        file_notes={file_notes}
                        new_file_note={new_file_note}
                        is_adding_file_note={is_adding_file_note}
                        on_new_file_note_change={set_new_file_note}
                        on_add_file_note={handle_add_file_note}
                        on_save_signup_notes={handle_save_signup_notes}
                    />
                </CollapsibleSection>

                {/* ── Admin: Reassign Advisor (admin-only) ──────────────
                    Lets admins move a client to a different primary advisor.
                    Renders just above the Followers card so the assignment
                    chain reads naturally: owner → followers. */}
                {is_admin_path && (
                    <CollapsibleSection
                        clientId={client_profile.id}
                        slug="reassign"
                        title="Assigned Advisor"
                        summary={client_profile.advisor_name || "Unassigned"}
                        accessory={
                            <Button
                                onClick={open_reassign_modal}
                                size="sm"
                                variant="outline"
                                className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest border-emerald-300 hover:bg-emerald-100"
                            >
                                <UserCog className="w-3.5 h-3.5 mr-1.5" />
                                Reassign Advisor
                            </Button>
                        }
                        defaultOpen={false}
                    >
                        <div className="bg-emerald-50/40 p-5">
                            <p className="text-base font-bold text-slate-900">
                                {client_profile.advisor_name || "Unassigned"}
                            </p>
                        </div>
                    </CollapsibleSection>
                )}

                {/* ── Followers ─────────────────────────────────────── */}
                <CollapsibleSection
                    clientId={client_profile.id}
                    slug="followers"
                    title="Followers"
                    summary={
                        followers_list.length === 0
                            ? undefined
                            : followers_list.length <= 2
                                ? followers_list.map((f) => `${f.first_name} ${f.last_name}`.trim()).join(", ")
                                : `${followers_list.slice(0, 2).map((f) => `${f.first_name} ${f.last_name}`.trim()).join(", ")} +${followers_list.length - 2} more`
                    }
                    defaultOpen={false}
                >
                    <ClientFollowersCard
                        clientId={client_profile.id}
                        canManage={is_owner}
                        onFollowersChange={set_followers_list}
                    />
                </CollapsibleSection>

                {/* ── Funding rounds ───────────────────────────────────
                    Every financing this business has taken, so a repeat
                    client's history is readable instead of overwritten.
                    Advisors see it; only admins open the next round. */}
                <div className="mb-6">
                    <FundingRoundsCard
                        clientId={client_profile.id}
                        businessProfileId={active_business_id}
                        canStartRound={is_admin_path}
                        onRoundStarted={fetch_client_details}
                    />
                </div>

                {/* ── Lenders & responses (admin-only) ──────────────────
                    Who this file is going to and what each lender answered.
                    Informational — there is no admin approval step. The admin
                    can add a lender they already know and mark it submitted
                    from here. Self-fetches its own data. */}
                {is_admin_path && (
                    <CollapsibleSection
                        clientId={client_profile.id}
                        slug="lender-match"
                        title="Lenders & Responses"
                        defaultOpen
                    >
                        <AdminLenderReviewCard clientId={client_profile.id} />
                    </CollapsibleSection>
                )}

                {/* ── Contact history (calls / texts / emails) ───────────
                    HIDDEN — M2 / Communications Hub. Contact WITH the client, as
                    opposed to the staff-to-staff notes in the Internal
                    Communication panel below. Self-fetches its own rows; logging
                    one refreshes the activity-age badge, since reaching a client
                    is what keeps a file from going stale.

                    Withdrawn from the page until the sending identity is decided
                    (see the import note above). Uncomment this block and its
                    import to bring it back — nothing else needs changing.

                <CollapsibleSection
                    clientId={client_profile.id}
                    slug="contact-history"
                    title="Contact History"
                    summary="Calls, texts & emails with the client"
                    defaultOpen
                >
                    <CommunicationsTimeline
                        client_id={client_profile.id}
                        client_name={client_profile.client_name}
                        client_phone={client_profile.client_phone}
                        client_email={client_profile.client_email}
                        business_profile_id={active_business_id}
                        on_logged={() => set_last_activity_at(new Date().toISOString())}
                    />
                </CollapsibleSection>
                */}

                {/* ── Docs + Communication 2-col grid ───────────────── */}
                <CollapsibleSection
                    clientId={client_profile.id}
                    slug="docs-comm"
                    title="Documents & Communication"
                    summary={`${completion_percentage}% complete${notes.length > 0 ? ` · ${notes.length} note${notes.length === 1 ? "" : "s"}` : ""}`}
                    defaultOpen
                >
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
                    {/* Left: document accordion */}
                    <div className="lg:col-span-2">
                        <DocumentUploadStatus
                            required_docs={scoped_required_docs}
                            documents={scoped_documents}
                            approvals={approvals}
                            expanded_categories={expanded_categories}
                            completion_percentage={completion_percentage}
                            document_groups={document_groups}
                            zipping={is_zipping}
                            on_download_packet={download_entire_packet}
                            requesting_again_code={requesting_again_code}
                            on_toggle_expand={toggle_category_expansion}
                            on_request_docs={() => set_is_request_modal_open(true)}
                            on_request_again={handle_request_again}
                            on_upload={(code, label) => {
                                set_upload_doc_code(code);
                                set_upload_doc_label(label);
                                set_upload_files([]);
                                // A leftover account from the last upload would
                                // silently file this batch under the wrong one.
                                set_upload_document_group_id(null);
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
                </CollapsibleSection>

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
                    documentId={preview_modal.doc?.id || ""}
                    fileType={preview_modal.doc?.type}
                    onRename={preview_modal.doc ? () => set_renaming_file({
                        id: preview_modal.doc!.id,
                        label: preview_modal.doc!.custom_label || preview_modal.doc!.name,
                    }) : undefined}
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
                            {/* Which group these files belong to. Above the file
                                picker so a twelve-month batch is filed before it
                                is chosen, not after. */}
                            {offersGrouping(upload_doc_code, {
                                groupCount: groupsForDocCode(document_groups, upload_doc_code).length,
                            }) && (
                                <DocumentGroupPicker
                                    docCode={upload_doc_code}
                                    businessProfileId={active_business_id}
                                    groups={document_groups}
                                    value={upload_document_group_id}
                                    onChange={set_upload_document_group_id}
                                    onGroupCreated={add_document_group}
                                    disabled={is_uploading}
                                    tone="slate"
                                />
                            )}

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

                        <div className="py-6 border-y border-slate-100 my-4">
                            <Label htmlFor="fico_score" className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 block">
                                Client FICO Score
                            </Label>
                            <div className="relative group">
                                <Input
                                    id="fico_score"
                                    type="number"
                                    placeholder="e.g. 720"
                                    value={fico_score}
                                    onChange={(e) => set_fico_score(e.target.value)}
                                    className="h-14 bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 focus:bg-white rounded-2xl text-xl font-black transition-all pl-12"
                                />
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-emerald-500 transition-colors">
                                    <ShieldCheck className="h-5 w-5" />
                                </div>
                            </div>
                            <p className="mt-3 text-[10px] font-bold text-slate-400 italic">
                                Please provide a plain number (e.g. 720). This will be shown to the underwriting team.
                            </p>
                        </div>
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
                                disabled={is_submitting_vault || !fico_score}
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
                                                {type.code === 'business_bank_statements' && selected_doc_ids.includes(type.id) && (
                                                    <Select
                                                        value={String(request_statement_months)}
                                                        onValueChange={(v) => set_request_statement_months(parseInt(v))}
                                                    >
                                                        <SelectTrigger className="h-auto text-xs font-bold border rounded-md px-2 py-1 gap-1 bg-white text-gray-700 shrink-0 w-auto">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="rounded-xl">
                                                            {[6, 12, 18, 24].map((m) => (
                                                                <SelectItem key={m} value={String(m)}>{m} months</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )}
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

                {/* Edit Profile Modal — gated on open so defaultValues refresh
                    each time (and when switching business tabs). On a non-primary
                    tab it edits THAT business (business_profiles + funding_deals);
                    on the primary tab it edits the client_data_vault row. */}
                {client_profile && is_edit_modal_open && (() => {
                    const active_business = businesses.find((b) => b.id === active_business_id);
                    const on_business = !!active_business && !active_business.is_primary;
                    // Raw (non-"—") business values for editing; client identity
                    // fields stay from client_profile (shared across businesses).
                    const edit_data = on_business
                        ? {
                            ...client_profile,
                            company_name: active_business!.company_name || "",
                            company_city: active_business!.company_city || "",
                            company_state: active_business!.company_state || "",
                            company_zip_code: active_business!.company_zip_code || "",
                            legal_entity_type: active_business!.legal_entity_type || "",
                            business_start_date: active_business!.business_start_date || "",
                            avg_monthly_deposits: active_business!.avg_monthly_deposits ?? 0,
                            avg_annual_revenue: active_business!.avg_annual_revenue ?? 0,
                            employees_count: active_business!.employees_count ?? 0,
                            is_home_based: active_business!.is_home_based ?? false,
                            capital_requested: active_business!.capital_requested ?? 0,
                            proposed_loan_type: active_business!.proposed_loan_type ?? "",
                            loan_purpose: active_business!.loan_purpose ?? "",
                            funding_eta: active_business!.funding_eta ?? "",
                        }
                        : client_profile;
                    return (
                    <EditProfileModal
                        isOpen={is_edit_modal_open}
                        onClose={() => set_is_edit_modal_open(false)}
                        onSuccess={fetch_client_details}
                        clientData={edit_data}
                        businessProfileId={on_business ? active_business!.id : null}
                        isPrimary={!on_business}
                    />
                    );
                })()}

                {/* Reassign Advisor Modal (admin-only) */}
                {is_admin_path && (
                    <Dialog
                        open={is_reassign_modal_open}
                        onOpenChange={(open) => { if (!is_reassigning) set_is_reassign_modal_open(open); }}
                    >
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Reassign Primary Advisor</DialogTitle>
                                <DialogDescription>
                                    Move <strong>{client_profile?.client_name}</strong> to a different primary advisor. Existing followers, documents, and pipeline state are preserved. The new advisor will receive future client emails and notifications.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="py-4 space-y-2">
                                <Label className="text-xs font-black uppercase tracking-widest text-slate-400">
                                    New advisor
                                </Label>
                                <Select
                                    value={reassign_target_id}
                                    onValueChange={set_reassign_target_id}
                                >
                                    <SelectTrigger className="w-full h-12 rounded-xl border-slate-200 px-3 text-sm font-medium bg-white">
                                        <SelectValue placeholder="Select an advisor…" />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        {reassign_advisor_options
                                            .filter(a => a.id !== client_profile?.advisor_id)
                                            .map(a => (
                                                <SelectItem key={a.id} value={a.id}>
                                                    {a.first_name} {a.last_name} — {a.email}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                                {client_profile?.advisor_name && (
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                                        Currently assigned: {client_profile.advisor_name}
                                    </p>
                                )}
                            </div>
                            <DialogFooter>
                                <Button variant="ghost" onClick={() => set_is_reassign_modal_open(false)} disabled={is_reassigning}>
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handle_reassign_advisor}
                                    disabled={is_reassigning || !reassign_target_id}
                                    className="bg-emerald-500 hover:bg-emerald-600 text-white"
                                >
                                    {is_reassigning ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Reassigning...</> : <><UserCog className="h-4 w-4 mr-2" />Reassign</>}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
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
                                This will mark the application as completed and sync the document with GHL.
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