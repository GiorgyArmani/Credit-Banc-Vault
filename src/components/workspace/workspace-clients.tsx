// src/components/workspace/workspace-clients.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import clsx from "clsx";
import { getBulkLatestStatus, type LoanStatus } from "@/app/actions/pipeline";
import { getBulkClientActivity } from "@/app/actions/advisor";
import { canUseAdvisorWorkspace } from "@/lib/auth/roles";

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
 * CLIENTS LIST PAGE — FUNDED CUSTOMER BOOK
 * ----------------------------------------------------------------------------
 * Only files whose pipeline_status === "funded" land here. Anything earlier in
 * the pipeline lives on `${basePath}/prospects`.
 *
 * Rendered by three portals, differing only in `basePath`:
 *   /advisor/dashboard   staff advisors
 *   /admin               admins (adds the all/mine scope toggle)
 *   /partner             external partner advisors working their own deals
 *
 * The owner ∪ follower scoping below is convenience, not the security boundary —
 * RLS enforces the same bound independently through is_assigned_advisor_for().
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
    pipeline_status?: LoanStatus;
    funded_at?: string;
}

export function WorkspaceClients({ basePath }: { basePath: string }) {
    const supabase = createClient();
    const router = useRouter();
    const isAdminContext = basePath.startsWith("/admin");

    const [component_state, set_component_state] = useState<ComponentState>(
        ComponentState.LOADING
    );
    const [clients, set_clients] = useState<ClientInfo[]>([]);
    const [search_query, set_search_query] = useState<string>("");
    const [error_message, set_error_message] = useState<string>("");
    const [user_role, set_user_role] = useState<string>("");
    const [my_advisor_id, set_my_advisor_id] = useState<string | null>(null);
    const [admin_scope, set_admin_scope] = useState<"all" | "mine">("all");

    useEffect(() => {
        fetch_funded_clients();

        const handleSearch = () => {
            const params = new URLSearchParams(window.location.search);
            set_search_query(params.get('q') || "");
        };
        handleSearch();
        window.addEventListener('search_updated', handleSearch);
        return () => window.removeEventListener('search_updated', handleSearch);
    }, []);

    const scoped_clients = useMemo(() => {
        if (user_role !== "admin" || admin_scope === "all") return clients;
        if (!my_advisor_id) return [];
        return clients.filter(c => c.advisor_id === my_advisor_id);
    }, [clients, user_role, admin_scope, my_advisor_id]);

    const filtered_clients = useMemo(() => {
        if (search_query.trim() === "") return scoped_clients;
        const query_lower = search_query.toLowerCase();
        return scoped_clients.filter(client =>
            client.client_name.toLowerCase().includes(query_lower) ||
            client.client_email.toLowerCase().includes(query_lower) ||
            client.company_name.toLowerCase().includes(query_lower)
        );
    }, [search_query, scoped_clients]);

    const total_funded = useMemo(
        () => filtered_clients.reduce((sum, c) => sum + (c.capital_requested || 0), 0),
        [filtered_clients]
    );

    async function fetch_funded_clients() {
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
                .select('id, user_id, advisor_id, client_name, client_email, client_phone, company_name, capital_requested, created_at')
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
                set_error_message("Error loading clients.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            if (!clients_data || clients_data.length === 0) {
                set_component_state(ComponentState.NO_CLIENTS);
                return;
            }

            const vaultIds = clients_data.map(c => c.id);
            const [pipelineMap, activityMap] = await Promise.all([
                getBulkLatestStatus(vaultIds),
                getBulkClientActivity(vaultIds),
            ]);

            const funded_only = clients_data
                .map(c => ({
                    ...c,
                    pipeline_status: pipelineMap.get(c.id) ?? "created",
                    funded_at: activityMap.get(c.id),
                }))
                .filter(c => c.pipeline_status === "funded") as ClientInfo[];

            if (funded_only.length === 0) {
                set_component_state(ComponentState.NO_CLIENTS);
                return;
            }

            set_clients(funded_only);
            set_component_state(ComponentState.SUCCESS);

        } catch (err: any) {
            set_error_message("An unexpected error occurred.");
            set_component_state(ComponentState.ERROR);
        }
    }

    function format_date(iso_string?: string): string {
        if (!iso_string) return "—";
        const date = new Date(iso_string);
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    const detail_base = `${basePath}/clients/`;
    const new_href = `${basePath}/clients/new`;

    if (component_state === ComponentState.LOADING) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <span className="material-symbols-outlined text-5xl text-emerald-500 animate-spin mb-4">progress_activity</span>
                <p className="text-slate-400 font-manrope font-bold">Loading funded clients...</p>
            </div>
        );
    }

    if (component_state === ComponentState.ERROR) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <span className="material-symbols-outlined text-5xl text-red-500 mb-4">error</span>
                <h3 className="text-xl font-bold mb-2">Error Loading Clients</h3>
                <p className="text-slate-400 mb-6">{error_message}</p>
                <Button onClick={fetch_funded_clients}>Try Again</Button>
            </div>
        );
    }

    if (component_state === ComponentState.NO_CLIENTS) {
        return (
            <section className="p-0 md:p-8 space-y-8 animate-in fade-in duration-500 font-manrope">
                <div className="flex justify-between items-end flex-wrap gap-4">
                    <div>
                        <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">Client Book</h1>
                        <p className="text-on-surface-variant font-medium mt-1">Funded customers only.</p>
                    </div>
                    <Button
                        onClick={() => router.push(new_href)}
                        className="bg-primary text-white px-6 py-6 rounded-xl font-bold flex items-center gap-2 hover:opacity-90 active:scale-95 transition-all shadow-lg shadow-primary/20"
                    >
                        <span className="material-symbols-outlined">person_add</span>
                        New Funding
                    </Button>
                </div>
                <div className="p-16 text-center bg-surface-container-low rounded-3xl border border-dashed border-outline-variant/50">
                    <span className="material-symbols-outlined text-outline/30 text-6xl mb-4">paid</span>
                    <h3 className="text-2xl font-black mb-2 uppercase tracking-tighter">No Funded Clients Yet</h3>
                    <p className="text-outline font-medium mb-6">Once a prospect funds, they'll graduate into your client book here.</p>
                    <Button onClick={() => router.push(`${basePath}/prospects`)}>
                        View Prospects
                    </Button>
                </div>
            </section>
        );
    }

    return (
        <section className="p-0 md:p-8 space-y-8 animate-in fade-in duration-500 font-manrope">
            {/* Header Section */}
            <div className="flex justify-between items-end flex-wrap gap-4">
                <div>
                    <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">Client Book</h1>
                    <p className="text-on-surface-variant font-medium mt-1">
                        {scoped_clients.length} funded {scoped_clients.length === 1 ? "client" : "clients"} ·
                        <span className="text-primary font-bold ml-1">{format_currency(total_funded)} funded total</span>
                    </p>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                    {/* Admin scope toggle */}
                    {user_role === "admin" && (
                        <div className="bg-surface-container-low p-1 rounded-xl border border-outline-variant/30 flex shadow-inner">
                            <button
                                onClick={() => set_admin_scope("all")}
                                className={clsx(
                                    "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                                    admin_scope === "all" ? "bg-white text-primary shadow-sm" : "text-outline hover:text-on-surface"
                                )}
                            >
                                All Clients
                            </button>
                            <button
                                onClick={() => set_admin_scope("mine")}
                                className={clsx(
                                    "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                                    admin_scope === "mine" ? "bg-white text-primary shadow-sm" : "text-outline hover:text-on-surface"
                                )}
                                title={!my_advisor_id ? "No advisor profile linked to your admin account" : undefined}
                            >
                                My Clients
                            </button>
                        </div>
                    )}

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
                        New Funding
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filtered_clients.length === 0 ? (
                    <div className="col-span-full p-24 text-center bg-surface-container-low rounded-3xl border border-dashed border-outline-variant">
                        <p className="text-outline font-bold">No clients match your search.</p>
                    </div>
                ) : (
                    filtered_clients.map(client => (
                        <div
                            key={client.id}
                            onClick={() => router.push(detail_base + client.id)}
                            className="p-6 rounded-2xl border bg-emerald-50/40 border-emerald-100 hover:border-emerald-500 transition-all cursor-pointer hover:shadow-xl hover:-translate-y-1 group"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-600 text-white flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                                    Funded
                                </div>
                                <span className="text-[10px] font-bold text-outline">{format_date(client.funded_at || client.created_at)}</span>
                            </div>

                            <h4 className="font-bold text-on-surface text-lg mb-1">{client.client_name}</h4>
                            <p className="text-sm text-on-surface-variant mb-4">{client.company_name}</p>

                            <div className="space-y-2 mb-4">
                                <a href={`mailto:${client.client_email}`} onClick={(e) => e.stopPropagation()} className="text-[11px] font-bold text-on-surface hover:text-primary flex items-center gap-2 truncate">
                                    <span className="material-symbols-outlined text-xs">mail</span>
                                    {client.client_email}
                                </a>
                                <a href={`tel:${client.client_phone}`} onClick={(e) => e.stopPropagation()} className="text-[11px] font-bold text-on-surface hover:text-primary flex items-center gap-2">
                                    <span className="material-symbols-outlined text-xs">phone</span>
                                    {client.client_phone}
                                </a>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t border-emerald-100">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-outline">Funded</p>
                                    <p className="text-lg font-black text-emerald-700">{format_currency(client.capital_requested)}</p>
                                </div>
                                <span className="material-symbols-outlined text-outline group-hover:text-primary group-hover:translate-x-1 transition-all">arrow_forward</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </section>
    );
}
