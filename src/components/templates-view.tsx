"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2, AlertCircle } from "lucide-react";
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
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            </div>
        );
    }

    if (error) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        );
    }

    if (templates.length === 0) {
        return (
            <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-gray-900">No templates available</h3>
                <p className="text-sm text-gray-500">Check back later for new documents.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
                <Card key={template.id} className="flex flex-col h-full hover:shadow-md transition-shadow">
                    <CardHeader>
                        <div className="flex items-start justify-between">
                            <div className="p-2 bg-emerald-100 rounded-lg">
                                <FileText className="h-6 w-6 text-emerald-600" />
                            </div>
                            {template.is_premium && (
                                <span className="px-2 py-1 text-xs font-semibold bg-amber-100 text-amber-700 rounded-full">
                                    Premium
                                </span>
                            )}
                        </div>
                        <CardTitle className="mt-4 text-lg">{template.title}</CardTitle>
                        <CardDescription className="line-clamp-2">
                            {template.description}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto pt-0">
                        <Button
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                            onClick={() => handleDownload(template)}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            Download
                        </Button>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
