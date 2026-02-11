"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Mail, ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * Advisor Signup Success Page
 * Displays confirmation message after successful advisor account creation
 * Prompts user to check email for verification
 */
export default function AdvisorSignUpSuccess() {
  return (
    <div className="min-h-screen bg-[#f0fdf7] relative overflow-hidden flex items-center justify-center p-4">
      {/* aurora-glow effect for consistency */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-200/10 blur-[120px] rounded-full pointer-events-none animate-aurora" />
      <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-100/5 blur-[120px] rounded-full pointer-events-none animate-aurora" style={{ animationDelay: '-3s' }} />

      <Card className="max-w-md w-full shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden relative z-10 bg-white/80 backdrop-blur-xl">
        <CardHeader className="text-center p-10">
          {/* Success Icon */}
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-emerald-50 border border-emerald-100 shadow-inner">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          </div>

          <CardTitle className="text-3xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Account Created!</CardTitle>
          <CardDescription className="text-sm font-bold text-emerald-900/40 uppercase tracking-widest">
            Advisor account registration successful
          </CardDescription>
        </CardHeader>

        <CardContent className="p-10 pt-0 space-y-8">
          {/* Instructions */}
          <div className="rounded-[2.5rem] bg-emerald-50/50 border border-emerald-50 p-8">
            <p className="text-xs font-black text-emerald-900/40 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
              <ArrowRight className="w-3 h-3" />
              Next Steps
            </p>
            <ol className="space-y-4">
              {[
                "Check your email inbox for a verification link",
                "Click the verification link to activate account",
                "Login to access your advisor dashboard"
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-4 group">
                  <span className="flex-shrink-0 w-8 h-8 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-xs font-black group-hover:bg-emerald-500 group-hover:text-white transition-all duration-300">
                    {i + 1}
                  </span>
                  <span className="text-emerald-950/80 font-bold group-hover:text-emerald-950 transition-colors text-sm">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Additional Information */}
          <div className="bg-emerald-950 rounded-[2rem] p-6 text-white text-xs text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50/5 rounded-full blur-2xl -mr-12 -mt-12" />
            <p className="font-medium text-emerald-50/60 leading-relaxed relative z-10">
              <strong className="text-white">Note:</strong> Verification is required before login. Please check your spam folder if the email doesn&apos;t arrive in 5 minutes.
            </p>
          </div>

          {/* Action Button */}
          <Link href="/auth/login" className="block">
            <Button className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95">
              Continue to Login
            </Button>
          </Link>

          {/* Help Link */}
          <div className="text-center">
            <p className="text-sm font-bold text-emerald-900/30">
              Need help?{" "}
              <Link
                href="/support"
                className="text-emerald-500 hover:underline"
              >
                Contact Support
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}