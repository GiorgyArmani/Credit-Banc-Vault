"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Loader2, Mail, CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface ContractCheckStepProps {
    onComplete: () => void;
}

export function ContractCheckStep({ onComplete }: ContractCheckStepProps) {
    const [checking, setChecking] = useState(false);
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const supabase = createClient();

    useEffect(() => {
        // Get user email for display
        (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email) setUserEmail(user.email);
        })();
    }, [supabase]);

    // Polling effect
    useEffect(() => {
        let mounted = true;
        const interval = setInterval(async () => {
            if (!mounted) return;
            await checkStatus(true); // Silent check
        }, 5000);

        return () => {
            mounted = false;
            clearInterval(interval);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const checkStatus = async (silent = false) => {
        if (!silent) setChecking(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data, error } = await supabase
                .from("client_data_vault")
                .select("contract_completed")
                .eq("user_id", user.id)
                .single();

            if (error) {
                if (!silent) console.error("Error checking contract status:", error);
                return;
            }

            if (data?.contract_completed) {
                if (!silent) toast.success("Contract signed successfully!");
                onComplete();
            } else {
                if (!silent) toast.info("Contract not yet completed. Please check your email.");
            }
        } catch (err) {
            console.error("Error checking status:", err);
        } finally {
            if (!silent) setChecking(false);
        }
    };

    const openEmailProvider = (provider: string) => {
        let url = "";
        if (provider === "gmail") url = "https://mail.google.com";
        if (provider === "outlook") url = "https://outlook.live.com";
        if (url) window.open(url, "_blank");
    };

    return (
        <div className="w-full max-w-2xl mx-auto py-8">
            <div className="text-center mb-8">
                <div className="h-12 w-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Mail className="h-6 w-6" />
                </div>
                <CardTitle className="text-2xl mb-2">Check Your Email</CardTitle>
                <CardDescription className="text-base max-w-md mx-auto">
                    We've sent a SignWell contract to <strong>{userEmail || "your email"}</strong>.
                    <br />
                    Please sign this document to complete your onboarding and access the vault.
                </CardDescription>
            </div>

            <div className="bg-white border rounded-xl p-6 shadow-sm mb-6">
                <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    Waiting for signature...
                </h3>
                <p className="text-sm text-gray-500 mb-6">
                    Once you sign the document, this page will automatically update.
                </p>

                <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => openEmailProvider("gmail")}
                    >
                        Open Gmail
                    </Button>
                    <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => openEmailProvider("outlook")}
                    >
                        Open Outlook
                    </Button>
                </div>
            </div>

            <div className="text-center">
                <p className="text-sm text-gray-500 mb-4">Already signed it?</p>
                <Button
                    onClick={() => checkStatus(false)}
                    disabled={checking}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                    {checking ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Checking...
                        </>
                    ) : (
                        <>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            I've Signed It
                        </>
                    )}
                </Button>
            </div>
            {process.env.NODE_ENV === "development" && (
                <div className="mt-8 pt-8 border-t">
                    <p className="text-xs text-muted-foreground mb-2">Development Mode Only</p>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                            setChecking(true);
                            await fetch("/api/onboarding/bypass-contract", { method: "POST" });
                            await checkStatus(false);
                            setChecking(false);
                        }}
                        className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                    >
                        Simulate Signature (Bypass)
                    </Button>
                </div>
            )}
        </div>
    );
}
