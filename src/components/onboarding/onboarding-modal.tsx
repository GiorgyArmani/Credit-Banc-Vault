"use client";

import { useState } from "react";
import { steps, type Step, type BusinessProfile } from "./steps";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { ArrowRight, ArrowLeft, CheckCircle } from "lucide-react";

type OnboardingModalProps = {
  open: boolean;
  onClose?: () => void;
  onSkipThisSession?: () => void;
};

export default function OnboardingModal({
  open,
  onClose,
  onSkipThisSession,
}: OnboardingModalProps) {
  // const [currentStep, setCurrentStep] = useState(0);
  // const [profile, setProfile] = useState<Partial<BusinessProfile>>({});
  const supabase = createClient();
  const router = useRouter();
  // const step: Step | undefined = steps[currentStep];
  // const progress = steps.length > 0 ? ((currentStep + 1) / steps.length) * 100 : 0;
  // if (!step) return null;

  // const handleChange = (key: keyof BusinessProfile, value: string) => {
  //   setProfile((prev) => ({ ...prev, [key]: value }));
  // };

  // const isStepValid = () =>
  //   step.fields.filter((f) => f.required).every((f) => !!profile[f.key]);

  const handleComplete = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Minimal profile to satisfy the constraint or just mark as completed
    // We might need to adjust the table constraints if these fields are strictly required
    // For now, I'll send a dummy completed profile or just the completion flag if the schema allows
    // Looking at the previous code, it seems we were sending a full profile.
    // Let's assume for now we just want to mark it as done.
    // If the DB requires fields, we might need to send defaults or make them nullable in DB.
    // Based on previous code, they were optional in the interface but some required in UI.
    // Let's try to upsert just the completion info.

    const finalProfile: Partial<BusinessProfile> = {
      // business_name: profile.business_name ?? undefined,
      // ...
      completion_level: 100,
      completed_categories: ["video_tutorial"], // Changed from ["basic", "goals", "financial"]
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("business_profiles")
      .upsert({ user_id: user.id, ...finalProfile }, { onConflict: "user_id" });

    if (error) {
      console.error("Error saving profile:", error);
      return;
    }
    // Emit event to close the modal
    window.dispatchEvent(new Event("onboarding-completed"));
    // Clear session storage to skip next time
    sessionStorage.removeItem("skipOnboarding");
    // refresca para que el Gate detecte completion y cierre
    router.refresh();
    onClose?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-4xl w-full p-0 overflow-hidden bg-background border-border">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-foreground">Welcome to Credit Banc Vault</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Watch this quick tutorial to learn how to get the most out of our platform.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center p-6 space-y-6">
          <div className="w-full aspect-video bg-muted rounded-lg overflow-hidden relative shadow-lg border border-border">
            {/* Placeholder for Video - Replace src with actual Supabase URL */}
            <video
              className="w-full h-full object-cover"
              controls
              autoPlay
              // src="YOUR_SUPABASE_VIDEO_URL_HERE"
              poster="/placeholder-video-poster.jpg" // Optional: Add a poster image
            >
              <source src="https://vowcnxlmahbildgsreso.supabase.co/storage/v1/object/sign/public%20videos/riverside_2025_11%2025%2019%2054%2059.mp4%20magic%20episode%20_%20nov%2026%2C%202_the_weekly%20recap.mp4?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV9iNmYyMTI4MC04NmY3LTQ3NDgtYTUxZC02M2RhNmRmNjBiYzQiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJwdWJsaWMgdmlkZW9zL3JpdmVyc2lkZV8yMDI1XzExIDI1IDE5IDU0IDU5Lm1wNCBtYWdpYyBlcGlzb2RlIF8gbm92IDI2LCAyX3RoZV93ZWVrbHkgcmVjYXAubXA0IiwiaWF0IjoxNzY0MTI2MjI5LCJleHAiOjIwNzk0ODYyMjl9.Ik77t63UnAnbZF9P0F8zcGV8uX0a7Jyq_gSCVKQUAEo" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>

          <div className="flex w-full justify-between items-center">
            <Button
              variant="ghost"
              onClick={() => {
                onSkipThisSession?.();
                onClose?.();
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              Skip for now
            </Button>

            <Button
              size="lg"
              onClick={handleComplete}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              Get Started <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}