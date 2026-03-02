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
    Plus
} from "lucide-react";
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
import { notifyAdvisor } from "../../actions";
import { toast } from "sonner";
import clsx from "clsx";

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
    advisor: {
        first_name: string;
        last_name: string;
        email: string;
    };
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
}

export default function UnderwritingClientDetailsPage() {
    const supabase = createClient();
    const router = useRouter();
    const params = useParams();
    const client_id = params.id as string;

    const [component_state, set_component_state] = useState<ComponentState>(ComponentState.LOADING);
    const [client_profile, set_client_profile] = useState<ClientProfile | null>(null);
    const [documents, set_documents] = useState<UserDocument[]>([]);
    const [required_docs, set_required_docs] = useState<{ code: string; label: string }[]>([]);
    const [error_message, set_error_message] = useState<string>("");

    const [is_notify_modal_open, set_is_notify_modal_open] = useState(false);
    const [selected_missing_docs, setSelected_missing_docs] = useState<string[]>([]);
    const [is_notifying, setIs_notifying] = useState(false);

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

            // 3. Fetch current requirements (core + dynamic)
            const { data: coreDocs } = await supabase
                .from("required_documents")
                .select("code, label")
                .eq("is_core", true);
            const coreReqs = coreDocs || [];

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

            set_component_state(ComponentState.SUCCESS);

        } catch (err: any) {
            console.error("fetch_client_details error:", err);
            set_error_message(err.message || "An unexpected error occurred.");
            set_component_state(ComponentState.ERROR);
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
        } catch (err) {
            toast.error("Error downloading document");
        }
    }

    async function handleNotifyAdvisor() {
        if (selected_missing_docs.length === 0) {
            toast.error("Please select at least one document");
            return;
        }

        setIs_notifying(true);
        try {
            const res = await notifyAdvisor(client_id, selected_missing_docs);
            if (res.success) {
                toast.success("Advisor notified successfully!");
                set_is_notify_modal_open(false);
                setSelected_missing_docs([]);
            } else {
                toast.error(res.error || "Failed to notify advisor");
            }
        } finally {
            setIs_notifying(false);
        }
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
                        <div className="py-6 space-y-4">
                            {required_docs.map((doc) => {
                                const is_done = documents.some(d => d.category === doc.code);
                                return (
                                    <div key={doc.code} className="flex items-center space-x-3">
                                        <Checkbox
                                            id={doc.code}
                                            checked={selected_missing_docs.includes(doc.label)}
                                            onCheckedChange={(checked) => {
                                                if (checked) setSelected_missing_docs([...selected_missing_docs, doc.label]);
                                                else setSelected_missing_docs(selected_missing_docs.filter(l => l !== doc.label));
                                            }}
                                        />
                                        <label htmlFor={doc.code} className={clsx("text-sm font-bold leading-none cursor-pointer", is_done ? "text-slate-400 line-through" : "text-slate-700")}>
                                            {doc.label}
                                        </label>
                                    </div>
                                );
                            })}
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => set_is_notify_modal_open(false)} className="rounded-xl font-bold">Cancel</Button>
                            <Button
                                onClick={handleNotifyAdvisor}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-black shadow-lg shadow-emerald-500/20"
                                disabled={is_notifying || selected_missing_docs.length === 0}
                            >
                                {is_notifying ? "Sending..." : "Send Notification"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

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
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Time in Biz</p>
                                    <p className="text-slate-900 font-black">{new Date(client_profile.business_start_date).getFullYear()}</p>
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
                </div>

                {/* Documents Column */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Required Documents Section */}
                    <div className="space-y-4">
                        <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3">
                            <FileText className="w-4 h-4" /> Required Document Packet
                        </h3>
                        <div className="grid gap-4">
                            {required_docs.map((docType) => {
                                const categoryDocs = documents.filter(d => d.category === docType.code);
                                const isUploaded = categoryDocs.length > 0;

                                return (
                                    <Card key={docType.code} className={clsx("rounded-[2rem] transition-all", isUploaded ? "border-emerald-100 bg-emerald-50/20" : "border-slate-100 bg-slate-50/30")}>
                                        <CardContent className="p-6">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-4">
                                                    <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center", isUploaded ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-slate-200 text-slate-400")}>
                                                        {isUploaded ? <ShieldCheck className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                                                    </div>
                                                    <div>
                                                        <h4 className="text-slate-900 font-black uppercase tracking-tighter">{docType.label}</h4>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{isUploaded ? "Ready for inspection" : "Awaiting submission"}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {isUploaded && (
                                                <div className="mt-4 space-y-2 border-t border-emerald-100/50 pt-4">
                                                    {categoryDocs.map(doc => (
                                                        <div key={doc.id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-emerald-100 shadow-sm group">
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <FileText className="w-4 h-4 text-slate-300" />
                                                                <p className="text-sm font-bold text-slate-700 truncate">{doc.custom_label || doc.name}</p>
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => download_document(doc)}
                                                                className="h-8 w-8 p-0 rounded-lg hover:bg-emerald-500 hover:text-white transition-colors"
                                                            >
                                                                <Download className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </div>

                    {/* Uncategorized Documents Section */}
                    {documents.filter(d => !required_docs.some(r => r.code === d.category)).length > 0 && (
                        <div className="space-y-4 pt-4 border-t border-slate-100">
                            <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3">
                                <Plus className="w-4 h-4" /> Additional Context Files
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {documents.filter(d => !required_docs.some(r => r.code === d.category)).map(doc => (
                                    <Card key={doc.id} className="rounded-2xl border-slate-100 bg-white hover:border-emerald-200 transition-colors group">
                                        <CardContent className="p-4 flex items-center justify-between">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-colors">
                                                    <ExternalLink className="w-4 h-4" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-bold text-slate-700 truncate">{doc.custom_label || doc.name}</p>
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase">{doc.category || 'External'}</p>
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => download_document(doc)}
                                                className="h-8 w-8 p-0"
                                            >
                                                <Download className="w-4 h-4" />
                                            </Button>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
