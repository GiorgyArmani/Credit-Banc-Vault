// src/app/advisor/dashboard/clients/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Users,
    Search,
    FileText,
    Calendar,
    Mail,
    Phone,
    AlertCircle,
    Loader2,
    ChevronRight,
    CheckCircle2,
    Sparkles,
    Building2,
    DollarSign
} from "lucide-react";
import clsx from "clsx";
import { getBulkLatestStatus, type LoanStatus } from "@/app/actions/pipeline";
import { LoanPipelineBadge } from "@/components/loan-pipeline-status";

/**
 * ============================================================================
 * ADVISOR CLIENTS LIST PAGE
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
    client_name: string;
    client_email: string;
    client_phone: string;
    company_name: string;
    capital_requested: number;
    created_at: string;
    document_count: number;
    total_required_docs: number;
    pipeline_status?: LoanStatus;
}

export default function AdvisorClientsListPage() {
    const supabase = createClient();
    const router = useRouter();

    const [component_state, set_component_state] = useState<ComponentState>(
        ComponentState.LOADING
    );
    const [clients, set_clients] = useState<ClientInfo[]>([]);
    const [filtered_clients, set_filtered_clients] = useState<ClientInfo[]>([]);
    const [search_query, set_search_query] = useState<string>("");
    const [error_message, set_error_message] = useState<string>("");
    const [advisor_name, set_advisor_name] = useState<string>("");

    useEffect(() => {
        fetch_advisor_clients();
    }, []);

    useEffect(() => {
        if (search_query.trim() === "") {
            set_filtered_clients(clients);
        } else {
            const query_lower = search_query.toLowerCase();
            const filtered = clients.filter(client =>
                client.client_name.toLowerCase().includes(query_lower) ||
                client.client_email.toLowerCase().includes(query_lower) ||
                client.company_name.toLowerCase().includes(query_lower)
            );
            set_filtered_clients(filtered);
        }
    }, [search_query, clients]);

    async function fetch_advisor_clients() {
        try {
            set_component_state(ComponentState.LOADING);
            const { data: { user }, error: auth_error } = await supabase.auth.getUser();

            if (auth_error || !user) {
                set_error_message("Authentication failed. Please log in again.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            const { data: user_data, error: user_error } = await supabase
                .from("users")
                .select("id, first_name, last_name, role, email")
                .eq("id", user.id)
                .maybeSingle();

            if (user_error || !user_data) {
                set_error_message("Could not verify advisor status.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            if (user_data.role !== "advisor") {
                set_error_message("Access denied. You must be an advisor to view this page.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            const full_name = `${user_data.first_name} ${user_data.last_name}`;
            set_advisor_name(full_name);

            let advisor_query = supabase
                .from("advisors")
                .select("id, first_name, last_name, email")
                .eq("user_id", user.id)
                .maybeSingle();

            let { data: advisor_data, error: advisor_error } = await advisor_query;

            if (!advisor_data && !advisor_error) {
                const email_query = await supabase
                    .from("advisors")
                    .select("id, first_name, last_name, email")
                    .eq("email", user_data.email)
                    .maybeSingle();

                advisor_data = email_query.data;
                advisor_error = email_query.error;

                if (advisor_data) {
                    await supabase
                        .from("advisors")
                        .update({ user_id: user.id })
                        .eq("id", advisor_data.id);
                }
            }

            if (advisor_error || !advisor_data) {
                set_error_message("Could not load advisor profile.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            const { data: clients_data, error: clients_error } = await supabase
                .from("client_data_vault")
                .select(`id, user_id, client_name, client_email, client_phone, company_name, capital_requested, created_at`)
                .eq("advisor_id", advisor_data.id)
                .order("created_at", { ascending: false });

            if (clients_error) {
                set_error_message("Error loading your clients.");
                set_component_state(ComponentState.ERROR);
                return;
            }

            if (!clients_data || clients_data.length === 0) {
                set_component_state(ComponentState.NO_CLIENTS);
                return;
            }

            // 1. Fetch Core Requirements Count once
            const { data: coreDocs } = await supabase
                .from("required_documents")
                .select("code")
                .eq("is_core", true);

            const coreCodes = coreDocs?.map(d => d.code) || [];

            // 2. Map through clients to get individual counts
            const clients_with_doc_counts = await Promise.all(
                clients_data.map(async (client) => {
                    // Fetch Dynamic Requirements for this specific client
                    const { data: dynamicDocs } = await supabase
                        .from("client_dynamic_documents")
                        .select(`
                            required_documents (
                                code
                            )
                        `)
                        .eq("user_id", client.user_id)
                        .eq("is_active", true);

                    const dynamicCodes = dynamicDocs?.map((d: any) => d.required_documents?.code).filter(Boolean) || [];

                    // Combine into set of unique required codes
                    const allRequiredCodes = new Set([...coreCodes, ...dynamicCodes]);

                    // Fetch Uploaded Documents for this specific client
                    const { data: uploadedDocs } = await supabase
                        .from("user_documents")
                        .select("category, doc_code")
                        .eq("user_id", client.user_id);

                    const uploadedCodes = new Set([
                        ...(uploadedDocs?.map(d => d.category).filter(Boolean) || []),
                        ...(uploadedDocs?.map(d => d.doc_code).filter(Boolean) || [])
                    ]);

                    // Calculate satisfied requirements
                    const satisfied = Array.from(allRequiredCodes).filter(code => uploadedCodes.has(code)).length;

                    return {
                        ...client,
                        document_count: satisfied,
                        total_required_docs: allRequiredCodes.size,
                    };
                })
            ) as ClientInfo[];

            // 3. Bulk-fetch pipeline statuses
            const vaultIds = clients_data.map(c => c.id);
            if (vaultIds.length > 0) {
                const pipelineMap = await getBulkLatestStatus(vaultIds);
                clients_with_doc_counts.forEach(client => {
                    client.pipeline_status = pipelineMap.get(client.id) ?? "created";
                });
            }

            set_clients(clients_with_doc_counts);
            set_filtered_clients(clients_with_doc_counts);
            set_component_state(ComponentState.SUCCESS);

        } catch (err: any) {
            set_error_message("An unexpected error occurred.");
            set_component_state(ComponentState.ERROR);
        }
    }

    function format_date(iso_string: string): string {
        const date = new Date(iso_string);
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
        });
    }

    function format_currency(amount: number): string {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    }

    function render_loading_state() {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-20 h-20 bg-emerald-50 rounded-[2.5rem] flex items-center justify-center mb-6 border border-emerald-100 shadow-inner">
                    <Loader2 className="h-10 w-10 text-emerald-500 animate-spin" />
                </div>
                <p className="text-emerald-950/40 font-bold">Loading your clients...</p>
            </div>
        );
    }

    function render_error_state() {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="bg-white border border-red-50 rounded-[2.5rem] p-10 text-center shadow-2xl">
                    <div className="mx-auto w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-6 border border-red-100">
                        <AlertCircle className="h-8 w-8 text-red-500" />
                    </div>
                    <h3 className="text-2xl font-black text-emerald-950 uppercase tracking-tighter mb-2">
                        Error Loading Clients
                    </h3>
                    <p className="text-emerald-950/40 font-bold mb-6 max-w-xs">{error_message}</p>
                    <Button
                        onClick={fetch_advisor_clients}
                        className="h-12 px-8 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-xl shadow-lg shadow-emerald-500/20"
                    >
                        Try Again
                    </Button>
                </div>
            </div>
        );
    }

    function render_no_clients_state() {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="bg-white border border-emerald-50 rounded-[3rem] p-12 text-center shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl -mr-16 -mt-16" />
                    <div className="mx-auto w-20 h-20 bg-emerald-50 rounded-[2rem] flex items-center justify-center mb-6 border border-emerald-100 shadow-inner">
                        <Users className="h-10 w-10 text-emerald-500" />
                    </div>
                    <h3 className="text-3xl font-black text-emerald-950 uppercase tracking-tighter mb-3">
                        No Clients Yet
                    </h3>
                    <p className="text-emerald-950/40 font-bold mb-8 max-w-sm">
                        You haven't created any client accounts yet. Start by creating your first client.
                    </p>
                    <Button
                        onClick={() => router.push("/advisor/dashboard/clients/new")}
                        className="h-14 px-10 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95"
                    >
                        <FileText className="h-5 w-5 mr-3" />
                        Create First Client
                    </Button>
                </div>
            </div>
        );
    }

    function render_client_card(client: ClientInfo) {
        const completion_percentage = Math.round((client.document_count / client.total_required_docs) * 100);

        return (
            <Card
                key={client.id}
                className="group relative bg-white rounded-[2.5rem] border-emerald-50 shadow-sm hover:shadow-2xl transition-all duration-500 cursor-pointer overflow-hidden border"
                onClick={() => router.push(`/advisor/dashboard/clients/${client.id}`)}
            >
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-full blur-3xl -mr-12 -mt-12 group-hover:bg-emerald-100 transition-colors" />

                <CardHeader className="p-8 pb-4 relative z-10">
                    <div className="flex items-start justify-between">
                        <div className="space-y-1">
                            <CardTitle className="text-xl font-black text-emerald-950 uppercase tracking-tighter group-hover:text-emerald-500 transition-colors">
                                {client.client_name}
                            </CardTitle>
                            <CardDescription className="text-sm font-bold text-emerald-900/40 flex items-center gap-2">
                                <Building2 className="w-3.5 h-3.5" />
                                {client.company_name}
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            {client.pipeline_status && (
                                <div className="scale-75 origin-right">
                                    <LoanPipelineBadge currentStatus={client.pipeline_status} />
                                </div>
                            )}
                            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-white transition-all duration-300">
                                <ChevronRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-0.5" />
                            </div>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-8 pt-4 space-y-6 relative z-10">
                    <div className="space-y-3">
                        <div className="flex items-center text-sm font-bold text-emerald-900/60">
                            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center mr-3">
                                <Mail className="h-4 w-4 text-emerald-500" />
                            </div>
                            <span className="truncate">{client.client_email}</span>
                        </div>
                        {client.client_phone && (
                            <div className="flex items-center text-sm font-bold text-emerald-900/60">
                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center mr-3">
                                    <Phone className="h-4 w-4 text-emerald-500" />
                                </div>
                                <span className="truncate">{client.client_phone}</span>
                            </div>
                        )}
                        <div className="flex items-center text-sm font-bold text-emerald-900/60">
                            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center mr-3">
                                <Calendar className="h-4 w-4 text-emerald-500" />
                            </div>
                            <span>Created {format_date(client.created_at)}</span>
                        </div>
                    </div>

                    <div className="bg-emerald-50/50 rounded-2xl p-5 border border-emerald-50 group-hover:bg-emerald-50 transition-colors">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-900/30 mb-1">Capital Requested</p>
                        <div className="flex items-center gap-2">
                            <DollarSign className="w-5 h-5 text-emerald-500" />
                            <p className="text-2xl font-black text-emerald-950">
                                {format_currency(client.capital_requested)}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-900/40">
                                Document Status
                            </span>
                            <span className={clsx(
                                "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
                                completion_percentage >= 100 ? "bg-emerald-100 text-emerald-600 border-emerald-200" :
                                    completion_percentage >= 50 ? "bg-yellow-50 text-yellow-600 border-yellow-200" :
                                        "bg-red-50 text-red-600 border-red-100"
                            )}>
                                {client.document_count}/{client.total_required_docs}
                            </span>
                        </div>

                        <div className="w-full bg-emerald-50/50 rounded-full h-2.5 overflow-hidden border border-emerald-50">
                            <div
                                className={clsx(
                                    "h-full rounded-full transition-all duration-1000",
                                    completion_percentage >= 100 ? "bg-emerald-500" :
                                        completion_percentage >= 50 ? "bg-yellow-500" :
                                            "bg-red-500"
                                )}
                                style={{ width: `${Math.min(completion_percentage, 100)}%` }}
                            />
                        </div>

                        <p className="text-[10px] font-black text-emerald-900/30 uppercase tracking-widest text-right">
                            {completion_percentage}% complete
                        </p>
                    </div>

                    <Button
                        variant="ghost"
                        className="w-full h-12 rounded-xl group-hover:bg-emerald-500 group-hover:text-white font-black uppercase tracking-widest text-[10px] transition-all border border-emerald-100"
                        onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/advisor/dashboard/clients/${client.id}`);
                        }}
                    >
                        View Documents
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="min-h-screen bg-[#f0fdf7] relative overflow-hidden -m-4 md:-m-8 p-4 md:p-8">
            {/* aurora-glow effect for consistency */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
            <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-200/10 blur-[120px] rounded-full pointer-events-none animate-aurora" />
            <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-100/5 blur-[120px] rounded-full pointer-events-none animate-aurora" style={{ animationDelay: '-3s' }} />

            <div className="relative z-10 space-y-8 max-w-7xl mx-auto">
                {/* Page Header */}
                <div className="bg-white border border-emerald-50 rounded-[2.5rem] p-10 md:p-14 text-emerald-950 shadow-2xl overflow-hidden relative">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl -mr-10 -mt-10" />
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                        <div className="space-y-4">
                            <div className="flex items-center gap-4">
                                <Users className="w-10 h-10 text-emerald-500" />
                                <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter">Your Clients</h1>
                            </div>
                            <p className="text-emerald-900/60 text-xl font-bold max-w-2xl">
                                {advisor_name && `Welcome back, ${advisor_name}! `}
                                Manage and track your clients' document submissions in real-time.
                            </p>
                        </div>
                        <Button
                            onClick={() => router.push("/advisor/dashboard/clients/new")}
                            className="h-16 px-10 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95 text-lg group"
                        >
                            <FileText className="mr-3 w-6 h-6 group-hover:rotate-12 transition-transform" />
                            New Client
                        </Button>
                    </div>
                </div>

                {/* Search Bar */}
                {component_state === ComponentState.SUCCESS && (
                    <div className="relative z-10 mt-[-2rem] px-10">
                        <div className="bg-white/80 backdrop-blur-xl border border-emerald-50 rounded-2xl shadow-xl p-2 max-w-2xl mx-auto">
                            <div className="relative">
                                <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 h-5 w-5 text-emerald-500/40" />
                                <Input
                                    type="text"
                                    placeholder="Search by client name, email, or company..."
                                    value={search_query}
                                    onChange={(e) => set_search_query(e.target.value)}
                                    className="h-14 pl-14 pr-6 rounded-xl border-none bg-transparent focus-visible:ring-emerald-500/20 font-bold text-emerald-950 placeholder:text-emerald-950/20 text-lg"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Content Area */}
                <div className="relative z-10 px-2 min-h-[400px]">
                    {(() => {
                        switch (component_state) {
                            case ComponentState.LOADING:
                                return render_loading_state();
                            case ComponentState.ERROR:
                                return render_error_state();
                            case ComponentState.NO_CLIENTS:
                                return render_no_clients_state();
                            case ComponentState.SUCCESS:
                                return (
                                    <div className="space-y-8">
                                        <div className="flex items-center justify-between px-2">
                                            <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-900/30">
                                                Results: {filtered_clients.length} of {clients.length} clients
                                            </p>
                                        </div>

                                        {filtered_clients.length === 0 ? (
                                            <div className="bg-white/50 backdrop-blur-sm border border-emerald-50 rounded-[2.5rem] py-20 text-center">
                                                <Search className="h-16 w-16 text-emerald-200 mx-auto mb-6" />
                                                <h3 className="text-2xl font-black text-emerald-950 uppercase tracking-tighter mb-2">No matches found</h3>
                                                <p className="text-emerald-950/40 font-bold">Try adjusting your search terms</p>
                                            </div>
                                        ) : (
                                            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                                                {filtered_clients.map(client => render_client_card(client))}
                                            </div>
                                        )}
                                    </div>
                                );
                            default:
                                return null;
                        }
                    })()}
                </div>
            </div>
        </div>
    );
}
