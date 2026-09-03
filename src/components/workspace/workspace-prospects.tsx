// src/components/workspace/workspace-prospects.tsx
//
// Rendered by three portals, differing only in `basePath`:
//   /advisor/dashboard   staff advisors
//   /admin               admins (adds the per-advisor filter)
//   /partner             external partner advisors working their own deals
//
// The owner ∪ follower scoping below is convenience, not the security boundary —
// RLS enforces the same bound independently through is_assigned_advisor_for().
"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { canUseAdvisorWorkspace } from "@/lib/auth/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import clsx from "clsx";
import { getBulkLatestStatus, updateLoanStatus, type LoanStatus } from "@/app/actions/pipeline";
import { getBulkClientActivity } from "@/app/actions/advisor";
import { LoanPipelineBadge } from "@/components/loan-pipeline-status";
import { ActivityAgeBadge } from "@/components/advisor/activity-age-badge";
import { differenceInDays } from "date-fns";
import { normalizeSupabaseJoin } from "@/lib/document-scope";

function format_currency(amount: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

/**
 * ============================================================================
 * PROSPECTS LIST PAGE
 * ----------------------------------------------------------------------------
 * Shows every non-funded file (active pipeline + declined archive). Anything
 * with pipeline_status === "funded" graduates to the Clients book and is
 * surfaced on /advisor/dashboard/clients (or /admin/clients) instead.
 * ============================================================================
 */

enum ComponentState {
    LOADING = "LOADING",
    ERROR = "ERROR",
    SUCCESS = "SUCCESS",
    NO_CLIENTS = "NO_CLIENTS",
}

interface ClientInfo {
    id: string;
    user_id: string;
    advisor_id?: string | null;
    client_name: string;
    client_email: string;
    client_phone: string;
    company_name: string;
    capital_requested: number;
    created_at: string;
    reassigned_to_catch_all_at?: string | null;
    /** Mirrored referral-partner name from client_data_vault (attribution, not ownership). */
    referral_partner?: string | null;
    document_count: number;
    total_required_docs: number;
    pipeline_status?: LoanStatus;
    submission_status?: string;
    last_activity_at?: string;
    inactivity_days?: number;
}

export function WorkspaceProspects({ basePath }: { basePath: string }) {
    const supabase = createClient();
    const router = useRouter();
    const isAdminContext = basePath.startsWith("/admin");

    const [component_state, set_component_state] = useState<ComponentState>(
        ComponentState.LOADING
    );
    const [clients, set_clients] = useState<ClientInfo[]>([]);
    const [search_query, set_search_query] = useState<string>("");
    const [error_message, set_error_message] = useState<string>("");
    const [active_tab, set_active_tab] = useState<"active" | "finalized">("active");
    const [user_role, set_user_role] = useState<string>("");
    const [my_advisor_id, set_my_advisor_id] = useState<string | null>(null);
    // Admin-only advisor filter. "all" = every advisor, "mine" = the admin's own
    // book, or a specific advisor id. Drives scoped_clients below.
    const [advisors, set_advisors] = useState<{ id: string; name: string }[]>([]);
    const [selected_advisor_id, set_selected_advisor_id] = useState<string>("all");
    // Admin-only referral-partner filter on the vault's attribution name.
    // Separate axis from the advisor: partner advisors are excluded from the
    // advisor list on purpose, and partner-referred deals are usually worked by
    // internal staff. "all", "any", "none", or an exact partner name.
    const [selected_partner, set_selected_partner] = useState<string>("all");

    useEffect(() => {
        fetch_prospects();

        const handleSearch = () => {
            const params = new URLSearchParams(window.location.search);
            set_search_query(params.get('q') || "");
        };
        handleSearch();
        window.addEventListener('search_updated', handleSearch);
        return () => window.removeEventListener('search_updated', handleSearch);
    }, []);

    const partner_options = useMemo(() => {
        const names = new Set<string>();
        clients.forEach(c => {
            const name = (c.referral_partner || "").trim();
            if (name) names.add(name);
        });
        return Array.from(names).sort((a, b) => a.localeCompare(b));
    }, [clients]);

    const scoped_clients = useMemo(() => {
        if (user_role !== "admin") return clients;
        let out = clients;
        if (selected_advisor_id === "mine") {
            out = my_advisor_id ? out.filter(c => c.advisor_id === my_advisor_id) : [];
        } else if (selected_advisor_id !== "all") {
            out = out.filter(c => c.advisor_id === selected_advisor_id);
        }
        if (selected_partner === "any") {
            out = out.filter(c => !!(c.referral_partner || "").trim());
        } else if (selected_partner === "none") {
            out = out.filter(c => !(c.referral_partner || "").trim());
        } else if (selected_partner !== "all") {
            out = out.filter(c => (c.referral_partner || "").trim() === selected_partner);
        }
        return out;
    }, [clients, user_role, selected_advisor_id, selected_partner, my_advisor_id]);

    const filtered_clients = useMemo(() => {
        if (search_query.trim() === "") return scoped_clients;
        const query_lower = search_query.toLowerCase();
        return scoped_clients.filter(client =>
            client.client_name.toLowerCase().includes(query_lower) ||
            client.client_email.toLowerCase().includes(query_lower) ||
            client.company_name.toLowerCase().includes(query_lower)
        );
    }, [search_query, scoped_clients]);

    const active_pending_clients = useMemo(() =>
        filtered_clients.filter(c =>
            ["created", "onboarding", "documents_requested", "documents_received"].includes(c.pipeline_status || "created") &&
            (c.inactivity_days || 0) < 14 &&
            c.pipeline_status !== "under_review" &&
            c.submission_status !== "locked" &&
            c.submission_status !== "submitted"
        ), [filtered_clients]);

    const under_review_clients = useMemo(() =>
        filtered_clients.filter(c =>
            !["funded", "declined"].includes(c.pipeline_status || "") &&
            (["under_review", "lender_matched"].includes(c.pipeline_status || "") ||
            ["locked", "submitted"].includes(c.submission_status || ""))
        ), [filtered_clients]);

    const inactive_clients = useMemo(() =>
        filtered_clients.filter(c =>
            !["funded", "declined", "under_review", "lender_matched"].includes(c.pipeline_status || "") &&
            (c.inactivity_days || 0) >= 14
        ), [filtered_clients]);

    const declined_clients = useMemo(() =>
        filtered_clients.filter(c => c.pipeline_status === "declined"),
        [filtered_clients]);

    async function fetch_prospects() {
        try {
            set_component_state(ComponentState.LOADING);
            const { data: { user }, error: auth_error } = await supabase.auth.getUser();

            if (auth_error || !user) {
                set_error_message("Authentication failed. Please log in again.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            // Role lookup and the caller's advisor row both key on user.id and
            // are independent — fetch them together instead of in sequence.
            const [
                { data: user_data, error: user_error },
                { data: my_advisor },
            ] = await Promise.all([
                supabase.from("users").select("id, role, email").eq("id", user.id).maybeSingle(),
                supabase.from('advisors').select('id').eq('user_id', user.id).maybeSingle(),
            ]);

            if (user_error || !user_data || !canUseAdvisorWorkspace(user_data.role)) {
                set_error_message("Access denied. You must be an advisor or admin to view this page.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            set_user_role(user_data.role);
            if (my_advisor?.id) set_my_advisor_id(my_advisor.id);

            // Admins get the full advisor roster for the per-advisor filter.
            if (user_data.role === 'admin') {
                // Internal staff only — external partner advisors are not part
                // of the roster this filter is for. Note there is deliberately
                // no is_active filter here (inactive advisors still own historic
                // files worth filtering by), so referral_partner_id is the only
                // thing keeping partners out.
                const { data: advisorRows } = await supabase
                    .from('advisors')
                    .select('id, first_name, last_name')
                    .is('referral_partner_id', null)
                    .order('first_name', { ascending: true });
                set_advisors(
                    (advisorRows || []).map((a: any) => ({
                        id: a.id,
                        name: `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || 'Unnamed advisor',
                    }))
                );
            }

            // Admins see all; advisors see owned + followed.
            let accessibleIds: string[] | null = null;

            if (user_data.role !== 'admin') {
                if (!my_advisor?.id) {
                    set_error_message('Could not load advisor profile.');
                    set_component_state(ComponentState.ERROR);
                    return;
                }

                const [{ data: owned }, { data: followed }] = await Promise.all([
                    supabase.from('client_data_vault').select('id').eq('advisor_id', my_advisor.id),
                    supabase.from('client_followers').select('client_vault_id').eq('advisor_id', my_advisor.id),
                ]);

                const idSet = new Set<string>();
                owned?.forEach(r => idSet.add(r.id));
                followed?.forEach((r: any) => idSet.add(r.client_vault_id));
                accessibleIds = Array.from(idSet);
            }

            let clientsQuery = supabase
                .from('client_data_vault')
                .select('id, user_id, advisor_id, client_name, client_email, client_phone, company_name, capital_requested, created_at, reassigned_to_catch_all_at, referral_partner')
                .order('created_at', { ascending: false });

            if (accessibleIds !== null) {
                if (accessibleIds.length === 0) {
                    set_component_state(ComponentState.NO_CLIENTS);
                    return;
                }
                clientsQuery = clientsQuery.in('id', accessibleIds);
            }

            const { data: clients_data, error: clients_error } = await clientsQuery;

            if (clients_error) {
                set_error_message("Error loading prospects.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            if (!clients_data || clients_data.length === 0) {
                set_component_state(ComponentState.NO_CLIENTS);
                return;
            }

            // Doc counts in 3 bulk queries instead of 2-per-prospect. The old
            // per-client fan-out was the main load-time bottleneck (~240
            // round-trips for 120 prospects, which also saturated the connection
            // pool). We fetch core requirements once, every prospect's active
            // dynamic docs once, and every uploaded doc once, then group in
            // memory by user_id.
            const userIds = clients_data.map(c => c.user_id);
            const vaultIds = clients_data.map(c => c.id);

            // One parallel batch instead of sequential phases: the 3 doc-count
            // queries + pipeline status + submissions + activity all depend only
            // on the id lists above, so there's no reason to await them in turn.
            const [
                { data: coreDocs },
                { data: allDynamicDocs },
                { data: allUploadedDocs },
                pipelineMap,
                { data: sub_data },
                activityMap,
            ] = await Promise.all([
                supabase.from("required_documents").select("code").eq("is_core", true),
                supabase
                    .from("client_dynamic_documents")
                    .select("user_id, required_documents (code)")
                    .in("user_id", userIds)
                    .eq("is_active", true),
                supabase
                    .from("user_documents")
                    .select("user_id, category, doc_code")
                    .in("user_id", userIds),
                getBulkLatestStatus(vaultIds),
                supabase.from("submissions").select("user_id, status").in("user_id", userIds),
                getBulkClientActivity(vaultIds),
            ]);
            const submissionMap = new Map(sub_data?.map(s => [s.user_id, s.status]) || []);

            const coreCodes = coreDocs?.map(d => d.code) || [];

            // user_id -> set of required dynamic codes. normalizeSupabaseJoin
            // handles SDK array-vs-object embed variance; without it the
            // dynamic-doc counter reads zero for every prospect.
            const dynamicByUser = new Map<string, Set<string>>();
            for (const row of (allDynamicDocs as any[] | null) || []) {
                const code = normalizeSupabaseJoin<{ code?: string }>(row.required_documents)?.code;
                if (!code) continue;
                if (!dynamicByUser.has(row.user_id)) dynamicByUser.set(row.user_id, new Set());
                dynamicByUser.get(row.user_id)!.add(code);
            }

            // user_id -> set of uploaded codes (category + doc_code).
            const uploadedByUser = new Map<string, Set<string>>();
            for (const row of (allUploadedDocs as any[] | null) || []) {
                if (!uploadedByUser.has(row.user_id)) uploadedByUser.set(row.user_id, new Set());
                const set = uploadedByUser.get(row.user_id)!;
                if (row.category) set.add(row.category);
                if (row.doc_code) set.add(row.doc_code);
            }

            const clients_with_doc_counts = clients_data.map((client) => {
                const allRequiredCodes = new Set([...coreCodes, ...(dynamicByUser.get(client.user_id) || [])]);
                const uploadedCodes = uploadedByUser.get(client.user_id) || new Set<string>();
                const satisfied = Array.from(allRequiredCodes).filter(code => uploadedCodes.has(code)).length;
                return {
                    ...client,
                    document_count: satisfied,
                    total_required_docs: allRequiredCodes.size,
                };
            }) as ClientInfo[];

            if (vaultIds.length > 0) {
                const now = new Date();
                const updated_clients = [...clients_with_doc_counts];
                const declineOps: Promise<unknown>[] = [];

                for (const client of updated_clients) {
                    client.pipeline_status = pipelineMap.get(client.id) ?? "created";
                    client.submission_status = submissionMap.get(client.user_id);
                    const lastActivity = activityMap.get(client.id) || client.created_at;
                    client.last_activity_at = lastActivity;

                    const activityDate = new Date(lastActivity);
                    const daysInactive = differenceInDays(now, activityDate);
                    client.inactivity_days = daysInactive;

                    const isExempt = ["funded", "under_review"].includes(client.pipeline_status);
                    if (daysInactive >= 30 && !isExempt && client.pipeline_status !== "declined") {
                        // Reflect the decline locally now so the filters are
                        // correct, but persist in parallel after the loop instead
                        // of blocking the first paint on a sequential await chain.
                        client.pipeline_status = "declined";
                        declineOps.push(
                            updateLoanStatus(
                                client.id,
                                "declined",
                                `System: Auto-declined due to ${daysInactive} days of inactivity.`
                            )
                        );
                    }
                }

                if (declineOps.length > 0) {
                    void Promise.all(declineOps).catch(e =>
                        console.error("Auto-decline batch failed:", e)
                    );
                }

                // Drop funded files — those belong to the Clients book, not Prospects.
                const non_funded = updated_clients.filter(c => c.pipeline_status !== "funded");
                set_clients(non_funded);
            } else {
                set_clients(clients_with_doc_counts);
            }

            set_component_state(ComponentState.SUCCESS);

        } catch (err: any) {
            set_error_message("An unexpected error occurred.");
            set_component_state(ComponentState.ERROR);
        }
    }

    function format_date(iso_string: string): string {
        const date = new Date(iso_string);
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    const detail_base = `${basePath}/clients/`;
    const new_href = `${basePath}/clients/new`;

    if (component_state === ComponentState.LOADING) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <span className="material-symbols-outlined text-5xl text-emerald-500 animate-spin mb-4">progress_activity</span>
                <p className="text-slate-400 font-manrope font-bold">Assembling your prospect book...</p>
            </div>
        );
    }

    if (component_state === ComponentState.ERROR) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <span className="material-symbols-outlined text-5xl text-red-500 mb-4">error</span>
                <h3 className="text-xl font-bold mb-2">Error Loading Prospects</h3>
                <p className="text-slate-400 mb-6">{error_message}</p>
                <Button onClick={fetch_prospects}>Try Again</Button>
            </div>
        );
    }

    if (component_state === ComponentState.NO_CLIENTS) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <h3 className="text-2xl font-black mb-4 uppercase tracking-tighter">No Prospects Found</h3>
                <Button onClick={() => router.push(new_href)}>Create Your First Prospect</Button>
            </div>
        );
    }

    return (
        <section className="p-0 md:p-8 space-y-8 animate-in fade-in duration-500 font-manrope">
            {/* Header Section */}
            <div className="flex justify-between items-end flex-wrap gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">Prospect Portfolio</h1>
                    <p className="text-on-surface-variant font-medium mt-1">
                        Tracking {scoped_clients.length} prospects.
                        {inactive_clients.length > 0 && <span className="text-tertiary-fixed-dim ml-2 font-bold">{inactive_clients.length} inactive items at bottom.</span>}
                    </p>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                    {/* Admin advisor filter — pick All, the admin's own book, or
                        any specific advisor. */}
                    {user_role === "admin" && (
                        <div className="relative">
                            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline text-base">
                                badge
                            </span>
                            <select
                                value={selected_advisor_id}
                                onChange={(e) => set_selected_advisor_id(e.target.value)}
                                className="bg-surface-container-low border border-outline-variant/30 rounded-xl pl-10 pr-4 py-2.5 text-xs font-bold text-on-surface shadow-inner cursor-pointer hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                            >
                                <option value="all">All Advisors</option>
                                {my_advisor_id && <option value="mine">My Prospects</option>}
                                {advisors.map((a) => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Admin referral-partner filter — attribution, not ownership. */}
                    {user_role === "admin" && (
                        <div className="relative">
                            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline text-base">
                                handshake
                            </span>
                            <select
                                value={selected_partner}
                                onChange={(e) => set_selected_partner(e.target.value)}
                                className="bg-surface-container-low border border-outline-variant/30 rounded-xl pl-10 pr-4 py-2.5 text-xs font-bold text-on-surface shadow-inner cursor-pointer hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                            >
                                <option value="all">All Partners</option>
                                <option value="any">Any Referral Partner</option>
                                <option value="none">No Referral Partner</option>
                                {partner_options.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Tab Switcher */}
                    <div className="bg-surface-container-low p-1 rounded-xl border border-outline-variant/30 flex shadow-inner">
                        <button
                            onClick={() => set_active_tab("active")}
                            className={clsx(
                                "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                                active_tab === "active" ? "bg-white text-primary shadow-sm" : "text-outline hover:text-on-surface"
                            )}
                        >
                            Active Pipeline
                        </button>
                        <button
                            onClick={() => set_active_tab("finalized")}
                            className={clsx(
                                "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                                active_tab === "finalized" ? "bg-white text-primary shadow-sm" : "text-outline hover:text-on-surface"
                            )}
                        >
                            Declined (Archive)
                        </button>
                    </div>

                    <Button
                        onClick={() => router.push(`${new_href}/speed`)}
                        variant="outline"
                        className="border-2 border-primary text-primary px-6 py-6 rounded-xl font-bold flex items-center gap-2 hover:bg-primary/5 active:scale-95 transition-all"
                    >
                        <span className="material-symbols-outlined">bolt</span>
                        Speed Form
                    </Button>

                    <Button
                        onClick={() => router.push(new_href)}
                        className="bg-primary text-white px-6 py-6 rounded-xl font-bold flex items-center gap-2 hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-primary/20"
                    >
                        <span className="material-symbols-outlined">person_add</span>
                        New Prospect
                    </Button>
                </div>
            </div>

            {active_tab === "active" ? (
                <div className="space-y-12">
                    <div className="grid grid-cols-12 gap-8">

                        {/* Left Column: Action Required */}
                        <div className="col-span-12 lg:col-span-7 space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="font-headline text-lg font-bold flex items-center gap-2 text-on-surface">
                                    <span className="material-symbols-outlined text-tertiary-fixed-dim" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                                    Pending & Action Required
                                </h3>
                                {active_pending_clients.length > 0 && (
                                    <div className="h-6 w-6 rounded-full bg-error-container text-on-error-container flex items-center justify-center text-[10px] font-bold">
                                        {active_pending_clients.length}
                                    </div>
                                )}
                            </div>

                            <div className="max-h-[70vh] overflow-y-auto premium-scrollbar pr-4 -mr-4">
                                <div className="space-y-4 pr-4">
                                    {active_pending_clients.length === 0 ? (
                                        <div className="p-12 text-center bg-surface-container-low rounded-xl border border-dashed border-outline-variant">
                                            <p className="text-outline text-sm font-medium">All clear! No pending actions.</p>
                                        </div>
                                    ) : (
                                        active_pending_clients.map(client => (
                                            <div
                                                key={client.id}
                                                onClick={() => router.push(detail_base + client.id)}
                                                className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/30 relative overflow-hidden group cursor-pointer hover:shadow-lg transition-all"
                                            >
                                                <div className="absolute top-0 right-0 h-full w-1 bg-tertiary-fixed-dim"></div>
                                                <div className="flex justify-between items-start">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-on-tertiary-fixed-variant bg-tertiary-fixed px-2 py-0.5 rounded">
                                                                {client.document_count === client.total_required_docs ? "Ready for Review" : "Incomplete Docs"}
                                                            </span>
                                                            <div className="text-[10px] font-bold text-error uppercase tracking-tighter animate-pulse">Action Required</div>
                                                            <ActivityAgeBadge created_at={client.created_at} last_activity_at={client.last_activity_at} reassigned_to_catch_all_at={client.reassigned_to_catch_all_at} />
                                                        </div>

                                                        <h4 className="font-bold text-on-surface">{client.client_name}</h4>
                                                        <p className="text-xs text-on-surface-variant mt-1">{client.company_name}</p>

                                                        <div className="mt-4 grid grid-cols-2 gap-4">
                                                            <div className="space-y-2">
                                                                <p className="text-[10px] font-black uppercase tracking-widest text-outline">Contact</p>
                                                                <div className="space-y-1">
                                                                    <a href={`mailto:${client.client_email}`} onClick={(e) => e.stopPropagation()} className="text-[11px] font-bold text-on-surface hover:text-primary flex items-center gap-2 truncate">
                                                                        <span className="material-symbols-outlined text-xs">mail</span>
                                                                        {client.client_email}
                                                                    </a>
                                                                    <a href={`tel:${client.client_phone}`} onClick={(e) => e.stopPropagation()} className="text-[11px] font-bold text-on-surface hover:text-primary flex items-center gap-2">
                                                                        <span className="material-symbols-outlined text-xs">phone</span>
                                                                        {client.client_phone}
                                                                    </a>
                                                                </div>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <p className="text-[10px] font-black uppercase tracking-widest text-outline">Requested</p>
                                                                <p className="text-lg font-black text-on-surface">{format_currency(client.capital_requested)}</p>
                                                            </div>
                                                        </div>

                                                        {client.pipeline_status && (
                                                            <div className="mt-4 pt-4 border-t border-outline-variant/30">
                                                                <LoanPipelineBadge currentStatus={client.pipeline_status} className="scale-90 origin-left" />
                                                            </div>
                                                        )}

                                                        <div className="mt-4 space-y-2">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-black uppercase tracking-widest text-outline">Documents</span>
                                                                <span className="text-[10px] font-bold text-outline">
                                                                    {client.document_count}/{client.total_required_docs}
                                                                </span>
                                                            </div>
                                                            <div className="w-full bg-surface-container-highest rounded-full h-1.5 overflow-hidden">
                                                                <div
                                                                    className="h-full bg-primary transition-all duration-1000"
                                                                    style={{ width: `${(client.document_count / (client.total_required_docs || 1)) * 100}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="ml-4 flex flex-col items-center">
                                                        <span className="material-symbols-outlined text-tertiary-fixed-dim opacity-50 group-hover:opacity-100 transition-opacity">pending_actions</span>
                                                        <span className="material-symbols-outlined text-outline group-hover:text-primary transition-all mt-auto">chevron_right</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Under Review */}
                        <div className="col-span-12 lg:col-span-5 space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="font-headline text-lg font-bold flex items-center gap-2 text-on-primary-fixed-variant">
                                    <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>supervised_user_circle</span>
                                    In Underwriting (UW)
                                </h3>
                            </div>

                            <div className="max-h-[70vh] overflow-y-auto premium-scrollbar pr-4 -mr-4">
                                <div className="space-y-4 pr-4">
                                    {under_review_clients.length === 0 ? (
                                        <div className="p-12 text-center bg-surface-container-low rounded-xl border border-dashed border-outline-variant">
                                            <p className="text-outline text-sm font-medium">No deals currently in UW review.</p>
                                        </div>
                                    ) : (
                                        under_review_clients.map(client => (
                                            <div
                                                key={client.id}
                                                onClick={() => router.push(detail_base + client.id)}
                                                className="bg-surface-container-lowest p-6 rounded-xl shadow-sm border-l-4 border-primary group hover:shadow-md transition-all cursor-pointer"
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="flex gap-4">
                                                        <div className="h-10 w-10 rounded-lg bg-primary/5 flex items-center justify-center text-primary">
                                                            <span className="material-symbols-outlined">analytics</span>
                                                        </div>
                                                        <div>
                                                            <h4 className="font-bold text-on-surface group-hover:text-primary transition-colors">{client.client_name}</h4>
                                                            <p className="text-xs text-on-surface-variant">{client.company_name}</p>

                                                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                                                                {client.pipeline_status ? (
                                                                    <LoanPipelineBadge currentStatus={client.pipeline_status} className="scale-90 origin-left" />
                                                                ) : (
                                                                    <div className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border border-emerald-100">
                                                                        Under Review
                                                                    </div>
                                                                )}
                                                                <div className="text-[11px] font-bold text-outline">
                                                                    {format_currency(client.capital_requested)}
                                                                </div>
                                                                <ActivityAgeBadge created_at={client.created_at} last_activity_at={client.last_activity_at} reassigned_to_catch_all_at={client.reassigned_to_catch_all_at} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <span className="material-symbols-outlined text-outline group-hover:text-primary transition-colors">chevron_right</span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Inactive Deals */}
                    <div className="pt-8 border-t border-outline-variant/30">
                        <div className="bg-surface-container-low rounded-3xl p-8 border border-outline-variant/20 shadow-sm relative overflow-hidden">
                            <div className="absolute -top-24 -right-24 w-64 h-64 bg-tertiary-fixed/5 rounded-full blur-3xl" />

                            <div className="flex items-center justify-between mb-8 relative z-10">
                                <div>
                                    <h3 className="font-headline text-xl font-black flex items-center gap-3 text-on-surface">
                                        <div className="w-10 h-10 rounded-2xl bg-tertiary-fixed flex items-center justify-center shadow-lg shadow-tertiary-fixed/20 text-on-tertiary-fixed">
                                            <span className="material-symbols-outlined">timer_off</span>
                                        </div>
                                        Inactive Prospects (To Take Action)
                                    </h3>
                                    <p className="text-on-surface-variant font-medium mt-1 text-sm">These prospects haven't shown activity for over 14 days and may need a follow-up.</p>
                                </div>
                                {inactive_clients.length > 0 && (
                                    <Badge className="bg-tertiary-fixed text-on-tertiary-fixed font-black uppercase tracking-widest px-4 py-1.5 rounded-full">
                                        {inactive_clients.length} Items Pending
                                    </Badge>
                                )}
                            </div>

                            {inactive_clients.length === 0 ? (
                                <div className="p-16 text-center bg-white/50 rounded-2xl border-2 border-dashed border-outline-variant/50">
                                    <span className="material-symbols-outlined text-outline/30 text-5xl mb-4">check_circle</span>
                                    <p className="text-outline font-bold">No inactive prospects. Everyone is moving!</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {inactive_clients.map(client => (
                                        <div
                                            key={client.id}
                                            onClick={() => router.push(detail_base + client.id)}
                                            className="bg-white p-6 rounded-2xl border border-outline-variant/50 hover:border-tertiary-fixed hover:shadow-xl hover:-translate-y-1 transition-all group cursor-pointer"
                                        >
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-tertiary-fixed group-hover:text-on-tertiary-fixed transition-colors">
                                                    <span className="material-symbols-outlined">person</span>
                                                </div>
                                                <ActivityAgeBadge created_at={client.created_at} last_activity_at={client.last_activity_at} reassigned_to_catch_all_at={client.reassigned_to_catch_all_at} />
                                            </div>

                                            <h4 className="font-bold text-on-surface text-lg mb-1">{client.client_name}</h4>
                                            <p className="text-sm text-on-surface-variant mb-6">{client.company_name}</p>

                                            <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                                                <div className="flex items-center gap-1.5 text-xs font-bold text-outline">
                                                    <span className="material-symbols-outlined text-sm">payments</span>
                                                    {format_currency(client.capital_requested)}
                                                </div>
                                                <span className="material-symbols-outlined text-outline group-hover:text-primary transition-all">arrow_forward</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="mt-8 flex items-center gap-3 bg-amber-50 rounded-xl p-4 border border-amber-100">
                                <span className="material-symbols-outlined text-amber-600 scale-75">info</span>
                                <p className="text-[11px] font-bold text-amber-800 uppercase tracking-widest">
                                    Reminder: Prospects inactive for more than 30 days will be automatically archived as "Declined".
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                /* Declined Archive */
                <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between">
                        <h3 className="font-headline text-lg font-bold flex items-center gap-2 text-on-surface">
                            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>archive</span>
                            Declined Prospects
                        </h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {declined_clients.length === 0 ? (
                            <div className="col-span-full p-24 text-center bg-surface-container-low rounded-3xl border border-dashed border-outline-variant">
                                <p className="text-outline font-bold">No declined prospects in the archive.</p>
                            </div>
                        ) : (
                            declined_clients.map(client => (
                                <div
                                    key={client.id}
                                    onClick={() => router.push(detail_base + client.id)}
                                    className="p-6 rounded-2xl border bg-slate-50 border-slate-200 hover:border-slate-400 transition-all cursor-pointer hover:shadow-lg"
                                >
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-200 text-slate-600">
                                            declined
                                        </div>
                                        <span className="text-[10px] font-bold text-outline">{format_date(client.created_at)}</span>
                                    </div>
                                    <h4 className="font-bold text-on-surface mb-1">{client.client_name}</h4>
                                    <p className="text-xs text-on-surface-variant mb-4">{client.company_name}</p>
                                    <div className="text-lg font-black text-on-surface">{format_currency(client.capital_requested)}</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}
