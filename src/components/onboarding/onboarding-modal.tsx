"use client";

import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { ArrowRight } from "lucide-react";
import { DataVaultForm } from "@/components/onboarding/data-vault-form";
import { ContractCheckStep } from "@/components/onboarding/contract-check-step";

type OnboardingModalProps = {
  open: boolean;
  onClose?: () => void;
  dataVaultCompleted?: boolean;
  contractCompleted?: boolean;
};

export default function OnboardingModal({
  open,
  onClose,
  dataVaultCompleted = false,
  contractCompleted = false,
}: OnboardingModalProps) {
  const [step, setStep] = useState<"form" | "contract_check" | "video">("form");
  const [signWellActive, setSignWellActive] = useState(false);

  // Determine initial step based on completion status
  useEffect(() => {
    if (dataVaultCompleted) {
      if (contractCompleted) {
        setStep((current) => {
          // If we are already on contract_check, wait for manual "Continue"
          if (current === "contract_check") return current;
          return "video";
        });
      } else {
        setStep("contract_check");
      }
    } else {
      setStep("form");
    }
  }, [dataVaultCompleted, contractCompleted]);

  const handleFormComplete = () => {
    if (!contractCompleted) {
      setStep("contract_check");
    } else {
      setStep("video");
    }
  };

  const handleContractComplete = () => {
    setSignWellActive(false); // Show modal again
    setStep("video");
  };

  const handleVideoComplete = async () => {
    try {
      await fetch('/api/onboarding/complete', { method: 'POST' });
      window.dispatchEvent(new Event("onboarding-completed"));
      sessionStorage.removeItem("skipOnboarding");
      window.location.reload();
      onClose?.();
    } catch (error) {
      console.error("Error completing onboarding:", error);
    }
  };

  const handleOpenChange = (v: boolean) => {
    if (!v && (step === "form" || step === "contract_check")) return;
    if (!v && onClose) onClose();
  };

  const handleSignWellOpen = () => {
    setSignWellActive(true); // Hide modal when SignWell opens
  };

  const handleSignWellClose = () => {
    setSignWellActive(false); // Show modal again when SignWell closes
  };

  return (
    <Dialog open={open && !signWellActive} onOpenChange={handleOpenChange}>
      <DialogContent className={`w-full p-0 overflow-hidden bg-background border-border ${step === "contract_check" ? "max-w-[95vw] max-h-[95vh]" : "max-w-4xl max-h-[90vh]"
        } overflow-y-auto`}>
        {step === "form" && (
          <div className="p-6">
            <DataVaultForm onComplete={handleFormComplete} />
          </div>
        )}

        {step === "contract_check" && (
          <div className="p-6 h-full">
            <ContractCheckStep
              onComplete={handleContractComplete}
              onSignWellOpen={handleSignWellOpen}
              onSignWellClose={handleSignWellClose}
            />
          </div>
        )}

        {step === "video" && (
          <>
            <DialogHeader className="px-6 pt-6 pb-2">
              <DialogTitle className="text-foreground">Welcome to Credit Banc Vault</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Watch this quick tutorial to learn how to get the most out of our platform.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center justify-center p-6 space-y-6">
              <div className="w-full aspect-video bg-muted rounded-lg overflow-hidden relative shadow-lg border border-border">
                <video
                  className="w-full h-full object-cover"
                  controls
                  autoPlay
                >
                  <source src="https://vowcnxlmahbildgsreso.supabase.co/storage/v1/object/sign/public%20videos/riverside_2025_11%2025%2019%2054%2059.mp4%20magic%20episode%20_%20nov%2026%2C%202_the_weekly%20recap.mp4?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9iNmYyMTI4MC04NmY3LTQ3NDgtYTUxZC02M2RhNmRmNjBiYzQiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJwdWJsaWMgdmlkZW9zL3JpdmVyc2lkZV8yMDI1XzExIDI1IDE5IDU0IDU5Lm1wNCBtYWdpYyBlcGlzb2RlIF8gbm92IDI2LCAyX3RoZV93ZWVrbHkgcmVjYXAubXA0IiwiaWF0IjoxNzY0MTI2MjI5LCJleHAiOjIwNzk0ODYyMjl9.Ik77t63UnAnbZF9P0F8zcGV8uX0a7Jyq_gSCVKQUAEo" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>

              <div className="flex w-full justify-end items-center">
                <Button
                  size="lg"
                  onClick={handleVideoComplete}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >
                  Get Started <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
