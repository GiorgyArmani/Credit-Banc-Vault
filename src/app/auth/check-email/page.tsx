// src/app/auth/check-email/page.tsx
import { Mail, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CheckEmailPage() {
  return (
    <div className="min-h-screen bg-[#f0fdf7] relative overflow-hidden flex items-center justify-center px-4">
      {/* aurora-glow effect for consistency */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-200/10 blur-[120px] rounded-full pointer-events-none animate-aurora" />
      <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-100/5 blur-[120px] rounded-full pointer-events-none animate-aurora" style={{ animationDelay: '-3s' }} />

      <Card className="max-w-md w-full shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden relative z-10 bg-white/80 backdrop-blur-xl">
        <CardHeader className="p-10 text-center">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-emerald-50 border border-emerald-100 shadow-inner">
            <Mail className="h-10 w-10 text-emerald-500" />
          </div>
          <CardTitle className="text-3xl font-black text-emerald-950 uppercase tracking-tighter mb-2">Check Email</CardTitle>
        </CardHeader>
        <CardContent className="p-10 pt-0 space-y-8">
          <div className="text-center space-y-4">
            <p className="text-emerald-900/40 text-sm font-bold uppercase tracking-widest leading-relaxed">
              We&apos;ve sent a confirmation link to your inbox.
            </p>
            <p className="text-emerald-950 font-bold leading-relaxed">
              Click the link in the email to finish creating your account.
            </p>
          </div>

          <div className="bg-emerald-950 rounded-[2rem] p-6 text-white text-xs text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50/5 rounded-full blur-2xl -mr-12 -mt-12" />
            <p className="font-medium text-emerald-50/60 leading-relaxed relative z-10">
              <strong className="text-white">Didn&apos;t get it?</strong> Check your spam folder or wait a few minutes for delivery.
            </p>
          </div>

          <Link href="/auth/login" className="block text-center mt-6">
            <span className="text-emerald-600 font-black uppercase tracking-widest text-xs hover:underline cursor-pointer">
              Back to Login
            </span>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
