// src/app/underwriting/dashboard/clients/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Download,
    FileText,
    Mail,
    Phone,
    AlertCircle,
    Loader2,
    Bell,
    ExternalLink,
    Plus,
    Trash2,
    UploadCloud,
    Slack,
    Send,
    Search,
    Archive,
} from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import DocumentPreviewModal from "@/components/pdf/pdf-viewer";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { notifyAdvisor, markDocumentAsViewed } from "../../actions";
import { fetchInternalNotes, addInternalNote } from "@/app/actions/internal-notes";
import { toast } from "@/lib/toast";
import clsx from "clsx";
import { LoanFundedDialog } from "@/components/loan-funded-dialog";
import { FundingRoundsCard } from "@/components/funding/funding-rounds-card";
import { useLenderApiAssignments } from "@/components/lender-api/use-lender-api-assignments";
import {
    LenderPanel,
    type LenderAssignment,
    type SubmittedLifecycleStatus,
} from "@/components/client-file/panels/lender-panel";
import {
    OpenPositionsPanel,
    type OpenPosition,
} from "@/components/client-file/panels/open-positions-panel";
import {
    UwDocumentPacket,
    type UserDocument,
} from "@/components/client-file/panels/uw-document-packet";
import {
    requestDocuments,
    approveDocumentCategory,
    rejectDocumentCategory,
} from "@/app/advisor/dashboard/clients/[id]/actions";
import { getClientPipelineHistory, updateLoanStatus, type LoanStatus, type PipelineStatusEntry } from "@/app/actions/pipeline";
import { getBulkClientActivity } from "@/app/actions/advisor";
import { differenceInDays } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameClientFile, deleteClientFile } from "../../actions";
import { InternalCommunication } from "@/app/advisor/dashboard/clients/[id]/_components/internal-communication";
import { addManualFundingApplication } from "@/app/advisor/dashboard/clients/[id]/actions";
import { BankAnalysisViewer } from "@/components/admin/bank-analysis-viewer";
import type { BusinessTab } from "@/app/advisor/dashboard/clients/[id]/_components/business-tab-strip";
import { matchesActiveBusiness, matchesActiveDeal, normalizeSupabaseJoin, formatRequirementLabel } from "@/lib/document-scope";
// The shared client-file shell (phase 1). Everything below is presentational:
// this page keeps its state, fetching, handlers and dialogs and fills the slots.
import { getClientFileCapabilities } from "@/components/client-file/capabilities";
import { useFileTab } from "@/components/client-file/use-file-tab";
import { ClientFileShell } from "@/components/client-file/client-file-shell";
import { FileHeader, type HeaderAction, type HeaderMenuItem } from "@/components/client-file/file-header";
import { FileTabs, type FileTabItem } from "@/components/client-file/file-tabs";
import { SummaryTiles, type SummaryTile } from "@/components/client-file/summary-tiles";
import { PanelCard } from "@/components/client-file/panel-card";
import { FactList } from "@/components/client-file/fact-list";
import { EmptyLine } from "@/components/client-file/empty-line";
import { ContactRow } from "@/components/client-file/contact-row";
import { StatusLine } from "@/components/client-file/status-line";
import { ReviewWorkbench, type ReviewCategory } from "@/components/client-file/review-workbench";
import {
    formatCurrency,
    formatCreditScore,
    formatDate,
    formatMonthly,
    formatTimeInBusiness,
} from "@/components/client-file/format";
import {
    formatGroupLabel,
    getGroupConfig,
    UNGROUPED_KEY,
    UNGROUPED_LABEL,
} from "@/lib/document-groups";
import { zipDocuments, downloadDocument } from "@/lib/document-download";
import { useDocumentGroups } from "@/hooks/use-document-groups";

// Slack deal-channel integration is built but not yet tested end-to-end.
// Flip to `true` to re-enable the "Create / Open Slack Channel" button.
const SLACK_FEATURE_ENABLED = true;

/**
 * Deep link to a deal channel. The ?team= param is not optional on Enterprise
 * Grid: without it Slack resolves the channel against whichever workspace the
 * browser has active, and errors out if the channel does not live there.
 *
 * The workspace id arrives from GET /api/slack/workspace rather than a
 * NEXT_PUBLIC_ env var. A NEXT_PUBLIC_ value is inlined into the JS bundle,
 * which is served to anyone who can reach the app — logged in or not — whereas
 * this page is staff-only. Falls back to a link without ?team= while the fetch
 * is in flight or if it fails; that link still works off Enterprise Grid.
 */
function slack_deep_link(channel_id: string, team_id: string | null): string {
    const team_param = team_id ? `&team=${team_id}` : '';
    return `https://slack.com/app_redirect?channel=${channel_id}${team_param}`;
}

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

// OpenPosition moved to @/components/client-file/panels/open-positions-panel
// with the table that renders it.

// LenderAssignment, LenderRowState and derive_lender_row_state moved to
// @/components/client-file/panels/lender-panel with the panel that renders them.

