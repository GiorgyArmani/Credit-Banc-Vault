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
  const [currentStep, setCurrentStep] = useState(0);
  const [profile, setProfile] = useState<Partial<BusinessProfile>>({});
  const supabase = createClient();
  const router = useRouter();
  const step: Step | undefined = steps[currentStep];
  const progress = steps.length > 0 ? ((currentStep + 1) / steps.length) * 100 : 0;
  if (!step) return null;

  const handleChange = (key: keyof BusinessProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const isStepValid = () =>
    step.fields.filter((f) => f.required).every((f) => !!profile[f.key]);

  const handleComplete = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const finalProfile: BusinessProfile = {
      business_name: profile.business_name ?? undefined,
      business_description: profile.business_description ?? undefined,
      business_model: profile.business_model ?? undefined,
      years_in_business: profile.years_in_business ?? undefined,
      industry: profile.industry ?? undefined,
      primary_goal: profile.primary_goal ?? undefined,
      secondary_goal: profile.secondary_goal ?? undefined,
      main_challenge: profile.main_challenge ?? undefined,
      annual_revenue_last_year: profile.annual_revenue_last_year ?? undefined,
      monthly_revenue: profile.monthly_revenue ?? undefined,
      completion_level: 100,
      completed_categories: ["basic", "goals", "financial"],
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
      <DialogContent className="max-w-3xl w-full p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Complete your business profile</DialogTitle>
          <DialogDescription>
            Completing this helps us personalize your coaching and recommendations.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          {/* Progress */}
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-500 mb-1">
              <span>
                Step {currentStep + 1} of {steps.length}
              </span>
              <span>{Math.round(progress)}% complete</span>
            </div>
            <Progress value={progress} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{step.title}</CardTitle>
              <CardDescription>{step.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {step.fields.map((field) => {
                const id = String(field.key);
                const value = String(profile[field.key] ?? "");

                return (
                  <div key={id} className="space-y-2">
                    <Label htmlFor={id}>
                      {field.label}
                      {field.required && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </Label>

                    {field.type === "input" && (
                      <Input
                        id={id}
                        name={id}
                        placeholder={field.placeholder}
                        value={value}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                      />
                    )}

                    {field.type === "textarea" && (
                      <Textarea
                        id={id}
                        name={id}
                        placeholder={field.placeholder}
                        rows={3}
                        value={value}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                      />
                    )}

                    {field.type === "select" && (
                      <Select
                        value={value}
                        onValueChange={(val) => handleChange(field.key, val)}
                      >
                        <SelectTrigger id={id} name={id}>
                          <SelectValue placeholder="Select an option" />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options?.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}

              <div className="flex items-center justify-between pt-6">
                <div className="flex items-center gap-2">
                  {currentStep > 0 ? (
                    <Button
                      variant="outline"
                      onClick={() => setCurrentStep((s) => s - 1)}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        onSkipThisSession?.();
                        onClose?.();
                      }}
                    >
                      Skip for now
                    </Button>
                  )}
                </div>

                <Button
                  disabled={!isStepValid()}
                  onClick={
                    currentStep === steps.length - 1
                      ? handleComplete
                      : () => setCurrentStep((s) => s + 1)
                  }
                >
                  {currentStep === steps.length - 1 ? (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" /> Complete Setup
                    </>
                  ) : (
                    <>
                      Next <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
