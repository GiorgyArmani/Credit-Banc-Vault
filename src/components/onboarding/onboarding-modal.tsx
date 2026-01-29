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
  const [step, setStep] = useState<"form" | "contract_check">("form");
  const [signWellActive, setSignWellActive] = useState(false);

  // Determine initial step based on completion status
  useEffect(() => {
    if (dataVaultCompleted) {
      if (!contractCompleted) {
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
      // If contract is somehow already done, we are done
      handleOnboardingComplete();
    }
  };

  const handleOnboardingComplete = async () => {
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

  const handleContractComplete = () => {
    setSignWellActive(false); // Show modal again
    handleOnboardingComplete();
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
      </DialogContent>
    </Dialog>
  );
}