// UserDocument moved to @/components/client-file/panels/uw-document-packet with
// the packet that renders it.

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
    const client_id = params.id as string;

    // This page only mounts under /underwriting/dashboard/clients/[id]. The
    // admin routes (/admin/uw/dashboard/clients/[id], /admin/advisor/clients/[id])
    // redirect to /admin/clients/[id], which renders the workspace file instead,
    // so the old is_admin_* branches here were dead and are gone.
    const capabilities = useMemo(() => getClientFileCapabilities("underwriting"), []);
    // Staff-only surface: uploading, requesting and funding-app tools are all
    // open here. Kept as a variable so the packet props read the same.
    const can_upload = true;
    const queue_path = "/underwriting/dashboard";
    const client_base_path = "/underwriting/dashboard/clients";
    const [active_tab, set_active_tab] = useFileTab(capabilities.tabs);

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
    const [approvals_raw, set_approvals_raw] = useState<{ doc_code: string; business_profile_id: string | null; funding_deal_id: string | null }[]>([]);
    const [error_message, set_error_message] = useState<string>("");
    const [lender_assignments, set_lender_assignments] = useState<LenderAssignment[]>([]);
    const [is_loading_assignments, set_is_loading_assignments] = useState(false);
    const [submitting_assignment_id, set_submitting_assignment_id] = useState<string | null>(null);
    const { summaries: lender_api_summaries, reload: reload_lender_api } = useLenderApiAssignments(client_id);
    /**
     * Re-submit dialog: sending a deal back to a lender that already answered,
     * with whatever that lender asked for. Held as the target row rather than a
     * bare boolean so the dialog can name the lender it is about.
     */
    const [resubmit_target, set_resubmit_target] = useState<{ id: string; lender_name: string; status: string } | null>(null);
    const [resubmit_note, set_resubmit_note] = useState("");
    /**
     * Bumped per assignment when a re-submission clears that row's response.
     * Feeds the response panel's key so it remounts and reloads its (now empty)
     * note. Keyed on this rather than on status so an ordinary dropdown change
     * doesn't throw away a note UW is halfway through typing.
     */
    const [response_panel_epoch, set_response_panel_epoch] = useState<Record<string, number>>({});

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

    /**
     * Send the deal back to a lender that already answered.
     *
     * A decline is not the end of the conversation here — the lender usually
     * says what it would need, we go and get it, and the same file goes back.
     * That is a different act from the dropdown correcting a misclick, which is
     * why it is its own button and its own flag: only this path retires the
     * previous response, filing it to the internal notes and clearing the panel
     * so the new round is recorded fresh rather than edited over the old one.
     */
    async function resubmit_assignment() {
        if (!resubmit_target) return;
        const { id: assignment_id, lender_name } = resubmit_target;
        set_submitting_assignment_id(assignment_id);
        try {
            const res = await fetch(`/api/lender-assignments/${assignment_id}/response`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'submitted',
                    resubmission: true,
                    resubmit_note: resubmit_note.trim() || undefined,
                }),
            });
            const result = await res.json();
            if (!res.ok || !result?.success) {
                toast.error(result?.error || 'Failed to re-submit');
                return;
            }
            toast.success(`Re-submitted to ${lender_name}`);
            set_resubmit_target(null);
            set_resubmit_note("");
            set_response_panel_epoch(prev => ({ ...prev, [assignment_id]: (prev[assignment_id] ?? 0) + 1 }));
            await fetch_lender_assignments();
        } catch (err: any) {
            console.error('resubmit_assignment error:', err);
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

    // Archive the deal's Slack channel. Clears the stored channel id server-side,
    // so the UI falls back to the "Create Slack Channel" button afterwards. Also
    // the recovery path when someone archives or deletes the channel directly in
    // Slack — the server treats an already-gone channel as success and unlinks it.
    async function archive_slack_channel() {
        set_show_archive_slack_confirm(false);
        set_is_archiving_slack_channel(true);
        try {
            const res = await fetch('/api/slack/archive-channel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id }),
            });
            const result = await res.json();
            if (!res.ok || !result?.success) {
                toast.error(result?.error || 'Failed to archive Slack channel');
                return;
            }
            set_slack_channel({ id: null, name: null });
            toast.success(
                result.unreachable
                    ? 'Channel is no longer reachable in Slack — unlinked. You can create a new one.'
                    : 'Slack channel archived'
            );
        } catch (err: any) {
            console.error('archive_slack_channel error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_archiving_slack_channel(false);
        }
    }

    // Manual funding application upload
    const [is_funding_app_open, set_is_funding_app_open] = useState(false);
    const [funding_app_file, set_funding_app_file] = useState<File | null>(null);
    const [is_uploading_funding_app, set_is_uploading_funding_app] = useState(false);
    // Lender version: funding app with the agreement page removed. Uploaded as a
    // standalone shareable doc — does NOT mark the deal complete, sync GHL, or
    // touch the document-request flow.
    const [funding_app_for_lenders, set_funding_app_for_lenders] = useState(false);

    // Upload documents on behalf of the client (generic multi-type modal)
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
    /**
     * What this modal is actually for, at the underwriting stage: a LENDER asked
     * for a document type that isn't on the file yet, so it needs a slot.
     *
     * Adding the slot is the action; asking the client is the exception, which
     * is why it is opt-in. Some stips the client has to supply and this gets
     * ticked; most are documents staff already hold or produce, and ticking it
     * would chase the client for something nobody is waiting on them for.
     * Unticked, requestDocuments runs with notifyClient:false — see there.
     */
    const [also_ask_client, set_also_ask_client] = useState(false);
    /** Which lender asked for it, if any. Context only — recorded as an internal
     *  note so the slot's reason outlives the person who opened it. */
    const [stip_lender, set_stip_lender] = useState("");
    const [requesting_again_code, set_requesting_again_code] = useState<string | null>(null);
    const [approving_code, set_approving_code] = useState<string | null>(null);

    /**
     * Category rejection. Underwriting can now bounce a category back to the
     * client from the Review tab — same server action, same client email and
     * in-app notice as the advisor surface.
     */
    const [is_reject_modal_open, set_is_reject_modal_open] = useState(false);
    const [reject_doc_type, set_reject_doc_type] = useState<{ code: string; label: string } | null>(null);
    const [reject_reason, set_reject_reason] = useState("");
    const [is_rejecting, set_is_rejecting] = useState(false);
    // The dialog fades out over 200ms after reject_doc_type is cleared; without
    // a sticky copy the title would flash "Reject document?" on the way out.
    const reject_label_ref = useRef("document");
    if (reject_doc_type) reject_label_ref.current = reject_doc_type.label;

    // Which file the Review tab is showing. The workbench keeps its own fallback
    // selection; this mirrors it only so the auto-selected first file can be
    // marked viewed (see review_visible_file_id).
    const [review_selected_file_id, set_review_selected_file_id] = useState<string | null>(null);

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
    // The funding round on screen. Documents and approvals stamped with an
    // OLDER round drop out of the working view — that is what makes a renewal
    // re-collect bank statements instead of inheriting last year's.
    const active_deal_id = useMemo<string | null>(
        () => businesses.find((b) => b.id === active_business_id)?.active_deal_id ?? null,
        [businesses, active_business_id]
    );

    /**
     * The lenders belonging to the round being WORKED.
     *
     * `lender_assignments` is every lender this client has ever been sent to,
     * across every round — that flat list is what underwriting was reading, and
     * once a repeat client has two rounds it silently mixes last round's
     * declines into this round's queue with nothing on screen to tell them
     * apart. The per-round history now lives in FundingRoundsCard; this page's
     * working list shows the current round only.
     *
     * matchesActiveDeal keeps legacy NULL rows visible, so on every file that
     * exists today this is the same list it has always been.
     */
    const active_round_assignments = useMemo(
        () =>
            lender_assignments.filter((a) =>
                matchesActiveDeal((a as { funding_deal_id?: string | null }).funding_deal_id ?? null, active_deal_id)
            ),
        [lender_assignments, active_deal_id]
    );

    const approvals = useMemo<Set<string>>(() => {
        return new Set(
            approvals_raw
                .filter((a) => matchesActiveBusiness(a.business_profile_id, active_business_id, a.doc_code))
                .filter((a) => matchesActiveDeal((a as any).funding_deal_id ?? null, active_deal_id))
                .map((a) => a.doc_code)
        );
    }, [approvals_raw, active_business_id, active_deal_id]);

    // Scoped docs + required docs for the active business tab. Client-scoped
    // codes (driver's license / MyScoreIQ / PFS) surface on every tab. De-dupe
    // the requested-doc list by code so a client-scoped doc requested under
    // multiple businesses still renders as a single card.
    const scoped_documents = useMemo<UserDocument[]>(() => {
        const active_is_primary = businesses.find((b) => b.id === active_business_id)?.is_primary ?? false;
        return documents.filter((d) => {
            const code = (d as any).doc_code ?? (d as any).category ?? null;
            const bpid = (d as any).business_profile_id ?? null;
            // A file belonging to a previous round is that round's record, not
            // this one's — it stays in the vault but off the active packet.
            if (!matchesActiveDeal((d as any).funding_deal_id ?? null, active_deal_id)) return false;
            if (matchesActiveBusiness(bpid, active_business_id, code)) return true;
            // Resilience: a legacy/unscoped upload (business_profile_id = null,
            // e.g. a funding application e-signed before per-business scoping)
            // surfaces on the PRIMARY tab so it's never silently lost.
            if (bpid === null && active_is_primary) return true;
            return false;
        });
    }, [documents, active_business_id, businesses, active_deal_id]);

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

    // Files on the active tab that sit outside the required set — the
    // "Miscellaneous Files" block at the foot of the packet.
    const misc_documents = useMemo<UserDocument[]>(
        () => scoped_documents.filter((d) => !scoped_required_docs.some((r) => r.code === d.category)),
        [scoped_documents, scoped_required_docs],
    );

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

    // ------------------------------------------------------------------
    // Document organisation
    // ------------------------------------------------------------------
    // Fields group by their own axis instead of rendering as one flat list —
    // a four-account, twelve-month statement run is 48+ rows and the O'Rourke
    // file is 124, and the same file carries several years of tax returns and a
    // licence per owner. See @/lib/document-groups.
    const {
        groups: document_groups,
        addGroup: add_document_group,
        refresh: refresh_document_groups,
    } = useDocumentGroups(active_business_id);
    // The group new uploads are filed under. Chosen once in the category
    // header, then reused for the whole batch — documents arrive one group at a
    // time, so per-file tagging would be busywork.
    const [upload_group_id, set_upload_group_id] = useState<string | null>(null);
    // The retrofit path: everything uploaded before this feature has no group,
    // so UW multi-selects those rows and files them in one go.
    const [selected_document_ids, set_selected_document_ids] = useState<Set<string>>(new Set());
    const [assign_target_group_id, set_assign_target_group_id] = useState<string | null>(null);
    const [is_assigning_documents, set_is_assigning_documents] = useState(false);
    // Group pending deletion, with the number of files that will be detached.
    const [group_pending_delete, set_group_pending_delete] = useState<
        { id: string; label: string; document_count: number } | null
    >(null);
    const [is_deleting_group, set_is_deleting_group] = useState(false);
    // Bulk-download progress. Non-null while an archive is being built; the
    // buttons disable so two archives can't be assembled at once.
    const [is_zipping, set_is_zipping] = useState<{ completed: number; total: number } | null>(null);
    // Group being edited, held as a working copy so Cancel is a real cancel.
    // doc_code rides along because it decides what the edit form's fields are
    // called and what counts as valid.
    const [group_being_edited, set_group_being_edited] = useState<
        { id: string; doc_code: string; name: string; identifier: string; subtype: string; nickname: string } | null
    >(null);
    const [is_saving_group, set_is_saving_group] = useState(false);
    const [group_edit_error, set_group_edit_error] = useState<string | null>(null);

    // Switching business tabs invalidates all three — the group ids belong to
    // the tab we just left, and a selection carried across tabs would file
    // documents the user can no longer see.
    useEffect(() => {
        set_upload_group_id(null);
        set_selected_document_ids(new Set());
        set_assign_target_group_id(null);
    }, [active_business_id]);

    // Seed the assign target from the group already chosen at the top of the
    // section, the first time a selection is made. On a field with one group —
    // the common case when sorting a backlog — that means selecting rows and
    // hitting File, with no dropdown step in between.
    //
    // Only on the empty → non-empty transition, so an explicit "Move to
    // Ungrouped" (null) is never overwritten while the selection is still live.
    const had_document_selection = useRef(false);
    useEffect(() => {
        const has_selection = selected_document_ids.size > 0;
        if (has_selection && !had_document_selection.current) {
            set_assign_target_group_id(prev => prev ?? upload_group_id);
        }
        had_document_selection.current = has_selection;
    }, [selected_document_ids, upload_group_id]);

    function toggle_document_selection(doc_id: string) {
        set_selected_document_ids(prev => {
            const next = new Set(prev);
            if (next.has(doc_id)) next.delete(doc_id);
            else next.add(doc_id);
            return next;
        });
    }

    /** Select / clear every file in one section (the section header checkbox). */
    function toggle_document_section(doc_ids: string[], select: boolean) {
        set_selected_document_ids(prev => {
            const next = new Set(prev);
            for (const id of doc_ids) {
                if (select) next.add(id);
                else next.delete(id);
            }
            return next;
        });
    }

    /**
     * File the selected documents into a group (or, with a null target, pull
     * them back out). The endpoint also rewrites each file's label so the
     * download name carries the group — sectioning the list without renaming
     * the files would leave the lender's copy exactly as ambiguous as before.
     *
     * Files someone RENAMED keep their name and only change group; the toast
     * says how many, because "12 files filed" while two of them quietly kept a
     * name that doesn't mention the account is a surprise at download time.
     */
    async function handle_assign_documents(target_group_id: string | null) {
        const ids = Array.from(selected_document_ids);
        if (ids.length === 0) return;

        set_is_assigning_documents(true);
        try {
            const res = await fetch('/api/document-groups/assign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ document_ids: ids, document_group_id: target_group_id }),
            });
            const result = await res.json().catch(() => null);

            if (!res.ok) {
                toast.error(result?.error || 'Could not file the documents');
                return;
            }

            const updated = result?.updated ?? 0;
            const skipped = Array.isArray(result?.skipped) ? result.skipped.length : 0;
            const preserved = result?.preserved_labels ?? 0;

            if (updated === 0) {
                toast.error('No documents were filed');
                return;
            }
            // Report partial success honestly — silently succeeding on 40 of 50
            // is how a packet goes out half-organised.
            const parts = [`${updated} file(s) filed`];
            if (skipped > 0) parts.push(`${skipped} skipped`);
            if (preserved > 0) parts.push(`${preserved} kept their custom name`);
            toast.success(parts.join(', '));

            set_selected_document_ids(new Set());
            set_assign_target_group_id(null);
            fetch_client_details();
        } catch (err: any) {
            console.error('assign documents error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_assigning_documents(false);
        }
    }

    /**
     * Save an edited group.
     *
     * Correcting the name or the identifier also re-labels every file in the
     * group — the API does that, because custom_label embeds the group and
     * would otherwise keep the typo forever.
     *
     * Validation is the API's: it runs the field's own rules (bank statements
     * still demand four digits, a tax year does not) and returns a message
     * written for the person typing, so duplicating them here would only create
     * a second set to drift.
     */
    async function handle_save_group() {
        if (!group_being_edited) return;

        set_is_saving_group(true);
        set_group_edit_error(null);
        try {
            const res = await fetch(`/api/document-groups/${group_being_edited.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: group_being_edited.name.trim(),
                    identifier: group_being_edited.identifier.trim() || null,
                    subtype: group_being_edited.subtype.trim() || null,
                    nickname: group_being_edited.nickname.trim() || null,
                }),
            });
            const result = await res.json().catch(() => null);

            if (!res.ok || !result?.group) {
                // 409 = another group on this field already owns that name,
                // which is the dedupe index doing its job.
                set_group_edit_error(result?.error || 'Could not save the group');
                return;
            }

            const relabelled = result.relabelled ?? 0;
            toast.success(
                relabelled > 0
                    ? `Group updated · ${relabelled} file(s) renamed`
                    : 'Group updated'
            );

            set_group_being_edited(null);
            await refresh_document_groups();
            // Labels changed on the documents themselves, so the list has to
            // come back from the server rather than being patched locally.
            if (relabelled > 0) fetch_client_details();
        } catch (err: any) {
            console.error('save group error:', err);
            set_group_edit_error('An unexpected error occurred');
        } finally {
            set_is_saving_group(false);
        }
    }

    /**
     * Delete a group. Two-step on purpose: the first call is sent without
     * ?force and comes back 409 with the real file count, which is what the
     * confirm dialog quotes. Nothing is guessed client-side.
     *
     * The client's documents are never deleted — the FK is ON DELETE SET NULL,
     * so they detach back to "Ungrouped" (and get relabelled on the way).
     */
    async function handle_delete_group(group_id: string, label: string, force = false) {
        if (force) set_is_deleting_group(true);
        try {
            const res = await fetch(
                `/api/document-groups/${group_id}${force ? '?force=true' : ''}`,
                { method: 'DELETE' }
            );
            const result = await res.json().catch(() => null);

            // Still holds files — surface the count and let the user decide.
            if (res.status === 409 && result?.error === 'group_has_documents') {
                set_group_pending_delete({
                    id: group_id,
                    label,
                    document_count: result.document_count ?? 0,
                });
                return;
            }

            if (!res.ok) {
                toast.error(result?.error || 'Could not delete the group');
                return;
            }

            const detached = result?.detached ?? 0;
            toast.success(
                detached > 0
                    ? `Group deleted · ${detached} file(s) moved to Ungrouped`
                    : 'Group deleted'
            );

            set_group_pending_delete(null);
            if (upload_group_id === group_id) set_upload_group_id(null);
            if (assign_target_group_id === group_id) set_assign_target_group_id(null);
            await refresh_document_groups();
            fetch_client_details();
        } catch (err: any) {
            console.error('delete group error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_is_deleting_group(false);
        }
    }

    // Pipeline State
    const [current_pipeline_status, set_current_pipeline_status] = useState<LoanStatus>("created");
    const [pipeline_history, set_pipeline_history] = useState<PipelineStatusEntry[]>([]);
    const [is_advancing_status, set_is_advancing_status] = useState(false);

    // Slack deal-channel state (created from the docs-approved gate).
    const [slack_channel, set_slack_channel] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
    const [is_creating_slack_channel, set_is_creating_slack_channel] = useState(false);
    const [is_archiving_slack_channel, set_is_archiving_slack_channel] = useState(false);
    const [show_archive_slack_confirm, set_show_archive_slack_confirm] = useState(false);
    /**
     * Slack workspace id for the "Open Slack Channel" deep link, fetched from a
     * staff-gated route instead of a NEXT_PUBLIC_ env var (see slack_deep_link).
     * Null until it lands; the link degrades to one without ?team=, which is
     * only wrong on Enterprise Grid.
     */
    const [slack_team_id, set_slack_team_id] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/slack/workspace');
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled) set_slack_team_id(data?.team_id ?? null);
            } catch (err) {
                // Non-fatal: the deep link just loses its ?team= param.
                console.error('slack workspace lookup failed (non-fatal):', err);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Renaming state
    const [renaming_file, set_renaming_file] = useState<{ id: string; label: string } | null>(null);
    const [is_renaming_loading, setIs_renaming_loading] = useState(false);

    // Deleting state — UW/admin own the file end-to-end, so they clear bad
    // uploads here instead of asking the advisor to do it.
    const [file_to_delete, set_file_to_delete] = useState<UserDocument | null>(null);
    const [is_deleting_file, set_is_deleting_file] = useState(false);

    // navigable-clients-state: Ordered list of client IDs for prev/next navigation in the UW header.
    const [navigable_client_ids, set_navigable_client_ids] = useState<string[]>([]);

    // Most recent meaningful interaction (status change, doc upload, internal note).
    const [last_activity_at, set_last_activity_at] = useState<string | null>(null);

    // First load blanks the page; refetches after an action don't. Navigating to
    // a different client resets it so the new file gets its own loading state.
    const has_loaded_once = useRef(false);

    useEffect(() => {
        has_loaded_once.current = false;
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
            // Only blank the page on the FIRST load. Every later refetch — after
            // an upload, a note, an approval — runs in place: flipping back to
            // LOADING unmounts the whole page, so the user loses their scroll
            // position and every expanded section on each upload.
            if (!has_loaded_once.current) {
                set_component_state(ComponentState.LOADING);
            }

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
                    advisors!client_data_vault_advisor_id_fkey (
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
                .select("doc_code, business_profile_id, funding_deal_id")
                .eq("client_vault_id", client_id);
            set_approvals_raw(
                (categoryApprovals || []).map((a: any) => ({
                    doc_code: a.doc_code,
                    business_profile_id: a.business_profile_id ?? null,
                    funding_deal_id: a.funding_deal_id ?? null,
                }))
            );

            // 8. Businesses for the tab strip — order primary first, then by
            //    display_order, then creation. Default the active tab to the
            //    primary so single-business clients see identical UI.
            const { data: businessRows } = await supabase
                .from("business_profiles")
                .select("id, company_name, is_primary, display_order, legal_entity_type, business_start_date, company_city, company_state, company_zip_code, avg_monthly_deposits, avg_annual_revenue, employees_count, is_home_based, industry, funding_deals (id, capital_requested, proposed_loan_type, loan_purpose, funding_eta, display_order, funded_at)")
                .eq("client_vault_id", client_id)
                .order("is_primary", { ascending: false })
                .order("display_order", { ascending: true })
                .order("created_at", { ascending: true });
            // Flatten each business's funding ask (lives on funding_deals) onto
            // the tab row so the header amount rescopes per active business.
            // The ask shown is the CURRENT round's — the newest deal, not the
            // oldest, or a repeat client's header would report the ask from the
            // financing they already closed.
            const rows = (businessRows || []).map((b: any): BusinessTab => {
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
            const primary = rows.find((b) => b.is_primary) || rows[0];
            if (primary && !active_business_id) {
                set_active_business_id(primary.id);
            }

            // 8. Fetch Lender Assignments
            await fetch_lender_assignments();

            has_loaded_once.current = true;
            set_component_state(ComponentState.SUCCESS);

        } catch (err: any) {
            console.error("fetch_client_details error:", err);
            // A failed background refresh must not replace a page the user is
            // working in — the data on screen is still the last good copy.
            if (!has_loaded_once.current) {
                set_error_message(err.message || "An unexpected error occurred.");
                set_component_state(ComponentState.ERROR);
            } else {
                toast.error(err.message || "Couldn't refresh this client's data.");
            }
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

    /**
     * Save one document. Authorised and named server-side by
     * GET /api/documents/[id]/file?download=1 — the browser holds no storage
     * credential of its own.
     */
    function download_document(doc: UserDocument) {
        downloadDocument(doc.id);
    }

    /**
     * download_all_documents: Downloads all documents in a category sequentially
     */
    /**
     * The entire review packet as one archive, foldered by category — and,
     * inside bank statements, by bank account.
     *
     * This is the action UW actually performs before shopping a deal: hand me
     * the file. Doing it category by category is 15 clicks and 15 archives to
     * merge by hand, which is why nobody did it and lenders got emailed
     * attachments instead.
     *
     * The folder names are the same labels shown on screen, so the zip opens
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
        const group_labels = new Map<string, string>(
            document_groups.map(g => [g.id, formatGroupLabel(g)])
        );
        // Which fields are actually organised on this file. A field with no
        // groups keeps its flat folder rather than gaining an "Ungrouped"
        // subfolder that holds everything and says nothing.
        const organised_codes = new Set(document_groups.map(g => g.doc_code));

        set_is_zipping({ completed: 0, total: docs.length });
        try {
            const result = await zipDocuments(docs, `${client_name} - Review Packet`, {
                folderOf: (d) => {
                    const doc = d as UserDocument;
                    const code = doc.doc_code ?? doc.category ?? "";
                    const category = label_by_code.get(code) || code || "Other";
                    // Organised fields nest one level deeper so a 133-file
                    // category doesn't reproduce the flat pile this all exists
                    // to fix.
                    if (organised_codes.has(code)) {
                        const group = doc.document_group_id
                            ? group_labels.get(doc.document_group_id) ?? UNGROUPED_LABEL
                            : UNGROUPED_LABEL;
                        return `${category} - ${group}`;
                    }
                    return category;
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
     * Replaces a loop that fired one browser download per file, 800ms apart —
     * which on a 133-statement category meant nearly two minutes of downloads
     * and, in practice, a browser that blocked the sequence partway and left
     * the underwriter with a fraction of the files and no error.
     *
     * `folderOf` is passed only when more than one group is represented: a zip
     * of one account's statements is already about that account, so nesting it
     * inside a folder of the same name would just add a click.
     */
    async function download_all_documents(docs: UserDocument[]) {
        if (docs.length === 0) return;
        if (is_zipping) return;

        const client_name = client_profile?.client_name || "Documents";
        const first_code = docs[0]?.doc_code ?? docs[0]?.category ?? null;
        const label = required_docs.find(r => r.code === first_code)?.label ?? "Documents";

        // More than one group represented → folder the archive by group so the
        // files don't land as one flat pile of same-named files.
        const group_labels = new Map<string, string>(
            document_groups.map(g => [g.id, formatGroupLabel(g)])
        );
        const distinct_groups = new Set(docs.map(d => d.document_group_id ?? UNGROUPED_KEY));
        const should_folder = distinct_groups.size > 1;

        set_is_zipping({ completed: 0, total: docs.length });
        try {
            const result = await zipDocuments(
                docs,
                `${client_name} - ${label}`,
                {
                    folderOf: should_folder
                        ? (d) => {
                            const id = (d as UserDocument).document_group_id;
                            return id ? group_labels.get(id) ?? UNGROUPED_LABEL : UNGROUPED_LABEL;
                        }
                        : undefined,
                    onProgress: (p) => set_is_zipping({ completed: p.completed, total: p.total }),
                }
            );

            if (!result.saved) return; // user dismissed the save dialog
            // Report shortfalls rather than claiming success — a silently short
            // packet is the failure mode this whole change exists to remove.
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
            } else {
                // Surfacing this matters: `funded` is rejected unless the Loan
                // Funded dialog recorded the deal, and the reason says so.
                toast.error(res.error || "Failed to update status");
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
            <div className="rounded-2xl border border-amber-200/70 bg-amber-50/60 p-4">
                <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 flex-shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-amber-900">
                            {outstanding.length} outstanding item{outstanding.length === 1 ? "" : "s"}
                        </h4>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {outstanding.map(doc => {
                                const is_pending_upload = get_documents_by_category(doc.code).length === 0;
                                return (
                                    <button
                                        type="button"
                                        key={doc.code}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs font-medium text-cb-ink transition-colors hover:bg-cb-cream"
                                        onClick={() => {
                                            // The categories live on the Documents tab now.
                                            set_active_tab("documents");
                                            if (!expanded_categories.has(doc.code)) {
                                                toggle_category_expansion(doc.code);
                                            }
                                            // Wait a frame for the tab panel to mount before scrolling.
                                            requestAnimationFrame(() => {
                                                document
                                                    .getElementById(`category-${doc.code}`)
                                                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                                            });
                                        }}
                                    >
                                        <span
                                            aria-hidden
                                            className={clsx(
                                                "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                                                is_pending_upload ? "bg-rose-500" : "bg-amber-500"
                                            )}
                                        />
                                        {doc.label}
                                        <span className="text-cb-ink/40">
                                            {is_pending_upload ? " · missing" : " · awaiting approval"}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
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

    /**
     * Mark a category reviewed from this page.
     *
     * Only reachable for a category holding files that nobody has approved yet
     * — normally one the CLIENT uploaded, since a staff upload approves itself.
     * Until now approving was an advisor-only action on an advisor-only page,
     * so a file sitting at "ready for audit" could not be cleared by the person
     * actually auditing it.
     */
    async function handle_approve_category(doc_type: { code: string; label: string }) {
        set_approving_code(doc_type.code);
        try {
            const result = await approveDocumentCategory(client_id, doc_type.code, active_business_id);
            if (result?.success) {
                toast.success(`${doc_type.label} approved`);
                fetch_client_details();
            } else {
                toast.error((result as any)?.error || 'Failed to approve');
            }
        } catch (err: any) {
            console.error('approve category error:', err);
            toast.error('An unexpected error occurred');
        } finally {
            set_approving_code(null);
        }
    }

    /**
     * Send a category back to the client with a reason.
     *
     * The mirror of handle_approve_category: the reviewer looking at the file
     * is the person who can say what is wrong with it. rejectDocumentCategory
     * owns the client email + in-app notice, so nothing is duplicated here.
     */
    /**
     * Close the reject dialog and drop the category it was aimed at.
     *
     * reject_doc_type used to survive the close, so the NEXT reject that opened
     * before its own setter landed would have been read against the previous
     * category. Nothing may outlive the dialog.
     */
    function close_reject_modal() {
        set_is_reject_modal_open(false);
        set_reject_doc_type(null);
        set_reject_reason("");
    }

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
                active_business_id,
            );

            if (result?.success) {
                toast.success(`${reject_doc_type.label} rejected. The client has been notified.`);
                close_reject_modal();
                fetch_client_details();
            } else {
                toast.error((result as any)?.error || "Failed to reject category");
            }
        } catch (err: any) {
            console.error("reject category error:", err);
            toast.error("An unexpected error occurred");
        } finally {
            set_is_rejecting(false);
        }
    }

    /**
     * Add one or more document types to this file.
     *
     * At the underwriting stage this is nearly always a LENDER STIP: a lender
     * asked for something the file doesn't carry yet, so it needs a slot to be
     * filled — usually by staff, occasionally by the client. Hence "add" is the
     * verb and the client ask is a tick-box, not the other way round.
     */
    async function handle_request_documents() {
        if (selected_request_ids.length === 0) return;
        set_is_requesting_docs(true);
        try {
            const result = await requestDocuments(
                client_id,
                selected_request_ids,
                active_business_id,
                null,
                { notifyClient: also_ask_client },
            );
            if (result?.success) {
                // Record WHY the slot exists. There is no column on
                // client_dynamic_documents for it, and a stip whose reason lives
                // only in someone's memory becomes an unexplained empty slot the
                // next person deletes. An internal note is the surface the team
                // already reads on this page. Non-fatal.
                if (stip_lender) {
                    const labels = selected_request_ids
                        .map(id => all_available_docs.find(d => d.id === id)?.label)
                        .filter(Boolean)
                        .join(", ");
                    try {
                        await addInternalNote(
                            client_id,
                            `Added at ${stip_lender}'s request: ${labels}${also_ask_client ? " (client asked to provide it)" : ""}`,
                            "underwriting",
                        );
                    } catch (note_err) {
                        console.error('stip note failed (non-fatal):', note_err);
                    }
                }

                toast.success(
                    also_ask_client
                        ? "Added and requested from the client"
                        : "Added to the vault — client not notified"
                );
                set_is_request_modal_open(false);
                set_selected_request_ids([]);
                set_request_search("");
                set_also_ask_client(false);
                set_stip_lender("");
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

    // ============================================
    // STAFF UPLOAD HANDLERS (advisor-side duties UW performs on the file)
    // ============================================

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
                    // The API re-checks that the group belongs to this field and
                    // this business, so a stale selection downgrades to
                    // ungrouped rather than failing the upload.
                    document_group_id: upload_group_id,
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
                // Give the file somewhere to show up.
                //
                // The document list on this page renders scoped_required_docs —
                // i.e. only doc codes with an ACTIVE request row. Uploading a
                // type nobody requested therefore stored the file and then hid
                // it: no section, no approval control, invisible in the packet
                // review. Open the slot after the fact, SILENTLY: staff are
                // holding the document, so notifying the client about it would
                // be chasing them for something already in hand.
                const needs_slot = !required_docs.some(r => r.code === doc_code);
                if (needs_slot) {
                    const def = all_available_docs.find(d => d.code === doc_code);
                    if (def) {
                        try {
                            await requestDocuments(client_id, [def.id], active_business_id, null, {
                                notifyClient: false,
                            });
                        } catch (slot_err) {
                            // Non-fatal: the file is stored either way, and the
                            // Request flow can still open the slot by hand.
                            console.error('silent doc-slot creation failed (non-fatal):', slot_err);
                        }
                    }
                }

                // Staff upload = already reviewed. By this phase the advisor or
                // an admin has sent the document over Slack and UW is filing it;
                // the review happened off-screen, and leaving the category at
                // "ready for audit" only asked someone to re-do it — from a
                // page that has no approve control at all.
                //
                // Goes through approveDocumentCategory rather than writing the
                // row here so the outstanding-docs sync and the vault_completed
                // tag stay in their single writer. Non-fatal: the file is
                // stored either way.
                try {
                    await approveDocumentCategory(client_id, doc_code, active_business_id);
                } catch (approve_err) {
                    console.error('auto-approve after staff upload failed (non-fatal):', approve_err);
                }

                toast.success(`${result.uploaded} file(s) uploaded and approved`);
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

    /**
     * Mark a file read the moment the reviewer lands on it in the workbench.
     *
     * The unread dot is the only cue for "nobody has looked at this yet", so it
     * has to clear on selection, not on a modal open. Optimistic: the server
     * write is fire-and-forget because a failed stamp must not block review.
     */
    function mark_document_viewed(document_id: string) {
        const doc = documents.find((d) => d.id === document_id);
        if (!doc || doc.viewed_at) return;
        set_documents(prev =>
            prev.map(d => (d.id === document_id ? { ...d, viewed_at: new Date().toISOString() } : d))
        );
        markDocumentAsViewed(document_id).catch((err) => {
            console.error('markDocumentAsViewed failed (non-fatal):', err);
        });
    }

    /**
     * The Review tab's FIRST file is previewed without anyone clicking it.
     *
     * ReviewWorkbench's fallback auto-selection deliberately fires no callback
     * (it is presentational and the caller may drive selection), so the file it
     * lands on kept its unread dot forever even though a reviewer had it on
     * screen. Mirror the workbench's default here — first file of the first
     * non-approved category, else the first category with files — and stamp
     * whatever the tab is actually showing. The workbench stays untouched.
     */
    const review_visible_file_id = useMemo(() => {
        if (review_selected_file_id) return review_selected_file_id;
        const with_files = scoped_required_docs
            .map((r) => ({ code: r.code, files: scoped_documents.filter((d) => d.category === r.code) }))
            .filter((c) => c.files.length > 0);
        const first_open = with_files.find((c) => !approvals.has(c.code));
        return (first_open ?? with_files[0])?.files[0]?.id ?? null;
    }, [review_selected_file_id, scoped_required_docs, scoped_documents, approvals]);

    useEffect(() => {
        if (active_tab !== "review" || !review_visible_file_id) return;
        // mark_document_viewed already no-ops on an already-viewed doc, so this
        // re-runs harmlessly; only the id and the tab matter as keys.
        mark_document_viewed(review_visible_file_id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active_tab, review_visible_file_id]);

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
     * handle_delete_file: Permanently removes a document (storage + row).
     */
    async function handle_delete_file() {
        if (!file_to_delete) return;

        set_is_deleting_file(true);
        try {
            const res = await deleteClientFile(client_id, file_to_delete.id);
            if (res.success) {
                toast.success("Document deleted");
                set_documents(prev => prev.filter(d => d.id !== file_to_delete.id));
                // Close the preview if it was showing the file we just removed.
                set_preview_modal(prev => (prev.doc?.id === file_to_delete.id ? { isOpen: false, doc: null } : prev));
                set_file_to_delete(null);
            } else {
                toast.error(res.error || "Failed to delete document");
            }
        } catch (err: any) {
            console.error("uw delete file error:", err);
            toast.error("An unexpected error occurred");
        } finally {
            set_is_deleting_file(false);
        }
    }

    if (component_state === ComponentState.LOADING) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="h-12 w-12 text-emerald-500 animate-spin mb-4" />
                <p className="text-sm text-cb-ink/50">Loading review profile…</p>
            </div>
        );
    }

    if (component_state === ComponentState.ERROR) {
        return (
            <div className="max-w-md mx-auto py-20">
                <Card className="rounded-2xl border-rose-100 bg-rose-50 p-8 text-center">
                    <AlertCircle className="h-10 w-10 text-rose-500 mx-auto mb-4" />
                    <h3 className="font-manrope text-lg font-bold text-cb-ink mb-2">Couldn&apos;t open this file</h3>
                    <p className="text-sm text-cb-ink/60 mb-6">{error_message}</p>
                    <Button onClick={() => router.push(queue_path)} variant="outline">Back to queue</Button>
                </Card>
            </div>
        );
    }

    if (!client_profile) return null;

    // Doc completion is computed against the active business tab. Client-scoped
    // docs surface on every tab via the scoped_* memos, so the numbers are
    // consistent across tabs for those rows. Approval-based, same as the
    // workspace file: an uploaded-but-unapproved category is not done.
    const total_required = scoped_required_docs.length;
    const completed_categories = scoped_required_docs.filter(r => approvals.has(r.code)).length;
    const completion_percentage = total_required > 0
        ? Math.round((completed_categories / total_required) * 100)
        : 100;

    // ── Per-business display values ─────────────────────────────────────
    // Non-primary businesses carry their own profile + funding ask (flattened
    // onto the tab row); the primary business falls back to the vault row.
    const active_business = businesses.find((b) => b.id === active_business_id);
    const use_biz = !!active_business && !active_business.is_primary;
    const displayed = {
        capital_requested: use_biz ? (active_business!.capital_requested ?? null) : client_profile.capital_requested,
        avg_monthly_deposits: use_biz ? (active_business!.avg_monthly_deposits ?? null) : client_profile.avg_monthly_deposits,
        business_start_date: use_biz ? (active_business!.business_start_date ?? null) : client_profile.business_start_date,
        legal_entity_type: use_biz ? (active_business!.legal_entity_type ?? null) : client_profile.legal_entity_type,
        industry: active_business?.industry || client_profile.industry,
        proposed_loan_type: use_biz ? (active_business!.proposed_loan_type ?? null) : client_profile.proposed_loan_type,
        loan_purpose: use_biz ? (active_business!.loan_purpose ?? null) : client_profile.loan_purpose,
        employees_count: use_biz ? (active_business!.employees_count ?? null) : (client_profile.employees_count ?? null),
        company_city: use_biz ? (active_business!.company_city ?? null) : client_profile.company_city,
        company_state: use_biz ? (active_business!.company_state ?? null) : client_profile.company_state,
    };

    // Owners live on the vault row (client-level), so they do not rescope per
    // business. Blank slots are dropped rather than rendered as empty rows.
    const owner_facts: { label: string; value: string | null }[] = [
        { name: client_profile.owner_1_name, pct: client_profile.owner_1_ownership_pct },
        { name: client_profile.owner_2_name, pct: client_profile.owner_2_ownership_pct },
        { name: client_profile.owner_3_name, pct: client_profile.owner_3_ownership_pct },
        { name: client_profile.owner_4_name, pct: client_profile.owner_4_ownership_pct },
        { name: client_profile.owner_5_name, pct: client_profile.owner_5_ownership_pct },
    ]
        .filter((o): o is { name: string; pct: number | null } => !!o.name)
        // Label is the slot, not the name: two owners can share a surname and a
        // FactList keys on the label.
        .map((o, i) => ({
            label: `Owner ${i + 1}`,
            value: o.pct === null || o.pct === undefined ? o.name : `${o.name} · ${o.pct}%`,
        }));
    if (owner_facts.length === 0) {
        owner_facts.push({ label: "Owners", value: null });
    }
    owner_facts.unshift({ label: "Number of owners", value: client_profile.number_of_owners || null });

    // ── Status line inputs ──────────────────────────────────────────────
    const last_upload = documents.length > 0
        ? documents.reduce((a, b) => new Date(a.upload_date) > new Date(b.upload_date) ? a : b).upload_date
        : null;
    const upload_baseline = last_upload ?? client_profile.created_at;
    const days_since_last_upload = differenceInDays(new Date(), new Date(upload_baseline));
    // The docs counter is approval-based, so a file where the client has
    // uploaded everything and staff simply hasn't approved yet still reads
    // completion_percentage < 100. Calling that "No uploads" blames the client
    // for our own queue; the ball is on this side of the net.
    const all_required_uploaded = total_required > 0
        && scoped_required_docs.every((r) => scoped_documents.some((d) => d.category === r.code));
    const upload_alert = days_since_last_upload >= 5 && completion_percentage < 100
        ? (all_required_uploaded
            ? `Awaiting review · ${days_since_last_upload}d`
            : last_upload
                ? `No uploads · ${days_since_last_upload}d`
                : `No uploads yet · ${days_since_last_upload}d`)
        : null;

    // ── Header actions (ids with no handler on this surface are skipped) ──
    const actions: HeaderAction[] = capabilities.headerActions.flatMap((id): HeaderAction[] => {
        switch (id) {
            case "notify_advisor":
                return [{ id, label: "Notify advisor", icon: Bell, onClick: () => set_is_notify_modal_open(true) }];
            case "slack": {
                if (!SLACK_FEATURE_ENABLED) return [];
                if (slack_channel.id) {
                    return [{
                        id,
                        render: (className) => (
                            <a
                                href={slack_deep_link(slack_channel.id!, slack_team_id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={className}
                            >
                                <Slack className="h-4 w-4" />
                                Open Slack
                                <ExternalLink className="h-3 w-3 opacity-60" />
                            </a>
                        ),
                    }];
                }
                return [{
                    id,
                    label: "Create channel",
                    icon: Slack,
                    onClick: create_slack_channel,
                    disabled: !is_docs_approved,
                    busy: is_creating_slack_channel,
                    title: !is_docs_approved ? "Available once all documents are approved" : undefined,
                }];
            }
            case "decline":
                // A declined or funded file has nothing left to decline.
                return current_pipeline_status === "declined" || current_pipeline_status === "funded"
                    ? []
                    : [{ id, label: "Decline", onClick: () => handleAdvanceStatus("declined"), tone: "danger" as const }];
            case "funded": {
                // Rescope the funded modal to the active business: the requested
                // amount, the lenders that actually reached submission, and the
                // deal row that receives the funded figures all key off the
                // business currently in view.
                const FUNDED_LABEL: Record<string, string> = {
                    submitted: 'Submitted',
                    approved_by_lender: 'Approved by lender',
                    funded: 'Funded',
                };
                const lender_options = active_round_assignments
                    .filter((a) => ['submitted', 'approved_by_lender', 'funded'].includes(a.status))
                    .map((a) => ({
                        assignmentId: a.id,
                        lenderName: a.lender_name,
                        stateLabel: FUNDED_LABEL[a.status] ?? a.status,
                    }));
                // Already-funded round → the dialog prompts for a new round
                // instead of collecting figures that would overwrite a closed deal.
                const active_round_funded = !!active_business?.active_deal_funded_at;
                const advisor_name = [client_profile.advisor?.first_name, client_profile.advisor?.last_name]
                    .filter(Boolean)
                    .join(" ");
                return [{
                    id,
                    render: (className) => (
                        <LoanFundedDialog
                            clientId={client_id}
                            clientName={client_profile.client_name}
                            businessProfileId={active_business_id}
                            amountRequested={displayed.capital_requested}
                            lenderOptions={lender_options}
                            defaultSalesRep={advisor_name}
                            defaultSlackChannel={slack_channel.name ?? ''}
                            activeRoundFunded={active_round_funded}
                            activeRoundLender={active_round_assignments.find((a) => a.status === 'funded')?.lender_name ?? null}
                            onSuccess={() => { fetch_client_details(); fetch_lender_assignments(); }}
                            triggerClassName={className}
                        />
                    ),
                }];
            }
            default:
                return [];
        }
    });

    const menu: HeaderMenuItem[] = capabilities.menuItems.flatMap((id): HeaderMenuItem[] => {
        switch (id) {
            case "add_doc_type":
                return [{
                    id,
                    label: "Add document type",
                    icon: Plus,
                    onSelect: () => {
                        set_selected_request_ids([]);
                        set_request_search("");
                        set_also_ask_client(false);
                        set_stip_lender("");
                        set_is_request_modal_open(true);
                    },
                }];
            case "upload_for_client":
                return [{ id, label: "Upload for client", icon: UploadCloud, onSelect: () => set_is_doc_upload_open(true) }];
            case "upload_funding_app":
                return [{
                    id,
                    label: "Upload funding app",
                    icon: FileText,
                    onSelect: () => {
                        set_funding_app_file(null);
                        set_is_funding_app_open(true);
                    },
                }];
            case "zip_packet":
                // One file is not a packet — the per-category download covers it.
                return scoped_documents.length <= 1
                    ? []
                    : [{
                        id,
                        label: is_zipping ? `Zipping ${is_zipping.completed}/${is_zipping.total}…` : `Zip packet (${scoped_documents.length} files)`,
                        icon: Download,
                        onSelect: download_entire_packet,
                        disabled: !!is_zipping,
                    }];
            // No "bank_analysis" / "match_tool" cases: both live in LenderPanel's
            // toolbar on the Lenders tab, and underwriting's capabilities row no
            // longer lists them, so a mapping here would be dead code.
            case "archive_slack":
                return SLACK_FEATURE_ENABLED && slack_channel.id
                    ? [{
                        id,
                        label: "Archive Slack channel",
                        icon: Archive,
                        onSelect: () => set_show_archive_slack_confirm(true),
                        busy: is_archiving_slack_channel,
                        destructive: true,
                    }]
                    : [];
            default:
                return [];
        }
    });

    // ── Tiles ───────────────────────────────────────────────────────────
    const tiles: SummaryTile[] = [
        { id: "requested", label: "Requested", value: formatCurrency(displayed.capital_requested) },
        { id: "deposits", label: "Deposits", value: formatMonthly(displayed.avg_monthly_deposits) },
        { id: "fico", label: "FICO", value: formatCreditScore(client_profile.credit_score) },
        { id: "tib", label: "In business", value: formatTimeInBusiness(displayed.business_start_date) },
        {
            id: "docs",
            label: "Docs approved",
            value: `${completed_categories} / ${total_required}`,
            tone: total_required > 0 && completed_categories === total_required ? "positive" : "default",
        },
    ];
    if (capabilities.showLenderTile) {
        // Everything past 'pending' has actually gone out to the lender.
        const submitted_count = active_round_assignments.filter((a) => a.status !== 'pending').length;
        tiles.push({
            id: "lenders",
            label: "Lenders submitted",
            value: `${submitted_count} / ${active_round_assignments.length}`,
        });
    }

    // ── Review tab: required categories mapped to the workbench's shape ──
    const review_categories: ReviewCategory[] = scoped_required_docs.map((doc_type) => {
        const files = get_documents_by_category(doc_type.code);
        const state = approvals.has(doc_type.code)
            ? "approved" as const
            : files.length > 0
                ? "ready_for_review" as const
                : "awaiting_upload" as const;
        return {
            code: doc_type.code,
            label: doc_type.label,
            state,
            file_count: files.length,
            files: files.map((d) => ({
                id: d.id,
                name: d.custom_label || d.name,
                file_name: d.name,
                type: d.type,
                upload_date: d.upload_date,
                uploaded_by_role: d.uploaded_by_role ?? null,
                viewed: !!d.viewed_at,
            })),
        };
    });
    /** The workbench hands back a ReviewFile; the page's handlers want the row. */
    const find_document = (file_id: string) => scoped_documents.find((d) => d.id === file_id) ?? null;

    // ── Tabs ────────────────────────────────────────────────────────────
    const tab_items: FileTabItem[] = [];
    for (const id of capabilities.tabs) {
        if (id === "overview") {
            tab_items.push({
                id,
                label: "Overview",
                content: (
                    <>
                        {render_outstanding_banner(scoped_required_docs)}
                        <PanelCard title="Use of proceeds" bodyClassName="px-5 py-4">
                            {displayed.loan_purpose
                                ? <p className="text-sm leading-relaxed text-cb-ink/80">{displayed.loan_purpose}</p>
                                : <EmptyLine>No use of proceeds on file</EmptyLine>}
                        </PanelCard>
                        <PanelCard title="Ownership & structure" bodyClassName="px-5 py-1.5">
                            <FactList facts={owner_facts} />
                        </PanelCard>
                        <FundingRoundsCard
                            clientId={client_id}
                            businessProfileId={active_business_id}
                            canStartRound={true}
                            onRoundStarted={fetch_client_details}
                        />
                    </>
                ),
            });
        } else if (id === "documents") {
            tab_items.push({
                id,
                label: "Documents",
                badge: total_required > 0 ? `${completed_categories}/${total_required}` : null,
                content: (
                    <>
                        {/* No "Share with lender" here: LenderPanel's toolbar on
                            the Lenders tab owns that dialog. It used to sit above
                            the packet too, which gave one action two homes. */}
                        {/* The packet — required categories, then the miscellaneous
                            block — is one component so phase 3 can mount the same
                            surface on the admin client file. */}
                        <UwDocumentPacket
                            required_docs={scoped_required_docs}
                            documents={scoped_documents}
                            misc_documents={misc_documents}
                            approvals={approvals}
                            expanded_categories={expanded_categories}
                            on_toggle_expand={toggle_category_expansion}
                            document_groups={document_groups}
                            active_business_id={active_business_id}
                            can_upload={can_upload}
                            approving_code={approving_code}
                            on_approve={handle_approve_category}
                            on_reject={(doc_type) => {
                                set_reject_doc_type(doc_type);
                                set_reject_reason("");
                                set_is_reject_modal_open(true);
                            }}
                            requesting_again_code={requesting_again_code}
                            on_request_again={handle_request_again}
                            inline_uploading_code={inline_uploading_code}
                            on_inline_upload={trigger_category_upload}
                            zipping={is_zipping}
                            on_download_all={download_all_documents}
                            on_preview={(doc) => set_preview_modal({ isOpen: true, doc })}
                            on_download={download_document}
                            on_rename={(doc) => set_renaming_file({ id: doc.id, label: doc.custom_label || doc.name })}
                            on_delete={set_file_to_delete}
                            upload_group_id={upload_group_id}
                            on_upload_group_change={set_upload_group_id}
                            on_add_group={add_document_group}
                            selected_document_ids={selected_document_ids}
                            on_toggle_selection={toggle_document_selection}
                            on_toggle_section={toggle_document_section}
                            on_clear_selection={() => set_selected_document_ids(new Set())}
                            assign_target_group_id={assign_target_group_id}
                            on_assign_target_change={set_assign_target_group_id}
                            is_assigning={is_assigning_documents}
                            on_assign={handle_assign_documents}
                            on_edit_group={(group) => {
                                set_group_edit_error(null);
                                set_group_being_edited({
                                    id: group.id,
                                    doc_code: group.doc_code as string,
                                    name: group.name as string,
                                    identifier: (group.identifier as string | null) ?? '',
                                    subtype: (group.subtype as string | null) ?? '',
                                    nickname: (group.nickname as string | null) ?? '',
                                });
                            }}
                            on_delete_group={handle_delete_group}
                        />
                    </>
                ),
            });
        } else if (id === "review") {
            tab_items.push({
                id,
                label: "Review",
                content: (
                    <ReviewWorkbench
                        categories={review_categories}
                        on_select_file={(file) => {
                            set_review_selected_file_id(file.id);
                            mark_document_viewed(file.id);
                        }}
                        on_approve={(category) => handle_approve_category({ code: category.code, label: category.label })}
                        on_reject={(category) => {
                            set_reject_doc_type({ code: category.code, label: category.label });
                            set_reject_reason("");
                            set_is_reject_modal_open(true);
                        }}
                        approving_code={approving_code}
                        on_rename={(file) => {
                            const doc = find_document(file.id);
                            if (doc) set_renaming_file({ id: doc.id, label: doc.custom_label || doc.name });
                        }}
                        on_download={(file) => {
                            const doc = find_document(file.id);
                            if (doc) download_document(doc);
                        }}
                        on_open_full={(file) => {
                            const doc = find_document(file.id);
                            if (doc) set_preview_modal({ isOpen: true, doc });
                        }}
                        can_decide={capabilities.canDecideDocuments}
                    />
                ),
            });
        } else if (id === "lenders") {
            tab_items.push({
                id,
                label: "Lenders",
                badge: active_round_assignments.length > 0 ? active_round_assignments.length : null,
                content: (
                    <>
                        <PanelCard title="Lender matching">
                            <LenderPanel
                                assignments={active_round_assignments}
                                api_summaries={lender_api_summaries}
                                on_api_changed={async () => {
                                    await Promise.all([fetch_lender_assignments(), reload_lender_api()]);
                                }}
                                response_panel_epoch={response_panel_epoch}
                                submitting_assignment_id={submitting_assignment_id}
                                on_mark_submitted={mark_assignment_submitted}
                                on_mark_status={mark_assignment_status}
                                on_resubmit_request={(row) => {
                                    set_resubmit_note("");
                                    set_resubmit_target(row);
                                }}
                                on_open_bank_analysis={() => set_is_bank_analysis_viewer_open(true)}
                                // The admin routes redirect elsewhere, so the admin match-tool
                                // branch this used to carry was dead.
                                on_open_match_tool={() => router.push(`/underwriting/lender-match?client=${client_id}`)}
                                client_id={client_id}
                                business_profile_id={active_business_id}
                                on_lender_added={fetch_lender_assignments}
                            />
                        </PanelCard>
                        <PanelCard title="Open positions (previous debt)">
                            <OpenPositionsPanel positions={open_positions} />
                        </PanelCard>
                    </>
                ),
            });
        } else if (id === "notes") {
            tab_items.push({
                id,
                label: "Notes",
                badge: notes.length > 0 ? notes.length : null,
                content: (
                    <InternalCommunication
                        notes={notes}
                        new_note={new_standalone_note}
                        is_adding={is_adding_note}
                        on_note_change={set_new_standalone_note}
                        on_add_note={handleAddNote}
                    />
                ),
            });
        }
    }

    // ── Rail ────────────────────────────────────────────────────────────
    const latest_note = notes[0]; // fetchInternalNotes orders newest first
    const rail = (
        <>
            <PanelCard title="Business" bodyClassName="px-5 py-1.5">
                <FactList
                    facts={[
                        { label: "Industry", value: displayed.industry || null },
                        { label: "Entity", value: displayed.legal_entity_type || null },
                        { label: "Started", value: displayed.business_start_date ? formatDate(displayed.business_start_date) : null },
                        { label: "Location", value: [displayed.company_city, displayed.company_state].filter(Boolean).join(", ") || null },
                        { label: "Loan type", value: displayed.proposed_loan_type || null },
                        { label: "Employees", value: displayed.employees_count ?? null },
                    ]}
                />
            </PanelCard>

            <PanelCard title="Contact" bodyClassName="space-y-2.5 px-5 py-4">
                <p className="text-sm font-semibold text-cb-ink">{client_profile.client_name}</p>
                <ContactRow icon={Mail} value={client_profile.client_email} href={`mailto:${client_profile.client_email}`} copy_label="Copy email" />
                <ContactRow icon={Phone} value={client_profile.client_phone} href={`tel:${client_profile.client_phone}`} copy_label="Copy phone" />
                <p className="text-xs text-cb-ink/40">Vault created {formatDate(client_profile.created_at)}</p>
            </PanelCard>

            <PanelCard title="Team">
                <div className="px-5 py-4">
                    <FactList
                        facts={[
                            {
                                label: "Advisor",
                                value: [client_profile.advisor.first_name, client_profile.advisor.last_name]
                                    .filter(Boolean).join(" ") || "Unassigned",
                            },
                            { label: "Email", value: client_profile.advisor.email || null },
                        ]}
                    />
                </div>
                {/* No <ClientFollowersCard> here: listClientFollowers goes through
                    assertCanAccessClient, which admits only the assigned advisor, a
                    follower, or an admin. An underwriting user has no `advisors` row,
                    so it throws and this page's error modal opens ("Access denied").
                    Followers are advisor-scoped; admin gets them in phase 3 via the
                    workspace file (/admin/clients/[id]). */}
            </PanelCard>

            {SLACK_FEATURE_ENABLED && (
                <PanelCard title="Slack" bodyClassName="space-y-2 px-5 py-4">
                    {slack_channel.id ? (
                        <a
                            href={slack_deep_link(slack_channel.id, slack_team_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-medium text-cb-ink hover:text-emerald-700"
                        >
                            <Slack className="h-4 w-4 shrink-0 text-cb-ink/40" />
                            <span className="truncate">{slack_channel.name ? `#${slack_channel.name}` : "Open channel"}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                        </a>
                    ) : (
                        <>
                            <EmptyLine>No channel yet</EmptyLine>
                            {!is_docs_approved && (
                                <p className="text-xs text-cb-ink/40">Unlocks once every document is approved</p>
                            )}
                        </>
                    )}
                </PanelCard>
            )}

            <PanelCard
                title="Latest note"
                accessory={
                    <button type="button" onClick={() => set_active_tab("notes")} className="text-xs font-semibold text-emerald-700 hover:underline">
                        All notes
                    </button>
                }
                bodyClassName="px-5 py-3"
            >
                {latest_note ? (
                    <div className="space-y-1">
                        <p className="line-clamp-3 text-sm text-cb-ink/80">{latest_note.content}</p>
                        <p className="text-xs text-cb-ink/40">
                            {latest_note.author_name} · {formatDate(latest_note.created_at)}
                        </p>
                    </div>
                ) : (
                    <EmptyLine action={{ label: "Add one", onClick: () => set_active_tab("notes") }}>No notes yet</EmptyLine>
                )}
            </PanelCard>
        </>
    );

    return (
        <div className="space-y-8">
            {/* The shared client-file shell: header (queue nav, business
                switcher, pipeline, actions), summary tiles, a tabbed work
                column and the context rail. The capability matrix decides
                which tabs, actions and menu items underwriting sees. */}
            <ClientFileShell
                header={
                    <FileHeader
                        back_label="Back to queue"
                        on_back={() => router.push(queue_path)}
                        on_prev={prev_client_id ? () => router.push(`${client_base_path}/${prev_client_id}`) : undefined}
                        on_next={next_client_id ? () => router.push(`${client_base_path}/${next_client_id}`) : undefined}
                        nav_index={current_nav_index >= 0 ? current_nav_index + 1 : undefined}
                        nav_total={navigable_client_ids.length}
                        businesses={businesses}
                        active_business_id={active_business_id}
                        fallback_business_name={client_profile.company_name}
                        on_select_business={set_active_business_id}
                        // Creating and removing businesses lives with advisors;
                        // underwriting only switches between them.
                        identity={[client_profile.client_name, displayed.industry, displayed.legal_entity_type]}
                        status_line={
                            <StatusLine
                                created_at={client_profile.created_at}
                                last_activity_at={last_activity_at}
                                reassigned_to_catch_all_at={client_profile.reassigned_to_catch_all_at}
                                upload_alert={upload_alert}
                            />
                        }
                        current_status={current_pipeline_status}
                        pipeline_history={pipeline_history}
                        on_status_change={handleAdvanceStatus}
                        advance_limit_index={capabilities.stageCeilingIndex}
                        is_advancing={is_advancing_status}
                        actions={actions}
                        primary_id={capabilities.headerActions[capabilities.headerActions.length - 1]}
                        menu={menu}
                    />
                }
                tiles={<SummaryTiles tiles={tiles} />}
                tabs={<FileTabs items={tab_items} active={active_tab} on_change={set_active_tab} />}
                // Review runs full width: the workbench needs the pixels, and the rail's facts are one tab away.
                rail={active_tab === "review" ? null : rail}
            />

            {/* Modals that used to hang off the old header row. */}
            <div>
                <Dialog open={is_notify_modal_open} onOpenChange={set_is_notify_modal_open}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Notify the advisor</DialogTitle>
                            <DialogDescription className="text-slate-500 font-bold">
                                Select which documents are missing or rejected to notify <strong>{client_profile.advisor.first_name} {client_profile.advisor.last_name}</strong>.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-6 space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                            <div className="space-y-3">
                                <p className="text-xs text-cb-ink/50">Missing required items</p>
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
                                <p className="text-xs text-cb-ink/50">Additional documents to request</p>
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
                                <label className="text-xs text-cb-ink/50">Custom message (internal note)</label>
                                <Textarea
                                    placeholder="Add specific instructions for the advisor..."
                                    className="min-h-[100px] rounded-xl"
                                    value={custom_note}
                                    onChange={(e) => set_custom_note(e.target.value)}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => set_is_notify_modal_open(false)} className="rounded-xl">Cancel</Button>
                            <Button
                                onClick={handleNotifyAdvisor}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold"
                                disabled={is_notifying || (selected_missing_docs.length === 0 && selected_extra_docs.length === 0)}
                            >
                                {is_notifying ? "Sending..." : "Send Notification"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Re-submit to a lender that already answered. */}
                <Dialog
                    open={!!resubmit_target}
                    onOpenChange={(open) => { if (!open) set_resubmit_target(null); }}
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Re-submit to {resubmit_target?.lender_name}</DialogTitle>
                            <DialogDescription className="text-slate-500 font-bold">
                                {resubmit_target?.status === 'declined_by_lender'
                                    ? 'This lender declined. Send the file back with what they asked for.'
                                    : 'Send this file back to the lender for another look.'}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs text-cb-ink/50">What changed this round</label>
                                <Textarea
                                    placeholder="New bank statements, corrected application, updated financials…"
                                    className="min-h-[100px] rounded-xl"
                                    value={resubmit_note}
                                    onChange={(e) => set_resubmit_note(e.target.value)}
                                    maxLength={2000}
                                />
                            </div>
                            {/* Say what the button does before it does it. The response is
                                not deleted — it moves to the internal notes — but the panel
                                going blank is surprising if nobody warned you. */}
                            <p className="text-[11px] font-bold text-slate-400 leading-relaxed">
                                The lender&apos;s previous response is filed to this file&apos;s internal notes and
                                the response panel is cleared, so this round is recorded on its own.
                                Screenshots already attached stay put.
                            </p>
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => set_resubmit_target(null)}
                                className="rounded-xl"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={resubmit_assignment}
                                disabled={!!resubmit_target && submitting_assignment_id === resubmit_target.id}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold"
                            >
                                {!!resubmit_target && submitting_assignment_id === resubmit_target.id
                                    ? 'Re-submitting…'
                                    : 'Re-submit'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Inline bank analysis viewer (UW + admin both) */}
            <BankAnalysisViewer
                clientId={client_id}
                isOpen={is_bank_analysis_viewer_open}
                onClose={() => set_is_bank_analysis_viewer_open(false)}
            />

            {/* Manual Funding Application Upload (admin + UW) */}
            {can_upload && (
                <Dialog
                    open={is_funding_app_open}
                    onOpenChange={(open) => { if (!is_uploading_funding_app) { set_is_funding_app_open(open); if (!open) set_funding_app_for_lenders(false); } }}
                >
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Upload funding application</DialogTitle>
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
                                    <span className="font-semibold text-cb-ink">For lenders (omit agreement page)</span>
                                    <br />
                                    Upload the lender-facing copy without the agreement page — no deal-complete, GHL, or document-request triggers.
                                </span>
                            </label>
                            <div className="space-y-2">
                                <Label htmlFor="funding_app_file" className="text-xs text-cb-ink/50">
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
                            <DialogTitle>Add a document type</DialogTitle>
                            <DialogDescription>
                                {also_ask_client
                                    ? "Opens the slot on the vault AND asks the client for it — email, SMS and reminders."
                                    : "Opens the slot on the vault so it can be filled. The client is not notified."}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-2 space-y-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-cb-ink/50">
                                    Requested by (optional)
                                </Label>
                                <select
                                    value={stip_lender}
                                    onChange={(e) => set_stip_lender(e.target.value)}
                                    className="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm font-medium bg-white"
                                >
                                    <option value="">Not a lender stip</option>
                                    {active_round_assignments.map((a) => (
                                        <option key={a.id} value={a.lender_name}>{a.lender_name}</option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-slate-400">
                                    Recorded as an internal note, so the slot&apos;s reason survives.
                                </p>
                            </div>
                            <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
                                <Checkbox
                                    checked={also_ask_client}
                                    onCheckedChange={(c) => set_also_ask_client(c === true)}
                                    className="mt-0.5"
                                />
                                <span className="text-xs text-slate-600">
                                    <span className="font-semibold text-cb-ink">Also ask the client for it</span>
                                    <br />
                                    Tick only if the CLIENT has to supply this one. Off, nothing is sent and any approval already on the file stays put.
                                </span>
                            </label>
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
                                {is_requesting_docs
                                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{also_ask_client ? "Requesting…" : "Adding…"}</>
                                    : also_ask_client
                                        ? <><Send className="h-4 w-4 mr-2" />Add &amp; request {selected_request_ids.length > 0 ? `(${selected_request_ids.length})` : ""}</>
                                        : <><Plus className="h-4 w-4 mr-2" />Add {selected_request_ids.length > 0 ? `(${selected_request_ids.length})` : ""}</>}
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
                            <DialogTitle>Upload a document for the client</DialogTitle>
                            <DialogDescription>
                                Choose the document type and attach the file(s). The upload is recorded as advisor-uploaded.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            <div className="space-y-2">
                                <Label className="text-xs text-cb-ink/50">Document type</Label>
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
                                <Label htmlFor="doc_upload_files" className="text-xs text-cb-ink/50">File(s)</Label>
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

            <AlertDialog
                open={show_archive_slack_confirm}
                onOpenChange={set_show_archive_slack_confirm}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Archive this Slack channel?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {slack_channel.name && (
                                <>
                                    <span className="font-semibold text-slate-700">#{slack_channel.name}</span>{" "}
                                </>
                            )}
                            will stop receiving deal updates and will be unlinked from this file.
                            The channel history stays in Slack, and a new channel can be created
                            for this deal afterwards.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={archive_slack_channel}
                            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                        >
                            Archive channel
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Document Preview Modal */}
            <DocumentPreviewModal
                isOpen={preview_modal.isOpen}
                onClose={() => set_preview_modal({ isOpen: false, doc: null })}
                docName={preview_modal.doc?.custom_label || preview_modal.doc?.name || ""}
                fileName={preview_modal.doc?.name}
                documentId={preview_modal.doc?.id || ""}
                fileType={preview_modal.doc?.type}
                onRename={preview_modal.doc ? () => set_renaming_file({
                    id: preview_modal.doc!.id,
                    label: preview_modal.doc!.custom_label || preview_modal.doc!.name,
                }) : undefined}
            />

            {/* Delete Document Confirmation */}
            <Dialog
                open={!!file_to_delete}
                onOpenChange={(open) => { if (!open && !is_deleting_file) set_file_to_delete(null); }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Delete this document?</DialogTitle>
                        <DialogDescription>
                            <strong>{file_to_delete?.custom_label || file_to_delete?.name}</strong> will be
                            permanently removed from the client&apos;s vault — for the client and the advisor
                            too. This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => set_file_to_delete(null)}
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

            {/* Edit a document group.
                Every label and every input in here comes from the FIELD's
                config, so this one dialog edits a bank account, a tax year and
                a person without knowing what any of them are. */}
            <Dialog
                open={!!group_being_edited}
                onOpenChange={(open) => { if (!open && !is_saving_group) set_group_being_edited(null); }}
            >
                <DialogContent className="sm:max-w-md">
                    {(() => {
                        const edit_config = getGroupConfig(group_being_edited?.doc_code);
                        return (
                            <>
                                <DialogHeader>
                                    <DialogTitle>Edit {edit_config.noun.toLowerCase()}</DialogTitle>
                                    <DialogDescription>
                                        Correcting the {edit_config.nameLabel.toLowerCase()}
                                        {edit_config.identifier ? ` or the ${edit_config.identifier.label.toLowerCase()}` : ''} also
                                        renames every file filed under it, so the fix reaches the download name
                                        and the lender packet.
                                    </DialogDescription>
                                </DialogHeader>

                                {group_being_edited && (
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 py-2">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs text-cb-ink/50">
                                                {edit_config.nameLabel}
                                            </Label>
                                            <Input
                                                value={group_being_edited.name}
                                                onChange={(e) => set_group_being_edited(prev =>
                                                    prev ? { ...prev, name: e.target.value } : prev
                                                )}
                                                placeholder={edit_config.namePlaceholder}
                                            />
                                        </div>

                                        {edit_config.identifier && (
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-cb-ink/50">
                                                    {edit_config.identifier.label}
                                                </Label>
                                                <Input
                                                    value={group_being_edited.identifier}
                                                    inputMode={edit_config.identifier.digitsOnly ? 'numeric' : undefined}
                                                    // Digits-only fields cannot hold a full
                                                    // account number even on a paste.
                                                    onChange={(e) => set_group_being_edited(prev => {
                                                        if (!prev) return prev;
                                                        const cfg = edit_config.identifier!;
                                                        const cleaned = cfg.digitsOnly
                                                            ? e.target.value.replace(/\D/g, '')
                                                            : e.target.value;
                                                        return {
                                                            ...prev,
                                                            identifier: cfg.maxLength ? cleaned.slice(0, cfg.maxLength) : cleaned,
                                                        };
                                                    })}
                                                    placeholder={edit_config.identifier.placeholder}
                                                />
                                            </div>
                                        )}

                                        {edit_config.subtypes && (
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-cb-ink/50">
                                                    {edit_config.subtypeLabel ?? 'Type'}
                                                </Label>
                                                <select
                                                    value={group_being_edited.subtype}
                                                    onChange={(e) => set_group_being_edited(prev =>
                                                        prev ? { ...prev, subtype: e.target.value } : prev
                                                    )}
                                                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                                                >
                                                    {/* A group created before this field had a
                                                        subtype list carries none — the blank
                                                        option keeps that state selectable
                                                        instead of silently retyping it. */}
                                                    <option value="">—</option>
                                                    {edit_config.subtypes.map((s) => (
                                                        <option key={s.value} value={s.value}>{s.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {edit_config.nicknameLabel && (
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-cb-ink/50">
                                                    {edit_config.nicknameLabel}
                                                </Label>
                                                <Input
                                                    value={group_being_edited.nickname}
                                                    onChange={(e) => set_group_being_edited(prev =>
                                                        prev ? { ...prev, nickname: e.target.value } : prev
                                                    )}
                                                    placeholder={edit_config.nicknamePlaceholder ?? 'Optional'}
                                                />
                                            </div>
                                        )}

                                        {group_edit_error && (
                                            <p className="sm:col-span-2 text-xs font-semibold text-rose-600">
                                                {group_edit_error}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </>
                        );
                    })()}

                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => set_group_being_edited(null)}
                            disabled={is_saving_group}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handle_save_group}
                            disabled={is_saving_group}
                            className="bg-slate-900 hover:bg-slate-800 text-white"
                        >
                            {is_saving_group ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Saving...
                                </>
                            ) : 'Save changes'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Group Confirmation.
                Opened only after the API answered 409 — document_count is the
                server's number, not a client-side guess. The wording leads with
                what does NOT happen, because "delete" next to a list of files
                reads as "delete the files". */}
            <Dialog
                open={!!group_pending_delete}
                onOpenChange={(open) => { if (!open && !is_deleting_group) set_group_pending_delete(null); }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Delete this group?</DialogTitle>
                        <DialogDescription>
                            <strong>{group_pending_delete?.label}</strong> will be removed. Its{' '}
                            <strong>{group_pending_delete?.document_count} file(s) are
                            not deleted</strong> — they move back to <strong>Ungrouped</strong>, where
                            you can file them somewhere else.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => set_group_pending_delete(null)}
                            disabled={is_deleting_group}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => {
                                if (!group_pending_delete) return;
                                handle_delete_group(
                                    group_pending_delete.id,
                                    group_pending_delete.label,
                                    true
                                );
                            }}
                            disabled={is_deleting_group}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {is_deleting_group ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                <>
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete account, keep files
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rename Document Dialog */}
            <Dialog open={!!renaming_file} onOpenChange={(open) => !open && set_renaming_file(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Rename document</DialogTitle>
                        <DialogDescription>
                            Enter a new display name for this document. This will be visible to the advisor and client as well.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="new-name" className="text-xs text-cb-ink/50">Display name</Label>
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

            {/* Reject a document category — opened from the packet and from the
                Review tab's decision panel. The reason is mandatory: it is what
                the client receives, so "rejected" with no explanation would send
                them back to the same upload. */}
            <Dialog
                open={is_reject_modal_open}
                onOpenChange={(open) => {
                    if (is_rejecting) return;
                    if (open) set_is_reject_modal_open(true);
                    else close_reject_modal();
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Reject {reject_label_ref.current}?</DialogTitle>
                        <DialogDescription>
                            Say what is wrong with it. The client gets this reason by email and in
                            their vault, and the category reopens for a new upload.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-2 space-y-2">
                        <Label htmlFor="reject-reason" className="text-xs text-cb-ink/50">Reason</Label>
                        <Textarea
                            id="reject-reason"
                            placeholder="e.g. Needs the full 6 months, or the scan is unreadable."
                            value={reject_reason}
                            onChange={(e) => set_reject_reason(e.target.value)}
                            className="min-h-[120px] rounded-xl"
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={close_reject_modal}
                            disabled={is_rejecting}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handle_reject_category}
                            disabled={is_rejecting || !reject_reason.trim()}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {is_rejecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Reject category
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
