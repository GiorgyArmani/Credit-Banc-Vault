// src/app/underwriting/dashboard/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Search,
    FileText,
    Calendar,
    Mail,
    Building2,
    DollarSign,
    ChevronRight,
    Loader2,
    AlertCircle,
    ShieldCheck,
    CheckCircle2,
    Clock
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import clsx from "clsx";
import { getBulkLatestStatus, type LoanStatus } from "@/app/actions/pipeline";
import { LoanPipelineBadge } from "@/components/loan-pipeline-status";

enum ComponentState {
    LOADING = "LOADING",
    ERROR = "ERROR",
    SUCCESS = "SUCCESS",
    EMPTY = "EMPTY",
}

interface ClientReviewInfo {
    id: string; // client_data_vault id
    user_id: string;
    client_name: string;
    client_email: string;
    company_name: string;
    capital_requested: number;
    created_at: string;
    advisor_name: string;
    document_count: number;
    total_required_docs: number;
    submission_status?: string;
    pipeline_status?: LoanStatus;
}

export default function UnderwritingDashboardPage() {
    const supabase = createClient();
    const router = useRouter();
    const pathname = usePathname();

    const [component_state, set_component_state] = useState<ComponentState>(ComponentState.LOADING);
    const [submitted_clients, set_submitted_clients] = useState<ClientReviewInfo[]>([]);
    const [active_vaults, set_active_vaults] = useState<ClientReviewInfo[]>([]);
    const [funded_clients, set_funded_clients] = useState<ClientReviewInfo[]>([]);
    const [declined_clients, set_declined_clients] = useState<ClientReviewInfo[]>([]);
    const [search_query, set_search_query] = useState<string>("");
    const [error_message, set_error_message] = useState<string>("");
    const [active_tab, set_active_tab] = useState<string>("ready");

    useEffect(() => {
        fetch_data();
    }, []);

    const clients_to_filter = 
        active_tab === "ready" ? submitted_clients : 
        active_tab === "active" ? active_vaults :
        active_tab === "funded" ? funded_clients :
        declined_clients;
    const [filtered_clients, set_filtered_clients] = useState<ClientReviewInfo[]>([]);

    useEffect(() => {
        if (search_query.trim() === "") {
            set_filtered_clients(clients_to_filter);
        } else {
            const query_lower = search_query.toLowerCase();
            const filtered = clients_to_filter.filter(client =>
                client.client_name.toLowerCase().includes(query_lower) ||
                client.client_email.toLowerCase().includes(query_lower) ||
                client.company_name.toLowerCase().includes(query_lower) ||
                client.advisor_name.toLowerCase().includes(query_lower)
            );
            set_filtered_clients(filtered);
        }
    }, [search_query, clients_to_filter, active_tab]);

    async function fetch_data() {
        try {
            set_component_state(ComponentState.LOADING);

            // Fetch all client vault profiles
            const { data: vault_data, error: vault_error } = await supabase
                .from("client_data_vault")
                .select(`
                    id,
                    user_id,
                    client_name,
                    client_email,
                    company_name,
                    capital_requested,
                    created_at,
                    advisor_id,
                    advisors (
                        first_name,
                        last_name
                    )
                `)
                .order("created_at", { ascending: false });

            if (vault_error) throw vault_error;

            if (!vault_data || vault_data.length === 0) {
                set_component_state(ComponentState.EMPTY);
                return;
            }

            // Fetch all submissions to check status
            const { data: sub_data } = await supabase
                .from("submissions")
                .select("user_id, status, submitted_at");

            const submission_map = new Map(sub_data?.map(s => [s.user_id, s]) || []);

            // Requirement data for stats
            const { data: coreDocs } = await supabase.from("required_documents").select("code").eq("is_core", true);
            const coreCodes = coreDocs?.map(d => d.code) || [];

            const ready_list: ClientReviewInfo[] = [];
            const active_list: ClientReviewInfo[] = [];
            const funded_list: ClientReviewInfo[] = [];
            const declined_list: ClientReviewInfo[] = [];

            // 1.5 Fetch bulk pipeline statuses FIRST for easier routing
            const allVaultIds = vault_data.map(c => c.id);
            const pipelineMap = await getBulkLatestStatus(allVaultIds);

            for (const client of vault_data) {
                const sub = submission_map.get(client.user_id);
                const advisor: any = client.advisors;
                const pStatus = pipelineMap.get(client.id) ?? "created";

                // Document stats calculation - Simplified view for dashboard
                const { data: dynamicDocs } = await supabase.from("client_dynamic_documents").select("required_documents(code)").eq("user_id", client.user_id).eq("is_active", true);
                const dynamicCodes = dynamicDocs?.map((d: any) => d.required_documents?.code).filter(Boolean) || [];
                const allRequiredCodes = new Set([...coreCodes, ...dynamicCodes]);

                const { data: uploadedDocs } = await supabase.from("user_documents").select("category, doc_code").eq("user_id", client.user_id);
                const uploadedCodes = new Set([
                    ...(uploadedDocs?.map(d => d.category).filter(Boolean) || []),
                    ...(uploadedDocs?.map(d => d.doc_code).filter(Boolean) || [])
                ]);

                const satisfied = Array.from(allRequiredCodes).filter(code => uploadedCodes.has(code)).length;
                const total = allRequiredCodes.size;

                const info: ClientReviewInfo = {
                    id: client.id,
                    user_id: client.user_id,
                    client_name: client.client_name,
                    client_email: client.client_email,
                    company_name: client.company_name,
                    capital_requested: client.capital_requested,
                    created_at: sub?.submitted_at || client.created_at || "",
                    advisor_name: advisor ? `${advisor.first_name} ${advisor.last_name}` : "Unknown Advisor",
                    document_count: satisfied,
                    total_required_docs: total,
                    submission_status: sub?.status || "in_progress",
                    pipeline_status: pStatus
                };

                // Routing into buckets
                if (pStatus === "funded") {
                    funded_list.push(info);
                } else if (pStatus === "declined") {
                    declined_list.push(info);
                } else if (sub?.status === 'locked') {
                    ready_list.push(info);
                } else {
                    active_list.push(info);
                }
            }

            set_submitted_clients(ready_list);
            set_active_vaults(active_list);
            set_funded_clients(funded_list);
            set_declined_clients(declined_list);
            set_component_state(ComponentState.SUCCESS);

        } catch (err: any) {
            console.error("fetch_data error:", err);
            set_error_message(err.message || "Failed to load review data.");
            set_component_state(ComponentState.ERROR);
        }
    }

    function render_client_card(client: ClientReviewInfo) {
        const isReady = client.submission_status === 'locked';

        return (
            <Card
                key={client.id}
                className="group relative bg-white rounded-[2.5rem] border-slate-200 shadow-sm hover:shadow-2xl transition-all duration-500 cursor-pointer overflow-hidden border"
                onClick={() => router.push((pathname.startsWith("/admin") ? "/admin/clients/" : "/underwriting/dashboard/clients/") + client.id)}
            >
                <div className={clsx(
                    "absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl -mr-12 -mt-12 transition-colors",
                    isReady ? "bg-emerald-50 group-hover:bg-emerald-100" : "bg-blue-50 group-hover:bg-blue-100"
                )} />

                <CardHeader className="p-8 pb-4 relative z-10">
                    <div className="flex items-start justify-between">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 mb-2">
                                {client.pipeline_status && (client.pipeline_status !== "created" || !isReady) ? (
                                    <LoanPipelineBadge currentStatus={client.pipeline_status} />
                                ) : (
                                    <LoanPipelineBadge currentStatus={isReady ? "under_review" : "created"} />
                                )}
                                {!client.pipeline_status && (
                                    <Badge className={clsx(
                                        "uppercase tracking-tighter font-black text-[9px] px-2 py-0.5 border",
                                        isReady
                                            ? "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                            : "bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100"
                                    )}>
                                        {client.submission_status === 'locked' ? "Ready for Review" : client.submission_status === 'submitted' ? "Submitted" : "In Progress"}
                                    </Badge>
                                )}
                                <span className="text-[10px] font-bold text-slate-400">
                                    {client.document_count}/{client.total_required_docs} Docs
                                </span>
                            </div>
                            <CardTitle className="text-xl font-black text-slate-900 uppercase tracking-tighter group-hover:text-emerald-600 transition-colors">
                                {client.client_name}
                            </CardTitle>
                            <CardDescription className="text-sm font-bold text-slate-400 flex items-center gap-2">
                                <Building2 className="w-3.5 h-3.5" />
                                {client.company_name}
                            </CardDescription>
                        </div>
                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center group-hover:bg-slate-900 group-hover:text-white transition-all duration-300">
                            <ChevronRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-0.5" />
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-8 pt-4 space-y-6 relative z-10">
                    <div className="space-y-3">
                        <div className="flex items-center text-sm font-bold text-slate-600">
                            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center mr-3">
                                <Mail className="h-4 w-4 text-slate-400" />
                            </div>
                            <span className="truncate">{client.client_email}</span>
                        </div>
                        <div className="flex items-center text-sm font-bold text-slate-600">
                            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center mr-3">
                                <Calendar className="h-4 w-4 text-slate-400" />
                            </div>
                            <span>Assigned to: {client.advisor_name}</span>
                        </div>
                    </div>

                    <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 group-hover:bg-slate-100/50 transition-colors">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Capital Requested</p>
                        <div className="flex items-center gap-2">
                            <DollarSign className="w-5 h-5 text-emerald-500" />
                            <p className="text-2xl font-black text-slate-950">
                                {new Intl.NumberFormat("en-US", {
                                    style: "currency",
                                    currency: "USD",
                                    minimumFractionDigits: 0,
                                }).format(client.capital_requested)}
                            </p>
                        </div>
                    </div>

                    <Button
                        className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black uppercase tracking-widest text-[10px] transition-all"
                    >
                        View Profile
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="bg-slate-900 rounded-[2.5rem] p-10 md:p-14 text-white shadow-2xl overflow-hidden relative border border-slate-800">
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[100px] -mr-32 -mt-32" />
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/20">
                                <ShieldCheck className="w-7 h-7 text-emerald-400" />
                            </div>
                            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter">Underwriting Portal</h1>
                        </div>
                        <p className="text-slate-400 text-xl font-bold max-w-2xl">
                            Track client submissions and active vaults to process funding applications.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 flex items-center justify-between backdrop-blur-md">
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400/60">Ready</p>
                                <p className="text-3xl font-black text-emerald-400 leading-none mt-1">{submitted_clients.length}</p>
                            </div>
                            <ShieldCheck className="w-8 h-8 text-emerald-400/40" />
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex items-center justify-between backdrop-blur-md">
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-blue-400/60">Active</p>
                                <p className="text-3xl font-black text-blue-400 leading-none mt-1">{active_vaults.length}</p>
                            </div>
                            <Clock className="w-8 h-8 text-blue-400/40" />
                        </div>
                        <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-4 flex items-center justify-between backdrop-blur-md">
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-violet-400/60">Funded</p>
                                <p className="text-3xl font-black text-violet-400 leading-none mt-1">{funded_clients.length}</p>
                            </div>
                            <Badge className="bg-violet-500 w-8 h-8 p-0 flex items-center justify-center rounded-lg shadow-lg shadow-violet-500/20 text-white">
                                <CheckCircle2 className="w-5 h-5" />
                            </Badge>
                        </div>
                        <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 flex items-center justify-between backdrop-blur-md">
                            <div className="text-left">
                                <p className="text-[10px] font-black uppercase tracking-widest text-rose-400/60">Declined</p>
                                <p className="text-3xl font-black text-rose-400 leading-none mt-1">{declined_clients.length}</p>
                            </div>
                            <AlertCircle className="w-8 h-8 text-rose-400/40" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content with Tabs */}
            <div className="space-y-8">
                <Tabs defaultValue="ready" onValueChange={set_active_tab} className="w-full">
                    <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8 px-2">
                        <TabsList className="bg-slate-100 p-1.5 rounded-2xl h-14 border border-slate-200">
                            <TabsTrigger
                                value="ready"
                                className="rounded-xl px-8 h-full data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm font-black uppercase tracking-widest text-[10px]"
                            >
                                <ShieldCheck className="w-4 h-4 mr-2" />
                                Ready ({submitted_clients.length})
                            </TabsTrigger>
                            <TabsTrigger
                                value="active"
                                className="rounded-xl px-8 h-full data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm font-black uppercase tracking-widest text-[10px]"
                            >
                                <Clock className="w-4 h-4 mr-2" />
                                Vaults ({active_vaults.length})
                            </TabsTrigger>
                            <TabsTrigger
                                value="funded"
                                className="rounded-xl px-8 h-full data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm font-black uppercase tracking-widest text-[10px]"
                            >
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                Funded ({funded_clients.length})
                            </TabsTrigger>
                            <TabsTrigger
                                value="declined"
                                className="rounded-xl px-8 h-full data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm font-black uppercase tracking-widest text-[10px]"
                            >
                                <AlertCircle className="w-4 h-4 mr-2" />
                                Declined ({declined_clients.length})
                            </TabsTrigger>
                        </TabsList>

                        <div className="bg-white border border-slate-200 rounded-2xl shadow-lg shadow-slate-200/20 p-1 w-full max-w-md">
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-300" />
                                <Input
                                    type="text"
                                    placeholder="Search name, company, advisor..."
                                    value={search_query}
                                    onChange={(e) => set_search_query(e.target.value)}
                                    className="h-11 pl-11 pr-4 rounded-xl border-none bg-transparent focus-visible:ring-0 font-bold text-slate-700 placeholder:text-slate-300 text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    <TabsContent value="ready" className="mt-0 px-2">
                        {render_content(submitted_clients)}
                    </TabsContent>
                    <TabsContent value="active" className="mt-0 px-2">
                        {render_content(active_vaults)}
                    </TabsContent>
                    <TabsContent value="funded" className="mt-0 px-2">
                        {render_content(funded_clients)}
                    </TabsContent>
                    <TabsContent value="declined" className="mt-0 px-2">
                        {render_content(declined_clients)}
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );

    function render_content(data_list: ClientReviewInfo[]) {
        switch (component_state) {
            case ComponentState.LOADING:
                return (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-20 h-20 bg-slate-900 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-xl shadow-slate-900/20">
                            <Loader2 className="h-10 w-10 text-emerald-400 animate-spin" />
                        </div>
                        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Syncing Data...</p>
                    </div>
                );
            case ComponentState.ERROR:
                return (
                    <div className="bg-white border border-slate-200 rounded-[3rem] p-12 text-center shadow-xl max-w-md mx-auto">
                        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-6" />
                        <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter mb-2">Sync Error</h3>
                        <p className="text-slate-400 font-bold mb-8">{error_message}</p>
                        <Button onClick={fetch_data} className="bg-slate-900 text-white rounded-xl h-12 px-8 font-black">Retry</Button>
                    </div>
                );
            case ComponentState.EMPTY:
            case ComponentState.SUCCESS:
                if (filtered_clients.length === 0) {
                    return (
                        <div className="bg-white border border-slate-200 rounded-[3rem] p-20 text-center shadow-xl max-w-2xl mx-auto border-dashed">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                <Search className="h-8 w-8 text-slate-300" />
                            </div>
                            <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter mb-2">No results found</h3>
                            <p className="text-slate-400 font-bold">Try adjusting your search query or switching tabs.</p>
                        </div>
                    );
                }
                return (
                    <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 pb-20">
                        {filtered_clients.map(client => render_client_card(client))}
                    </div>
                );
            default:
                return null;
        }
    }
}
