"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle2, RefreshCw, Download } from "lucide-react";
import { toast } from "sonner";

import { PremiumLoader } from "@/components/ui/premium-loader";

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
    const [isWaiting, setIsWaiting] = useState(false);
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
        if (!silent) {
            setChecking(true);
            setIsWaiting(true); // Enter waiting state when manually checking
        }
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
                setIsWaiting(false);
                if (!silent) toast.success("Contract signed successfully!");
            } else if (!silent) {
                // If we were waiting but it's not done yet, maybe show a hint or just stay in waiting
                toast.info("Still waiting for final status...");
            }
        } catch (err) {
            console.error("Error checking status:", err);
        } finally {
            if (!silent) {
                setChecking(false);
                // Don't auto-disable isWaiting here if not completed, 
                // let the user see the loader for a bit longer or wait for the next poll
                // Actually, if it's NOT completed, we should probably stop the "foreground" waiting 
                // so they can see the "I've Signed It" button again if they want.
                // But the requirement says "While status is not complete, keep showing the loader"
                // So if they click "I've Signed It", we should probably keep them in isWaiting until detected.
            }
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
            if (onSignWellOpen) onSignWellOpen();

            const embed = new window.SignWellEmbed({
                url: contractUrl,
                allowClose: false,
                events: {
                    completed: (e: any) => {
                        console.log("✅ SignWell Document Completed:", e);
                        setIsWaiting(true);
                        if (onSignWellClose) onSignWellClose();
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

    // Unified Premium Loader for different states
    if (isWaiting || !contractUrl) {
        return (
            <div className="h-full w-full flex items-center justify-center min-h-[500px]">
                <PremiumLoader
                    fullScreen={false}
                    message={!contractUrl ? "Preparing your personalized agreement..." : "Finalizing your signed document..."}
                />
            </div>
        );
    }

    return (
        <div className="w-full max-w-2xl mx-auto py-8">
            <div className="text-center mb-10">
                <div className="h-16 w-16 bg-blue-100/50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                    {contractCompleted ? (
                        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                    ) : (
                        <CheckCircle2 className="h-8 w-8" />
                    )}
                </div>

                <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-emerald-600 mb-3">
                    {contractCompleted ? "Congratulations!" : "Sign Your Contract"}
                </CardTitle>

                <CardDescription className="text-lg max-w-md mx-auto text-gray-600">
                    {contractCompleted
                        ? "Your agreement is now finalized. Please download your copy below to complete your onboarding."
                        : "Your personalized agreement is ready. Click below to review and sign it securely through SignWell."
                    }
                </CardDescription>
            </div>

            <div className={`bg-white border rounded-2xl p-8 shadow-md mb-8 flex flex-col items-center justify-center min-h-[250px] transition-all duration-500 ${contractCompleted ? "border-emerald-200 bg-emerald-50/10" : "border-blue-100"}`}>
                <div className="w-full max-w-md space-y-6">
                    {!contractCompleted && (
                        <Button
                            size="lg"
                            className="w-full text-lg h-14 bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all hover:scale-[1.02]"
                            onClick={handleSignClick}
                            disabled={!embedLoaded}
                        >
                            {embedLoaded ? "Review & Sign Document" : "Loading Embed..."}
                        </Button>
                    )}

                    {contractCompleted && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700">
                            <Button
                                size="lg"
                                variant="outline"
                                className="w-full text-lg h-14 border-2 border-emerald-600 text-emerald-600 hover:bg-emerald-50 font-bold transition-all hover:scale-[1.02]"
                                onClick={handleDownload}
                                disabled={downloading}
                            >
                                {downloading ? (
                                    <>
                                        <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                                        Downloading...
                                    </>
                                ) : (
                                    <>
                                        <Download className="mr-3 h-6 w-6" />
                                        Download Signed Contract
                                    </>
                                )}
                            </Button>

                            {downloaded && (
                                <p className="text-center text-emerald-600 font-medium flex items-center justify-center animate-in zoom-in duration-300">
                                    <CheckCircle2 className="mr-2 h-4 w-4" /> Download Complete
                                </p>
                            )}
                        </div>
                    )}

                    {!contractCompleted && (
                        <p className="text-sm text-center text-gray-400">
                            Securely powered by <span className="font-semibold">SignWell</span>
                        </p>
                    )}
                </div>
            </div>

            <div className="text-center">
                {contractCompleted ? (
                    <div className="space-y-5">
                        <Button
                            onClick={onComplete}
                            size="lg"
                            disabled={!downloaded}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-14 px-10 shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-[1.05]"
                        >
                            Complete Onboarding & Go to Dashboard →
                        </Button>
                        {!downloaded && (
                            <p className="text-sm text-gray-500 italic">
                                Please download your contract to continue
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center space-y-4">
                        <p className="text-sm text-gray-500 font-medium">Already signed the document?</p>
                        <Button
                            onClick={() => checkStatus(false)}
                            disabled={checking}
                            variant="ghost"
                            className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 underline decoration-2 underline-offset-4"
                        >
                            {checking ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Checking Status...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    I've already signed it
                                </>
                            )}
                        </Button>
                    </div>
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
