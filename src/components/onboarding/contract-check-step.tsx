"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle2, RefreshCw, Download } from "lucide-react";
import { toast } from "sonner";

interface ContractCheckStepProps {
    onComplete: () => void;
    onSignWellOpen?: () => void;
    onSignWellClose?: () => void;
}

declare global {
    interface Window {
        SignWellEmbed: any;
    }
}

export function ContractCheckStep({ onComplete, onSignWellOpen, onSignWellClose }: ContractCheckStepProps) {
    const [checking, setChecking] = useState(false);
    const [contractUrl, setContractUrl] = useState<string | null>(null);
    const [embedLoaded, setEmbedLoaded] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [downloaded, setDownloaded] = useState(false);
    const [contractCompleted, setContractCompleted] = useState(false);
    const supabase = createClient();

    // Load SignWell Embed Script
    useEffect(() => {
        const script = document.createElement("script");
        script.src = "https://static.signwell.com/assets/embedded.js";
        script.async = true;
        script.onload = () => {
            console.log("✅ SignWell Embed script loaded");
            setEmbedLoaded(true);
        };
        script.onerror = () => console.error("❌ Failed to load SignWell Embed script");
        document.body.appendChild(script);

        return () => {
            if (document.body.contains(script)) {
                document.body.removeChild(script);
            }
        };
    }, []);

    // Polling effect & Generation trigger
    useEffect(() => {
        let mounted = true;

        const init = async () => {
            await checkStatus(true);
            setTimeout(async () => {
                if (mounted && !contractUrl && !checking) {
                    await generateContract();
                }
            }, 1000);
        };

        init();

        const interval = setInterval(async () => {
            if (!mounted) return;
            await checkStatus(true);
        }, 3000);

        return () => {
            mounted = false;
            clearInterval(interval);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const generateContract = async () => {
        try {
            const res = await fetch('/api/onboarding/generate-contract', { method: 'POST' });
            const data = await res.json();
            if (data.contractUrl) {
                setContractUrl(data.contractUrl);
            }
        } catch (error) {
            console.error("Error generating contract:", error);
        }
    };

    const checkStatus = async (silent = false) => {
        if (!silent) setChecking(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data, error } = await supabase
                .from("client_data_vault")
                .select("contract_completed, contract_url")
                .eq("user_id", user.id)
                .single();

            if (error) {
                if (!silent) console.error("Error checking contract status:", error);
                return;
            }

            if (data?.contract_url) {
                setContractUrl(data.contract_url);
            }

            if (data?.contract_completed) {
                setContractCompleted(true);
                if (!silent) toast.success("Contract signed successfully!");
                // Don't auto-proceed - let user download first
            }
        } catch (err) {
            console.error("Error checking status:", err);
        } finally {
            if (!silent) setChecking(false);
        }
    };

    const handleSignClick = () => {
        if (!contractUrl) {
            toast.error("Contract URL not available");
            return;
        }

        if (!embedLoaded || !window.SignWellEmbed) {
            console.warn("SignWell Embed not loaded, opening in new tab");
            window.open(contractUrl, "_blank");
            return;
        }

        try {
            // Hide the onboarding modal before opening SignWell
            if (onSignWellOpen) onSignWellOpen();

            const embed = new window.SignWellEmbed({
                url: contractUrl,
                allowClose: false,
                events: {
                    completed: (e: any) => {
                        console.log("✅ SignWell Document Completed:", e);
                        toast.success("Contract signed successfully!");
                        checkStatus(false); // Just update status, don't proceed
                    },
                    closed: (e: any) => {
                        console.log("ℹ️ SignWell Closed:", e);
                        if (onSignWellClose) onSignWellClose();
                        checkStatus(true);
                    },
                    error: (e: any) => {
                        console.error("❌ SignWell Error:", e);
                        toast.error("There was an error loading the document.");
                    }
                }
            });
            embed.open();
        } catch (error) {
            console.error("Error opening SignWell embed:", error);
            toast.error("Failed to open signing modal");
        }
    };

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const res = await fetch('/api/onboarding/download-contract');
            const data = await res.json();

            if (data.downloadUrl) {
                // Open download URL in new tab
                window.open(data.downloadUrl, '_blank');
                setDownloaded(true);
                toast.success("Contract download started!");
            } else {
                toast.error("Failed to get download link");
            }
        } catch (error) {
            console.error("Error downloading contract:", error);
            toast.error("Failed to download contract");
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="w-full max-w-2xl mx-auto py-8">
            <div className="text-center mb-8">
                <div className="h-12 w-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    {contractUrl ? <CheckCircle2 className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
                </div>

                <CardTitle className="text-2xl mb-2">
                    {contractUrl ? "Sign Your Contract" : "Preparing Your Contract"}
                </CardTitle>

                <CardDescription className="text-base max-w-md mx-auto">
                    {contractUrl
                        ? "Your personalized agreement is ready. Click below to review and sign."
                        : "We are generating your personalized agreement. This usually takes less than a minute..."
                    }
                </CardDescription>
            </div>

            <div className="bg-white border rounded-xl p-6 shadow-sm mb-6 flex flex-col items-center justify-center min-h-[200px]">
                {contractUrl ? (
                    <div className="w-full max-w-md space-y-4">
                        <Button
                            size="lg"
                            className="w-full text-lg h-12 bg-blue-600 hover:bg-blue-700"
                            onClick={handleSignClick}
                            disabled={!embedLoaded || contractCompleted}
                        >
                            {embedLoaded ? (contractCompleted ? "✓ Signed" : "Review & Sign") : "Loading..."}
                        </Button>
                        {contractCompleted && (
                            <Button
                                size="lg"
                                variant="outline"
                                className="w-full text-lg h-12 border-emerald-600 text-emerald-600 hover:bg-emerald-50"
                                onClick={handleDownload}
                                disabled={downloading}
                            >
                                {downloading ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        Downloading...
                                    </>
                                ) : (
                                    <>
                                        <Download className="mr-2 h-5 w-5" />
                                        Download Signed Contract
                                    </>
                                )}
                            </Button>
                        )}
                        <p className="text-xs text-center text-gray-500">
                            {embedLoaded ? (contractCompleted ? "Contract signed successfully!" : "Opens in a secure signing window") : "Preparing signing interface..."}
                        </p>
                    </div>
                ) : (
                    <div className="text-center space-y-3">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" />
                        <p className="text-sm text-gray-500">
                            Waiting for contract...
                        </p>
                    </div>
                )}
            </div>

            <div className="text-center">
                {contractCompleted ? (
                    <>
                        <p className="text-sm text-gray-500 mb-4">Ready to continue?</p>
                        <Button
                            onClick={onComplete}
                            size="lg"
                            disabled={!downloaded}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {downloaded ? "Continue to Next Step →" : "Download Contract to Continue"}
                        </Button>
                    </>
                ) : (
                    <>
                        <p className="text-sm text-gray-500 mb-4">Already signed it?</p>
                        <Button
                            onClick={() => checkStatus(false)}
                            disabled={checking}
                            variant="outline"
                            className="border-emerald-600 text-emerald-600 hover:bg-emerald-50"
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
                    </>
                )}
            </div>

            {process.env.NODE_ENV === "development" && (
                <div className="mt-8 pt-8 border-t">
                    <p className="text-xs text-muted-foreground mb-2">Development Mode Only</p>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                            setChecking(true);
                            const { data: { user } } = await supabase.auth.getUser();
                            if (user) {
                                await supabase
                                    .from('client_data_vault')
                                    .update({ contract_url: 'https://www.signwell.com/docs/test' })
                                    .eq('user_id', user.id);
                                await checkStatus(false);
                            }
                            setChecking(false);
                        }}
                        className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                    >
                        Simulate Link Generation
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                            if (!window.confirm("Reset contract? This will clear the current contract URL.")) return;
                            setChecking(true);
                            const { data: { user } } = await supabase.auth.getUser();
                            if (user) {
                                await supabase
                                    .from('client_data_vault')
                                    .update({ contract_url: null, contract_completed: false })
                                    .eq('user_id', user.id);
                                setContractUrl(null);
                                setContractCompleted(false);
                                await checkStatus(false);
                                window.location.reload();
                            }
                            setChecking(false);
                        }}
                        className="ml-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                        Reset Contract
                    </Button>
                </div>
            )}
        </div>
    );
}
