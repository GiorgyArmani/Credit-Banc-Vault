"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Template {
    id: string;
    title: string;
    description: string;
    category: string;
    file_url: string;
    is_premium: boolean;
}

export default function TemplatesView() {
    const supabase = createClient();
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchTemplates();
    }, []);

    const fetchTemplates = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from("templates")
                .select("*")
                .order("title");

            if (error) throw error;
            setTemplates(data || []);
        } catch (err: any) {
            console.error("Error fetching templates:", err);
            setError("Failed to load templates. Please try again later.");
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = (template: Template) => {
        window.open(template.file_url, "_blank");
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive" className="rounded-[2rem] border-red-100 bg-red-50 p-6">
                <AlertCircle className="h-6 w-6 text-red-500" />
                <AlertTitle className="text-red-900 font-black uppercase tracking-tighter text-lg ml-2">Error</AlertTitle>
                <AlertDescription className="text-red-700 font-bold ml-2">{error}</AlertDescription>
            </Alert>
        );
    }

    if (templates.length === 0) {
        return (
            <div className="text-center py-20 bg-emerald-50/50 rounded-[3rem] border-2 border-dashed border-emerald-100/50">
                <div className="bg-white h-20 w-20 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-sm">
                    <FileText className="h-10 w-10 text-emerald-200" />
                </div>
                <h3 className="text-2xl font-black text-emerald-950 uppercase tracking-tighter">No Templates Available</h3>
                <p className="text-emerald-900/40 font-bold mt-2">Check back later for new documents.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {templates.map((template) => (
                <Card key={template.id} className="flex flex-col h-full rounded-[2.5rem] border-emerald-50 bg-white/50 backdrop-blur-sm hover:shadow-2xl hover:shadow-emerald-500/5 transition-all duration-500 group overflow-hidden border-2 hover:border-emerald-100">
                    <CardHeader className="p-8">
                        <div className="flex items-start justify-between">
                            <div className="p-4 bg-emerald-50 rounded-[1.25rem] border border-emerald-100 group-hover:bg-emerald-500 group-hover:text-white transition-all duration-500">
                                <FileText className="h-6 w-6" />
                            </div>
                            {template.is_premium && (
                                <span className="px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] bg-emerald-950 text-white rounded-full">
                                    Premium
                                </span>
                            )}
                        </div>
                        <CardTitle className="mt-6 text-xl font-black text-emerald-950 uppercase tracking-tighter leading-tight">
                            {template.title}
                        </CardTitle>
                        <CardDescription className="line-clamp-2 text-emerald-900/40 font-bold text-sm mt-2">
                            {template.description}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto p-8 pt-0">
                        <Button
                            className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/10 transition-all active:scale-95 group/btn"
                            onClick={() => handleDownload(template)}
                        >
                            <Download className="h-4 w-4 mr-2 transition-transform group-hover/btn:-translate-y-1" />
                            <span>Download Template</span>
                            <ArrowRight className="h-4 w-4 ml-auto opacity-0 -translate-x-2 group-hover/btn:opacity-100 group-hover/btn:translate-x-0 transition-all" />
                        </Button>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
