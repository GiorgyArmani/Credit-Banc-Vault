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
        // If vault is done, we are either signing or downloading/finishing.
        setStep("contract_check");

        // Final redirection to dashboard ONLY if metadata confirms completion.
        if (!needsOnboarding) {
          router.push("/dashboard");
        }
      } else {
        setStep("form");
      }
    }
  }, [loading, dataVaultCompleted, needsOnboarding, router]);

  const handleFormComplete = async () => {
    await refetch();
    // After form, always go to contract step.
    setStep("contract_check");
  };

  const handleOnboardingComplete = async () => {
    setIsFinishing(true);
    try {
      await fetch('/api/onboarding/complete', { method: 'POST' });
      window.dispatchEvent(new Event("onboarding-completed"));
      sessionStorage.removeItem("skipOnboarding");
      router.push("/dashboard?tour=true");
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
    <main className="min-h-screen bg-[#f0fdf7] relative overflow-hidden flex flex-col items-center justify-center p-4 md:p-8">
      {/* aurora-glow effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/50 via-white/80 to-white pointer-events-none" />
      <div className="absolute top-0 left-1/4 w-[60%] h-[60%] bg-emerald-300/10 blur-[130px] rounded-full animate-aurora pointer-events-none" />

      <div className="w-full max-w-4xl relative z-10">
        <motion.div
          key="onboarding-card"
          initial={{ opacity: 0, y: 20 }}
          animate={signWellActive ? {
            opacity: 0,
            scale: 0.95,
            transitionEnd: { display: 'none' }
          } : {
            opacity: 1,
            scale: 1,
            display: 'block'
          }}
          transition={{ duration: 0.4 }}
          className="bg-white border border-emerald-100 rounded-[3rem] shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-10 md:p-14 border-b border-emerald-50 bg-white">
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-emerald-950 uppercase">
              {step === "form" ? "Business Profile" : "Contract Signing"}
            </h1>
            <p className="text-emerald-900/40 mt-4 text-xl font-bold">
              {step === "form"
                ? "Let's start by getting some details about your business."
                : "Almost there! Please review and sign your service agreement."}
            </p>

            {/* Progress indicator */}
            <div className="flex gap-3 mt-10">
              <div className={`h-2 flex-1 rounded-full transition-all duration-700 ${step === "form" ? "bg-emerald-500 shadow-lg shadow-emerald-500/20" : "bg-emerald-500/20"}`} />
              <div className={`h-2 flex-1 rounded-full transition-all duration-700 ${step === "contract_check" ? "bg-emerald-500 shadow-lg shadow-emerald-500/20" : "bg-emerald-100"}`} />
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

        {/* Support / Help text - also hide during signing to keep view clear */}
        {!signWellActive && (
          <p className="mt-10 text-center text-emerald-900/40 text-sm font-bold tracking-tight">
            Need help? Contact our support team at{" "}
            <a
              href="mailto:support@creditbanc.io"
              className="text-emerald-600 underline hover:text-emerald-700 transition"
            >
              support@creditbanc.io
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
