"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DataVaultForm } from "@/components/onboarding/data-vault-form";
import { ContractCheckStep } from "@/components/onboarding/contract-check-step";
import { useOnboardingStatus } from "@/components/onboarding/use-onboarding-status";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { motion, AnimatePresence } from "framer-motion";

export default function OnboardingPage() {
  const router = useRouter();
  const { needsOnboarding, dataVaultCompleted, contractCompleted, loading, refetch } = useOnboardingStatus();
  const [step, setStep] = useState<"form" | "contract_check">("form");
  const [signWellActive, setSignWellActive] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  // Determine initial step based on completion status
  useEffect(() => {
    if (!loading) {
      if (dataVaultCompleted) {
        if (!contractCompleted) {
          setStep("contract_check");
        } else if (needsOnboarding) {
          // Both steps are done but metadata is not. Trigger completion.
          handleOnboardingComplete();
        } else {
          // Everything is done, including metadata. Clean path to dashboard.
          router.push("/dashboard");
        }
      } else {
        setStep("form");
      }
    }
  }, [loading, dataVaultCompleted, contractCompleted, needsOnboarding, router]);

  const handleFormComplete = async () => {
    await refetch();
    if (!contractCompleted) {
      setStep("contract_check");
    } else {
      handleOnboardingComplete();
    }
  };

  const handleOnboardingComplete = async () => {
    setIsFinishing(true);
    try {
      await fetch('/api/onboarding/complete', { method: 'POST' });
      window.dispatchEvent(new Event("onboarding-completed"));
      sessionStorage.removeItem("skipOnboarding");
      router.push("/dashboard");
    } catch (error) {
      console.error("Error completing onboarding:", error);
      setIsFinishing(false);
    }
  };

  const handleContractComplete = () => {
    setSignWellActive(false);
    handleOnboardingComplete();
  };

  if (loading || isFinishing) {
    return (
      <div className="fixed inset-0 z-50">
        <PremiumLoader
          fullScreen={true}
          message={isFinishing ? "Finalizing your setup..." : "Preparing your onboarding..."}
        />
      </div>
    );
  }

  // If they don't need onboarding anymore, redirect (handled by useEffect, but safety return)
  if (!needsOnboarding && !loading) {
    return null;
  }

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-4xl relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-8 border-b border-border bg-muted/30">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {step === "form" ? "Business Profile" : "Contract Signing"}
            </h1>
            <p className="text-muted-foreground mt-2 text-lg">
              {step === "form"
                ? "Let's start by getting some details about your business."
                : "Almost there! Please review and sign your service agreement."}
            </p>

            {/* Progress indicator */}
            <div className="flex gap-2 mt-6">
              <div className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${step === "form" ? "bg-primary" : "bg-primary/40"}`} />
              <div className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${step === "contract_check" ? "bg-primary" : "bg-muted"}`} />
            </div>
          </div>

          {/* Content Area */}
          <div className="p-6 md:p-8">
            {step === "form" && (
              <DataVaultForm onComplete={handleFormComplete} />
            )}

            {step === "contract_check" && (
              <div className="h-full">
                <ContractCheckStep
                  onComplete={handleContractComplete}
                  onSignWellOpen={() => setSignWellActive(true)}
                  onSignWellClose={() => setSignWellActive(false)}
                />
              </div>
            )}
          </div>
        </motion.div>

        {/* Support / Help text */}
        <p className="mt-8 text-center text-muted-foreground text-sm">
          Need help? Contact our support team at <span className="text-primary font-medium">support@creditbanc.io</span>
        </p>
      </div>
    </main>
  );
}
