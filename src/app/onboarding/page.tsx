"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DataVaultForm } from "@/components/onboarding/data-vault-form";
import { ContractCheckStep } from "@/components/onboarding/contract-check-step";
import { SetPasswordStep } from "@/components/onboarding/set-password-step";
import { useOnboardingStatus } from "@/components/onboarding/use-onboarding-status";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { motion } from "framer-motion";
import { BrandBackdrop, Eyebrow } from "@/components/marketing/brand-chrome";
import { EASE } from "@/lib/motion";

export default function OnboardingPage() {
  const router = useRouter();
  const { needsOnboarding, dataVaultCompleted, contractCompleted, loading, refetch } = useOnboardingStatus();
  const [step, setStep] = useState<"form" | "contract_check" | "set_password">("form");
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
    // Contract signed → final step: the client creates their own password
    // (replacing the temporary one the magic link logged them in with).
    setStep("set_password");
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
    <main className="min-h-screen bg-cb-cream font-body text-cb-ink relative overflow-hidden flex flex-col items-center justify-center p-4 md:p-8">
      <BrandBackdrop />

      <div className="w-full max-w-4xl relative z-10">
        <motion.div
          key="onboarding-card"
          initial={{ opacity: 0, y: 24 }}
          animate={signWellActive ? {
            opacity: 0,
            scale: 0.95,
            transitionEnd: { display: 'none' }
          } : {
            opacity: 1,
            scale: 1,
            display: 'block'
          }}
          transition={{ duration: 0.4, ease: EASE }}
          className="overflow-hidden rounded-3xl border border-black/5 bg-white shadow-xl"
        >
          {/* Header */}
          <div className="border-b border-black/5 p-8 md:p-12">
            <Eyebrow className="mb-4">
              {step === "form"
                ? "Step 1 of 3"
                : step === "contract_check"
                  ? "Step 2 of 3"
                  : "Step 3 of 3"}
            </Eyebrow>
            <h1 className="font-headline text-4xl font-extrabold leading-tight tracking-tight text-cb-ink md:text-5xl">
              {step === "form"
                ? "Business Profile"
                : step === "contract_check"
                  ? "Application Signing"
                  : "Create Your Password"}
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-cb-ink/60">
              {step === "form"
                ? "Let's start by getting some details about your business."
                : step === "contract_check"
                  ? "Almost there. Review and sign your funding application."
                  : "Last step. Secure your account with a password of your own."}
            </p>

            {/* Progress indicator */}
            <div className="mt-10 flex gap-3">
              <div className={`h-2 flex-1 rounded-full transition-all duration-700 ${step === "form" ? "bg-cb-mint" : "bg-cb-mint/30"}`} />
              <div className={`h-2 flex-1 rounded-full transition-all duration-700 ${step === "contract_check" ? "bg-cb-mint" : step === "set_password" ? "bg-cb-mint/30" : "bg-black/5"}`} />
              <div className={`h-2 flex-1 rounded-full transition-all duration-700 ${step === "set_password" ? "bg-cb-mint" : "bg-black/5"}`} />
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

            {step === "set_password" && (
              <SetPasswordStep onComplete={handleOnboardingComplete} />
            )}
          </div>
        </motion.div>

        {/* Support / Help text - also hide during signing to keep view clear */}
        {!signWellActive && (
          <p className="mt-10 text-center text-sm text-cb-ink/50">
            Need help? Contact our support team at{" "}
            <a
              href="mailto:support@creditbanc.io"
              className="font-bold text-cb-mint hover:underline"
            >
              support@creditbanc.io
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
