// src/app/auth/sign-up-success/page.tsx
"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Mail, Lock, ArrowRight, Copy, Check } from "lucide-react";

// Separate component that uses useSearchParams
function SuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get("email");
  const [copied, set_copied] = useState(false);

  const default_password = "CreditBanc2025!";

  const copy_password = async () => {
    await navigator.clipboard.writeText(default_password);
    set_copied(true);
    setTimeout(() => set_copied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#f0fdf7] relative overflow-hidden flex items-center justify-center p-4">
      {/* aurora-glow effect for consistency */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-200/10 blur-[120px] rounded-full pointer-events-none animate-aurora" />
      <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-100/5 blur-[120px] rounded-full pointer-events-none animate-aurora" style={{ animationDelay: '-3s' }} />

      <Card className="max-w-2xl w-full shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden relative z-10 bg-white">
        <CardHeader className="text-center p-10 md:p-14 border-b border-emerald-50 bg-white">
          <div className="flex justify-center mb-8">
            <div className="w-24 h-24 bg-emerald-50 rounded-[2rem] flex items-center justify-center border border-emerald-100 shadow-inner">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
            </div>
          </div>
          <CardTitle className="text-4xl md:text-5xl font-black text-emerald-950 uppercase tracking-tighter mb-4 leading-tight">
            Account Created!
          </CardTitle>
          <p className="text-emerald-900/40 text-xl font-bold uppercase tracking-widest">
            Welcome to Credit Banc Vault
          </p>
        </CardHeader>

        <CardContent className="p-8 md:p-12 space-y-8">
          <div className="bg-emerald-50/50 rounded-[2.5rem] p-8 border border-emerald-50">
            <h3 className="text-xs font-black text-emerald-900/40 uppercase tracking-[0.2em] mb-8 flex items-center gap-2">
              <Lock className="w-4 h-4" />
              Your Login Credentials
            </h3>

            <div className="space-y-4">
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-emerald-50">
                <Label className="text-[10px] font-black uppercase tracking-widest text-emerald-900/30 mb-2 flex items-center gap-2">
                  <Mail className="w-3 h-3" />
                  Email Address
                </Label>
                <p className="text-xl font-black text-emerald-950">{email}</p>
              </div>

              <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 border border-emerald-50">
                <Label className="text-[10px] font-black uppercase tracking-widest text-emerald-900/30 mb-2 flex items-center gap-2">
                  <Lock className="w-3 h-3" />
                  Temporary Password
                </Label>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xl font-black text-emerald-950 tracking-tight">{default_password}</p>
                  <Button
                    onClick={copy_password}
                    variant="outline"
                    size="sm"
                    className="h-10 px-4 border-2 border-emerald-100 text-emerald-950 font-black rounded-xl hover:bg-emerald-50 transition-all active:scale-95"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-1 text-emerald-500" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-emerald-950 rounded-[2.5rem] p-8 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50/5 rounded-full blur-3xl -mr-16 -mt-16" />
            <h3 className="text-lg font-black uppercase tracking-tight mb-4 flex items-center gap-2 relative z-10">
              <Lock className="w-5 h-5 text-emerald-400" />
              Security Notice
            </h3>
            <ul className="space-y-3 text-emerald-50/60 font-medium relative z-10">
              <li className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <span>This is a <strong>temporary password</strong> for initial access.</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <span>We strongly recommend changing your password after logging in.</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <span>Update your password anytime from settings.</span>
              </li>
            </ul>
          </div>

          <div className="bg-emerald-50/30 rounded-[2.5rem] p-8 border border-emerald-50">
            <h3 className="text-xs font-black text-emerald-900/40 uppercase tracking-[0.2em] mb-6">✅ Next Steps</h3>
            <div className="space-y-4">
              {[
                "Log into your account with the credentials above",
                "Complete your business profile and upload documents",
                "Track your funding application in real-time",
                "Update your password for enhanced security"
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-4 group">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-xs font-black group-hover:bg-emerald-500 group-hover:text-white transition-all duration-300">
                    {i + 1}
                  </span>
                  <span className="text-emerald-950/80 font-bold group-hover:text-emerald-950 transition-colors">{step}</span>
                </div>
              ))}
            </div>
          </div>

          <Button
            onClick={() => router.push("/auth/login")}
            className="w-full h-16 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95 text-lg"
          >
            Continue to Login
            <ArrowRight className="ml-2 w-6 h-6" />
          </Button>

          <p className="text-center text-sm font-bold text-emerald-900/30">
            Need help? Contact support at{" "}
            <a href="mailto:support@creditbanc.io" className="text-emerald-500 hover:underline">
              support@creditbanc.io
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Main page component with Suspense wrapper
export default function SignUpSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f0fdf7] relative overflow-hidden flex items-center justify-center">
          {/* aurora-glow effect for consistency */}
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
          <div className="text-center relative z-10">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-emerald-500 mx-auto mb-6"></div>
            <p className="text-emerald-950/40 text-lg font-black uppercase tracking-widest">Loading credentials...</p>
          </div>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}