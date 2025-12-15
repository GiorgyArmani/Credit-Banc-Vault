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

type OnboardingModalProps = {
  open: boolean;
  onClose?: () => void;
  dataVaultCompleted?: boolean;
};

export default function OnboardingModal({
  open,
  onClose,
  dataVaultCompleted = false,
}: OnboardingModalProps) {
  const [step, setStep] = useState<"form" | "video">("form");

  // Skip to video step if data vault is already completed
  useEffect(() => {
    if (dataVaultCompleted) {
      setStep("video");
    } else {
      setStep("form");
    }
  }, [dataVaultCompleted]);

  const handleFormComplete = () => {
    setStep("video");
  };

  const handleVideoComplete = () => {
    // Emit event to close the modal
    window.dispatchEvent(new Event("onboarding-completed"));
    // Clear session storage to skip next time
    sessionStorage.removeItem("skipOnboarding");

    // Refresh the page to ensure all components (like profile-display) update with new data
    window.location.reload();

    // Close the modal (though reload will likely happen first)
    onClose?.();
  };

  // Prevent closing if on form step
  const handleOpenChange = (v: boolean) => {
    if (!v && step === "form") return; // Block closing on form step
    if (!v && onClose) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl w-full p-0 overflow-hidden bg-background border-border max-h-[90vh] overflow-y-auto">
        {step === "form" && (
          <div className="p-6">
            {/* DataVaultForm handles its own header/title */}
            <DataVaultForm onComplete={handleFormComplete} />
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
                  poster="/placeholder-video-poster.jpg"
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
